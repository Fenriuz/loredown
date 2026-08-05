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
import { git, headShortSha, repoRoot, userName } from "./git.js";
import { allowedKinds, type Config, SLUG, TITLE_MAX } from "./model.js";

export interface ImportOptions {
  kind: string;
  cwd: string;
  dryRun: boolean;
  today: string;
}

export interface ImportResult {
  created: { file: string; from: string }[];
  skipped: { from: string; reason: string }[];
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

/**
 * Scaffold pages from existing markdown (SPEC §14 `import`) — the adoption path.
 * Mechanical only: body preserved, provenance from git history, the source
 * anchored to the ORIGINAL file at HEAD (truthful and lint-valid — no TODOs),
 * `imported: true` marking the curation debt. Judgment (derivability test, kind
 * correction, splitting) stays with the human/agent.
 */
export function importPages(
  loreDir: string,
  config: Config,
  inputs: string[],
  opts: ImportOptions,
): ImportResult {
  const kinds = allowedKinds(config);
  if (!kinds.includes(opts.kind)) {
    return {
      created: [],
      skipped: [],
      error: `unknown kind "${opts.kind}" — allowed: ${kinds.join(", ")}`,
    };
  }
  const root = repoRoot(opts.cwd);
  if (root === null) {
    return {
      created: [],
      skipped: [],
      error: "import requires a git repository (sources are anchored at HEAD)",
    };
  }
  const sha = headShortSha(opts.cwd);
  if (sha === null) {
    return {
      created: [],
      skipped: [],
      error: "repository has no commits yet — commit the source files first",
    };
  }
  const actor = userName(opts.cwd) ?? "unknown";

  const files: string[] = [];
  for (const input of inputs) {
    const path = resolve(opts.cwd, input);
    if (!existsSync(path)) {
      return { created: [], skipped: [], error: `no such file or directory: ${input}` };
    }
    files.push(...collectMarkdown(path, loreDir));
  }

  const created: ImportResult["created"] = [];
  const skipped: ImportResult["skipped"] = [];

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
    const h1 = raw.match(/^# (.+)$/m);
    let title = (h1?.[1] ?? basename(file).replace(/\.md$/, "")).trim();
    if (title.length > TITLE_MAX) title = `${title.slice(0, TITLE_MAX - 1)}…`;
    let body = h1 === null ? raw : raw.replace(h1[0], "");
    body = `${body.replace(/^\n+/, "").trimEnd()}\n`;

    const dates = fileDates(root, fromRel) ?? { created: opts.today, updated: opts.today };

    const content = [
      "---",
      `id: ${opts.kind}/${slug}`,
      `title: ${yamlScalar(title)}`,
      `kind: ${opts.kind}`,
      "status: active",
      `created: ${dates.created}`,
      `updated: ${dates.updated}`,
      "provenance:",
      "  agent: import",
      `  actor: ${yamlScalar(actor)}`,
      "  task: import",
      "sources:",
      `  - path: ${yamlScalar(fromRel)}`,
      `    sha: ${sha}`,
      "    note: imported from this file",
      "imported: true",
      "---",
      "",
      body,
    ].join("\n");

    if (!opts.dryRun) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    }
    created.push({ file: `lore/${targetRel}`, from: fromRel });
  }

  return { created, skipped };
}
