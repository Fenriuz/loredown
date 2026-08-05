import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { byteCompare } from "./findings.js";
import { ParseError, splitFrontmatter, type YamlValue } from "./fm.js";
import { git, headShortSha, pathExistsAtHead, repoRoot, userName } from "./git.js";
import {
  allowedKinds,
  type Config,
  ISO_DATE,
  SLUG,
  splitWikiLink,
  TITLE_MAX,
  WIKILINK,
} from "./model.js";

export interface ImportOptions {
  kind: string;
  cwd: string;
  dryRun: boolean;
  today: string;
}

export interface ImportResult {
  created: { file: string; from: string }[];
  skipped: { from: string; reason: string }[];
  /** Per-file conditions worth surfacing (e.g. unparseable original frontmatter). */
  notes: { from: string; message: string }[];
  linksRewritten: number;
  /** Bare wiki-link targets left unresolved (ambiguous or unknown) across imported pages. */
  linksLeft: number;
  /** Previously imported pages whose forward links this run resolved. */
  pagesRelinked: number;
  error?: string;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.md$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Quote a YAML scalar when the strict subset would otherwise misparse it. */
function yamlScalar(value: string): string {
  if (/(: )|( #)|^["'[\s]|\s$/.test(value)) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

function collectMarkdown(input: string, loreDir: string): string[] {
  const out: string[] = [];
  const walk = (path: string): void => {
    if (resolve(path) === resolve(loreDir)) return; // never import the lore itself
    const stat = statSync(path);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path).sort(byteCompare)) walk(join(path, entry));
    } else if (path.endsWith(".md")) {
      out.push(path);
    }
  };
  walk(input);
  return out;
}

/** First and last commit dates (ISO) of a file, or null when untracked. */
function fileDates(root: string, rel: string): { created: string; updated: string } | null {
  const result = git(root, ["log", "--follow", "--format=%as", "--", rel]);
  if (!result.ok) return null;
  const dates = result.stdout
    .trim()
    .split("\n")
    .filter((l) => l !== "");
  if (dates.length === 0) return null;
  return { created: dates[dates.length - 1] as string, updated: dates[0] as string };
}

/** Every existing page as id + absolute file path, byte-ordered. */
function collectPages(loreDir: string): { id: string; file: string }[] {
  const pagesDir = join(loreDir, "pages");
  if (!existsSync(pagesDir)) return [];
  const out: { id: string; file: string }[] = [];
  for (const kindDir of readdirSync(pagesDir).sort(byteCompare)) {
    const dir = join(pagesDir, kindDir);
    if (!statSync(dir).isDirectory()) continue;
    for (const entry of readdirSync(dir).sort(byteCompare)) {
      if (entry.endsWith(".md"))
        out.push({ id: `${kindDir}/${entry.slice(0, -3)}`, file: join(dir, entry) });
    }
  }
  return out;
}

interface HarvestedFrontmatter {
  title?: string;
  created?: string;
  updated?: string;
  /** String entries of a pre-existing `sources:` list. */
  sourceEntries: string[];
  /** `key=value` render of everything not adopted, byte-ordered by key. */
  unmapped: string[];
  body: string;
}

/**
 * Parse and strip a pre-existing frontmatter block. Returns null when the file
 * has none or it does not parse under the strict subset (caller reports; the
 * block then stays in the body untouched — visible, never guessed at).
 */
function harvestFrontmatter(raw: string): HarvestedFrontmatter | null | ParseError {
  if (!raw.startsWith("---\n")) return null;
  let doc: ReturnType<typeof splitFrontmatter>;
  try {
    doc = splitFrontmatter(raw);
  } catch (e) {
    if (e instanceof ParseError) return e;
    throw e;
  }
  const out: HarvestedFrontmatter = { sourceEntries: [], unmapped: [], body: doc.body };
  const render = (value: YamlValue): string =>
    typeof value === "string" ? value : JSON.stringify(value);
  for (const key of Object.keys(doc.frontmatter).sort(byteCompare)) {
    const value = doc.frontmatter[key] as YamlValue;
    if (key === "title" && typeof value === "string" && value.trim() !== "") {
      out.title = value.trim();
      continue;
    }
    if (
      (key === "created" || key === "updated") &&
      typeof value === "string" &&
      ISO_DATE.test(value)
    ) {
      out[key] = value;
      continue;
    }
    if (key === "sources") {
      const items = Array.isArray(value) ? value : [value];
      out.sourceEntries = items.filter((v): v is string => typeof v === "string");
      const rest = items.filter((v) => typeof v !== "string");
      if (rest.length > 0) out.unmapped.push(`sources=${JSON.stringify(rest)}`);
      continue;
    }
    out.unmapped.push(`${key}=${render(value)}`);
  }
  return out;
}

interface PendingPage {
  target: string;
  targetRel: string;
  fromRel: string;
  id: string;
  head: string[];
  body: string;
}

/**
 * Scaffold pages from existing markdown (SPEC §14 import contract) — a
 * deterministic, judgment-free transform: no judgment applied, no information
 * lost. Pre-existing frontmatter is harvested (title, dates, `sources:` entries
 * resolved to real anchors via config.repos) with unadopted metadata preserved
 * in the import anchor's note. Bare wiki-link targets are rewritten to the
 * `kind/slug` namespace across ALL pages still marked `imported: true`, so a
 * multi-`--kind` migration converges run by run. Judgment (derivability test,
 * kind correction, splitting) stays with the human/agent.
 */
export function importPages(
  loreDir: string,
  config: Config,
  inputs: string[],
  opts: ImportOptions,
): ImportResult {
  const empty = {
    created: [],
    skipped: [],
    notes: [],
    linksRewritten: 0,
    linksLeft: 0,
    pagesRelinked: 0,
  };
  const kinds = allowedKinds(config);
  if (!kinds.includes(opts.kind)) {
    return { ...empty, error: `unknown kind "${opts.kind}" — allowed: ${kinds.join(", ")}` };
  }
  const root = repoRoot(opts.cwd);
  if (root === null) {
    return { ...empty, error: "import requires a git repository (sources are anchored at HEAD)" };
  }
  const sha = headShortSha(opts.cwd);
  if (sha === null) {
    return { ...empty, error: "repository has no commits yet — commit the source files first" };
  }
  const actor = userName(opts.cwd) ?? "unknown";

  const files: string[] = [];
  for (const input of inputs) {
    const path = resolve(opts.cwd, input);
    if (!existsSync(path)) {
      return { ...empty, error: `no such file or directory: ${input}` };
    }
    files.push(...collectMarkdown(path, loreDir));
  }

  // Sibling checkouts resolve exactly as drift resolves them: relative to the
  // lore's parent (SPEC §9); longest declared name wins a prefix match.
  const repoBase = dirname(loreDir);
  const repoNames = Object.keys(config.repos).sort(
    (a, b) => b.length - a.length || byteCompare(a, b),
  );
  const checkoutCache = new Map<string, { dir: string; sha: string } | null>();
  const checkoutOf = (name: string): { dir: string; sha: string } | null => {
    let cached = checkoutCache.get(name);
    if (cached === undefined) {
      const dir = resolve(repoBase, config.repos[name] as string);
      cached = null;
      if (existsSync(dir) && git(dir, ["rev-parse", "--git-dir"]).ok) {
        const head = headShortSha(dir);
        if (head !== null) cached = { dir, sha: head };
      }
      checkoutCache.set(name, cached);
    }
    return cached;
  };

  const created: ImportResult["created"] = [];
  const skipped: ImportResult["skipped"] = [];
  const notes: ImportResult["notes"] = [];
  const pending: PendingPage[] = [];

  for (const file of files) {
    // realpath both sides: on macOS tmp dirs, /var is a symlink to /private/var
    // and git reports the resolved toplevel — relative() must compare like with like.
    const fromRel = relative(realpathSync(root), realpathSync(file));
    if (fromRel.startsWith("..")) {
      skipped.push({ from: file, reason: "outside the git repository — cannot anchor" });
      continue;
    }
    const slug = slugify(basename(file));
    if (!SLUG.test(slug)) {
      skipped.push({ from: fromRel, reason: `filename does not yield a valid slug ("${slug}")` });
      continue;
    }
    const targetRel = `pages/${opts.kind}/${slug}.md`;
    const target = join(loreDir, targetRel);
    if (existsSync(target)) {
      skipped.push({
        from: fromRel,
        reason: `${targetRel} already exists — the slug is the identity`,
      });
      continue;
    }

    const raw = readFileSync(file, "utf8");
    const harvest = harvestFrontmatter(raw);
    let fm: HarvestedFrontmatter | null = null;
    let bodySource = raw;
    if (harvest instanceof ParseError) {
      notes.push({
        from: fromRel,
        message: `original frontmatter is not the strict subset (${harvest.message}) — left in body for manual curation`,
      });
    } else if (harvest !== null) {
      fm = harvest;
      bodySource = harvest.body;
    }

    const h1 = bodySource.match(/^# (.+)$/m);
    const h1Text = h1?.[1]?.trim();
    let title = (fm?.title ?? h1Text ?? basename(file).replace(/\.md$/, "")).trim();
    if (title.length > TITLE_MAX) title = `${title.slice(0, TITLE_MAX - 1)}…`;
    let body = bodySource;
    // Strip the H1 only when it served as (or restates) the title — a
    // divergent heading is content, and import never loses content.
    if (h1 !== null && (fm?.title === undefined || fm.title === h1Text)) {
      body = body.replace(h1[0], "");
    }
    body = `${body.replace(/^\n+/, "").trimEnd()}\n`;

    const gitDates = fileDates(root, fromRel);
    const pageCreated = fm?.created ?? gitDates?.created ?? opts.today;
    const pageUpdated = fm?.updated ?? gitDates?.updated ?? opts.today;

    // Resolve pre-existing `sources:` entries to real anchors. An entry becomes
    // an anchor only when the path verifies in the target repo — an anchor must
    // never be born SRC_GONE. Everything else is kept in the note.
    const harvested: { repo?: string; path: string; sha: string }[] = [];
    const unresolved: string[] = [];
    const seen = new Set<string>([`:${fromRel}`]);
    for (const entryRaw of fm?.sourceEntries ?? []) {
      const entry = entryRaw.trim().replace(/^\.\//, "").replace(/\/+$/, "");
      if (entry === "") {
        unresolved.push(entryRaw);
        continue;
      }
      const repoName = repoNames.find((n) => entry === n || entry.startsWith(`${n}/`));
      if (repoName !== undefined) {
        const rest = entry === repoName ? "" : entry.slice(repoName.length + 1);
        const checkout = checkoutOf(repoName);
        if (rest !== "" && checkout !== null && pathExistsAtHead(checkout.dir, rest)) {
          if (!seen.has(`${repoName}:${rest}`)) {
            seen.add(`${repoName}:${rest}`);
            harvested.push({ repo: repoName, path: rest, sha: checkout.sha });
          }
        } else {
          unresolved.push(entry);
        }
        continue;
      }
      if (pathExistsAtHead(root, entry)) {
        if (!seen.has(`:${entry}`)) {
          seen.add(`:${entry}`);
          harvested.push({ path: entry, sha });
        }
      } else {
        unresolved.push(entry);
      }
    }

    let note = "imported from this file";
    if (unresolved.length > 0) note += `; unresolved sources: ${unresolved.join(", ")}`;
    if (fm !== null && fm.unmapped.length > 0) note += `; unmapped: ${fm.unmapped.join(", ")}`;

    const head = [
      "---",
      `id: ${opts.kind}/${slug}`,
      `title: ${yamlScalar(title)}`,
      `kind: ${opts.kind}`,
      "status: active",
      `created: ${pageCreated}`,
      `updated: ${pageUpdated}`,
      "provenance:",
      "  agent: import",
      `  actor: ${yamlScalar(actor)}`,
      "  task: import",
      "sources:",
      `  - path: ${yamlScalar(fromRel)}`,
      `    sha: ${sha}`,
      `    note: ${yamlScalar(note)}`,
    ];
    for (const anchor of harvested) {
      if (anchor.repo !== undefined) {
        head.push(`  - repo: ${anchor.repo}`, `    path: ${yamlScalar(anchor.path)}`);
      } else {
        head.push(`  - path: ${yamlScalar(anchor.path)}`);
      }
      head.push(`    sha: ${anchor.sha}`);
    }
    head.push("imported: true", "---", "");

    pending.push({ target, targetRel, fromRel, id: `${opts.kind}/${slug}`, head, body });
  }

  // Link rewriting (SPEC §14): bare targets resolve against ALL pages plus this
  // batch; exactly one slug match rewrites, anything else is left for lint.
  const existing = collectPages(loreDir);
  const idBySlug = new Map<string, string | null>(); // null = ambiguous
  const addId = (id: string): void => {
    const slug = id.slice(id.indexOf("/") + 1);
    const prev = idBySlug.get(slug);
    if (prev === undefined) idBySlug.set(slug, id);
    else if (prev !== id) idBySlug.set(slug, null);
  };
  for (const page of existing) addId(page.id);
  for (const page of pending) addId(page.id);

  let linksRewritten = 0;
  let linksLeft = 0;
  const rewriteBody = (body: string): { body: string; changed: boolean } => {
    let changed = false;
    const out = body.replace(WIKILINK, (full: string, inner: string) => {
      const { target, alias } = splitWikiLink(inner);
      if (target.includes("/")) return full; // already namespaced — never touched
      const slug = slugify(target);
      const id = slug === "" ? undefined : idBySlug.get(slug);
      if (id === undefined || id === null) {
        linksLeft++;
        return full;
      }
      linksRewritten++;
      changed = true;
      // The rendered text is information: keep the alias, or the original target.
      return `[[${id}|${alias ?? target}]]`;
    });
    return { body: out, changed };
  };

  for (const page of pending) {
    const rewritten = rewriteBody(page.body);
    if (!opts.dryRun) {
      mkdirSync(dirname(page.target), { recursive: true });
      writeFileSync(page.target, [...page.head, rewritten.body].join("\n"));
    }
    created.push({ file: `lore/${page.targetRel}`, from: page.fromRel });
  }

  // Lore-wide pass over pages still marked `imported: true`: this batch may
  // have created the targets of forward links left bare by an earlier run.
  let pagesRelinked = 0;
  for (const page of existing) {
    const raw = readFileSync(page.file, "utf8");
    let doc: ReturnType<typeof splitFrontmatter>;
    try {
      doc = splitFrontmatter(raw);
    } catch {
      continue; // malformed page — lint's problem, not import's
    }
    if (doc.frontmatter.imported !== "true") continue;
    const rewritten = rewriteBody(doc.body);
    if (!rewritten.changed) continue;
    pagesRelinked++;
    if (!opts.dryRun) {
      const headLines = raw.split("\n").slice(0, doc.bodyStartLine - 1);
      writeFileSync(page.file, `${headLines.join("\n")}\n${rewritten.body}`);
    }
  }

  return { created, skipped, notes, linksRewritten, linksLeft, pagesRelinked };
}
