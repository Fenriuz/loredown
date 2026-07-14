import { VERSION } from "./version.js";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export const COMMANDS = ["init", "lint", "index", "drift", "trace"] as const;
export type Command = (typeof COMMANDS)[number];

const USAGE = `loredown ${VERSION} — your repo's institutional memory, maintained by coding agents.

Usage: loredown <command> [options]

Commands:
  init    Create lore/ in the current repo (with --seed: guided bootstrap)
  lint    Validate pages: schema, links, budgets, content rules, secrets
  index   Deterministically rebuild lore/index.md
  drift   Flag pages whose source anchors changed since last verification
  trace   Show a page's provenance: who wrote it, from which task and sources

Options:
  -h, --help       Show this help
  -v, --version    Show version

Every command supports --dry-run, --verbose and --json.
Status: pre-release. Commands land in Phase 2 — design lives in SPEC.md.`;

// Exit codes: 0 ok · 1 findings (lint/drift) · 2 usage error · 3 not implemented yet
export function run(argv: readonly string[]): RunResult {
  const args = argv.filter((a) => a.length > 0);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    return { code: 0, stdout: USAGE, stderr: "" };
  }
  if (args.includes("--version") || args.includes("-v")) {
    return { code: 0, stdout: VERSION, stderr: "" };
  }
  const command = args[0] as string;
  if ((COMMANDS as readonly string[]).includes(command)) {
    return {
      code: 3,
      stdout: "",
      stderr: `loredown ${command}: not implemented yet — arrives in Phase 2 (see SPEC.md, "CLI surface").`,
    };
  }
  return {
    code: 2,
    stdout: "",
    stderr: `Unknown command: ${command}\nRun "loredown --help" for usage.`,
  };
}
