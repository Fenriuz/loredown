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

export const SEED_GUIDE = `Guided bootstrap (Phase 4 will automate this; for now, paste this to your coding agent):

  Read lore/config.yaml. This repo keeps a team knowledge base in lore/:
  one markdown file per fact under lore/pages/<kind>/ (kinds: decision,
  constraint, gotcha, incident, glossary, map) with frontmatter fields
  id, title, kind, status, created, updated, provenance{agent,actor,task}
  and sources (path+sha or url+accessed). Interview me about this repo's
  NON-DERIVABLE knowledge — decisions and their why, failed approaches,
  external constraints, gotchas, domain terms — and file the first 5-10
  pages. Only include knowledge you could NOT derive by reading the repo.
  Then run: npx loredown index && npx loredown lint`;

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
