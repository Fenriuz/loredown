import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { generateIndex } from "./index-gen.js";
import { DEFAULT_CONFIG } from "./model.js";

const CONFIG_TEMPLATE = `schema_version: 1
budgets:
  page_body_lines: 40
  pages_per_task: 3
scan:
  instructions: warn  # off | warn | error
  secrets: error      # warn | error — cannot be disabled
kinds: []
`;

export const SEED_GUIDE = `Guided bootstrap — paste this to your coding agent:

  This repo uses loredown: a team knowledge base of markdown pages in lore/
  (one file per fact; kinds: decision, constraint, gotcha, incident,
  glossary, map). Seed it by interviewing me, one topic at a time:

    1. Which decisions would a new teammate question first? For each: what
       was chosen, why, and what was rejected?
    2. What breaks or surprises people here — gotchas, past incidents?
    3. Which external constraints bind us (vendor limits, compliance,
       platform quirks)?
    4. Which domain terms have a project-specific meaning?

  Apply the derivability test to every candidate fact: if you could learn it
  by reading the repo, do NOT file it. Aim for 5-10 pages total.

  File each fact with: npx loredown new <kind> <slug> --agent <your-tool>
  --task seed — then fill the TODOs (body under 40 non-blank lines; anchor
  claims to repo-relative path + short sha of HEAD, or url + accessed date).

  Finish with: npx loredown index && npx loredown lint (fix any errors),
  append "## [<date>] seed | lore | <actor>/<your-tool>" to
  lore/log/<YYYY-MM>.md, and open a PR for the team to review.`;

export interface InitResult {
  created: string[];
  error?: string;
}

export function initLore(cwd: string, dryRun: boolean, month: string): InitResult {
  const loreDir = join(cwd, "lore");
  if (existsSync(join(loreDir, "config.yaml"))) {
    return { created: [], error: "lore/config.yaml already exists here — nothing to do" };
  }
  const files: [string, string][] = [
    ["config.yaml", CONFIG_TEMPLATE],
    ["index.md", generateIndex(DEFAULT_CONFIG, [])],
    [`log/${month}.md`, `# Lore log — ${month}\n`],
    ["pages/.gitkeep", ""],
  ];
  if (!dryRun) {
    for (const [rel, content] of files) {
      const path = join(loreDir, rel);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    }
  }
  return { created: files.map(([rel]) => `lore/${rel}`) };
}
