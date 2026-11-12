import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, posix, relative, resolve } from "node:path";
import { byteCompare } from "./findings.js";
import { ParseError, splitFrontmatter, type YamlValue } from "./fm.js";
import { git, headShortSha, isCheckout, pathExistsAtHead, repoRoot, userName } from "./git.js";
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

interface ExistingPage {
  id: string;
  file: string;
  raw: string;
  body: string;
  bodyStartLine: number;
  imported: boolean;
  /** Original source path (first anchor) for imported pages — resolves their relative links. */
  originPath: string | null;
}

/** Parse every existing page once; malformed pages are lint's problem, not import's. */
function loadExistingPages(loreDir: string): ExistingPage[] {
  const out: ExistingPage[] = [];
  for (const page of collectPages(loreDir)) {
    const raw = readFileSync(page.file, "utf8");
    let doc: ReturnType<typeof splitFrontmatter>;
    try {
      doc = splitFrontmatter(raw);
    } catch {
      continue;
    }
    const imported = doc.frontmatter.imported === "true";
    let originPath: string | null = null;
    const sources = doc.frontmatter.sources;
    const first = Array.isArray(sources) ? sources[0] : undefined;
    if (
      imported &&
      first !== undefined &&
      typeof first === "object" &&
      !Array.isArray(first) &&
      typeof first.path === "string"
    ) {
      originPath = first.path;
    }
    out.push({
      id: page.id,
      file: page.file,
      raw,
      body: doc.body,
      bodyStartLine: doc.bodyStartLine,
      imported,
      originPath,
    });
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
      // Same gate as drift: never run git in a directory that is not a checkout (SPEC §16).
      if (isCheckout(dir)) {
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
  // Writes are deferred until after link resolution, so intra-batch collisions
  // must be caught here — existsSync alone would let a later file clobber an
  // earlier one's page silently.
  const pendingTargets = new Set<string>();

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
    if (existsSync(target) || pendingTargets.has(targetRel)) {
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

    pendingTargets.add(targetRel);
    pending.push({ target, targetRel, fromRel, id: `${opts.kind}/${slug}`, head, body });
  }

  // Link rewriting (SPEC §14): targets resolve against ALL pages plus this batch.
  // Path-style targets resolve exact-path-first against the linking file's own
  // directory; a path that names a file skipped this run is never re-pointed by
  // name — mis-anchoring is worse than a broken link.
  const existing = loadExistingPages(loreDir);
  const idSet = new Set<string>();
  const idBySlug = new Map<string, string | null>(); // null = ambiguous
  const idByPath = new Map<string, string>(); // original source path → id
  const addId = (id: string): void => {
    idSet.add(id);
    const slug = id.slice(id.indexOf("/") + 1);
    const prev = idBySlug.get(slug);
    if (prev === undefined) idBySlug.set(slug, id);
    else if (prev !== id) idBySlug.set(slug, null);
  };
  for (const page of existing) {
    addId(page.id);
    if (page.originPath !== null) idByPath.set(page.originPath, page.id);
  }
  for (const page of pending) {
    addId(page.id);
    idByPath.set(page.fromRel, page.id);
  }
  const skippedRels = new Set(skipped.map((s) => s.from));

  let linksRewritten = 0;
  let linksLeft = 0;
  const rewriteBody = (
    body: string,
    originPath: string | null,
  ): { body: string; changed: boolean } => {
    let changed = false;
    const out = body.replace(WIKILINK, (full: string, inner: string, offset: number) => {
      const { target, heading, alias, escapedPipe } = splitWikiLink(inner);
      if (target === "") {
        if (heading === null) linksLeft++; // degenerate `[[|x]]` — lint will flag it
        return full; // same-page anchors are not page links
      }
      const slash = target.indexOf("/");
      let id: string | null | undefined;
      if (slash !== -1 && kinds.includes(target.slice(0, slash))) {
        // Id-form: the namespace takes precedence — never rewritten.
        if (!idSet.has(target)) linksLeft++;
        return full;
      }
      if (slash === -1) {
        const slug = slugify(target);
        id = slug === "" ? undefined : idBySlug.get(slug);
      } else {
        // Path-style: exact path against the linking file's directory first.
        id = undefined;
        if (originPath !== null) {
          const cand = posix.normalize(posix.join(posix.dirname(originPath), target));
          id = idByPath.get(cand) ?? idByPath.get(`${cand}.md`);
          if (id === undefined && (skippedRels.has(cand) || skippedRels.has(`${cand}.md`))) {
            linksLeft++;
            return full;
          }
        }
        if (id === undefined) {
          const slug = slugify(posix.basename(target));
          id = slug === "" ? undefined : idBySlug.get(slug);
        }
      }
      if (id === undefined || id === null) {
        linksLeft++;
        return full;
      }
      linksRewritten++;
      changed = true;
      const suffix = heading === null ? "" : `#${heading}`;
      // Rendered text AND structure are information: keep the alias and its escape
      // style; a synthesized alias landing in a table row must be written escaped
      // or the new `|` splits the cell (SPEC §14).
      const lineStart = body.lastIndexOf("\n", offset - 1) + 1;
      const inTableRow = body.slice(lineStart, offset).trimStart().startsWith("|");
      const sep = (alias !== null ? escapedPipe : inTableRow) ? "\\|" : "|";
      return `[[${id}${suffix}${sep}${alias ?? `${target}${suffix}`}]]`;
    });
    return { body: out, changed };
  };

  for (const page of pending) {
    const rewritten = rewriteBody(page.body, page.fromRel);
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
    if (!page.imported) continue;
    const rewritten = rewriteBody(page.body, page.originPath);
    if (!rewritten.changed) continue;
    pagesRelinked++;
    if (!opts.dryRun) {
      const headLines = page.raw.split("\n").slice(0, page.bodyStartLine - 1);
      writeFileSync(page.file, `${headLines.join("\n")}\n${rewritten.body}`);
    }
  }

  return { created, skipped, notes, linksRewritten, linksLeft, pagesRelinked };
}
