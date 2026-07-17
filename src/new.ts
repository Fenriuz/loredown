import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { headShortSha, userName } from "./git.js";
import { allowedKinds, type Config, isBuiltinKind, KIND_TEMPLATES, SLUG } from "./model.js";

export interface NewPageOptions {
  agent: string;
  task: string;
  cwd: string;
  dryRun: boolean;
  today: string;
}

export interface NewPageResult {
  file?: string;
  content?: string;
  error?: string;
}

/**
 * Scaffold a page with prefilled frontmatter (SPEC §14). Deliberate TODOs
 * (title, source path — and sha when the repo has no HEAD) fail lint until
 * filled: a scaffold must not be committable by accident.
 */
export function newPage(
  loreDir: string,
  config: Config,
  kind: string,
  slug: string,
  opts: NewPageOptions,
): NewPageResult {
  const kinds = allowedKinds(config);
  if (!kinds.includes(kind)) {
    return { error: `unknown kind "${kind}" — allowed: ${kinds.join(", ")}` };
  }
  if (!SLUG.test(slug)) {
    return { error: `invalid slug "${slug}" — use lowercase letters, digits and hyphens` };
  }
  const rel = `pages/${kind}/${slug}.md`;
  const path = join(loreDir, rel);
  if (existsSync(path)) {
    return {
      error: `${rel} already exists — the slug is the identity; update the existing page instead`,
    };
  }

  const actor = userName(opts.cwd) ?? "unknown";
  const sha = headShortSha(opts.cwd) ?? "TODO";
  const template = isBuiltinKind(kind) ? KIND_TEMPLATES[kind] : "";
  const task = opts.task.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  const lines = [
    "---",
    `id: ${kind}/${slug}`,
    "title: TODO one-line statement of the fact",
    `kind: ${kind}`,
    "status: active",
    `created: ${opts.today}`,
    `updated: ${opts.today}`,
    "provenance:",
    `  agent: ${opts.agent}`,
    `  actor: "${actor.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`,
    `  task: "${task}"`,
    "sources:",
    "  - path: TODO",
    `    sha: ${sha}`,
    "---",
    "",
  ];
  const content = lines.join("\n") + template;

  if (!opts.dryRun) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return { file: `lore/${rel}`, content };
}
