import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { driftLore } from "./drift.js";
import { type Finding, formatHuman, formatJson, summarize } from "./findings.js";
import { generateIndex } from "./index-gen.js";
import { initLore, SEED_GUIDE } from "./init.js";
import { lintLore } from "./lint.js";
import { findLoreDir, type LoadResult, loadLore } from "./load.js";
import { newPage } from "./new.js";
import { tracePage } from "./trace.js";
import { VERSION } from "./version.js";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export const COMMANDS = ["init", "new", "lint", "index", "drift", "trace"] as const;

const USAGE = `loredown ${VERSION} — your repo's institutional memory, maintained by coding agents.

Usage: loredown <command> [options]

Commands:
  init [--seed]        Create lore/ in the current directory
  new <kind> <slug>    Scaffold a page with prefilled frontmatter
  lint                 Validate pages: schema, links, budgets, content rules, secrets
  index [--check]      Deterministically rebuild lore/index.md (--check: verify only)
  drift                Flag pages whose source anchors changed since verification
  trace <id>           Show a page's provenance, sources, inbound links, log mentions

Options:
  --lore <path>        Explicit lore directory (default: walk up from cwd)
  --json               Machine-readable output
  --dry-run            Print what would change without writing
  --verbose            More detail
  --agent <name>       (new) provenance agent, default "human"
  --task <text>        (new) provenance task, default "TODO"
  -h, --help           Show this help
  -v, --version        Show version

Exit codes: 0 ok (warnings allowed) · 1 errors/stale · 2 usage error
The design is SPEC.md; the CLI performs no network I/O.`;

interface Flags {
  json: boolean;
  verbose: boolean;
  dryRun: boolean;
  check: boolean;
  seed: boolean;
  lore?: string;
  agent: string;
  task: string;
}

function parseArgs(argv: readonly string[]): { flags: Flags; positional: string[] } | string {
  const flags: Flags = {
    json: false,
    verbose: false,
    dryRun: false,
    check: false,
    seed: false,
    agent: "human",
    task: "TODO",
  };
  const positional: string[] = [];
  const args = argv.filter((a) => a.length > 0);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    switch (arg) {
      case "--json":
        flags.json = true;
        break;
      case "--verbose":
        flags.verbose = true;
        break;
      case "--dry-run":
        flags.dryRun = true;
        break;
      case "--check":
        flags.check = true;
        break;
      case "--seed":
        flags.seed = true;
        break;
      case "--lore":
      case "--agent":
      case "--task": {
        const value = args[++i];
        if (value === undefined) return `${arg} requires a value`;
        if (arg === "--lore") flags.lore = value;
        else if (arg === "--agent") flags.agent = value;
        else flags.task = value;
        break;
      }
      default:
        if (arg.startsWith("-")) return `unknown option: ${arg}`;
        positional.push(arg);
    }
  }
  return { flags, positional };
}

function usageError(message: string): RunResult {
  return { code: 2, stdout: "", stderr: `${message}\nRun "loredown --help" for usage.` };
}

function requireLore(cwd: string, flags: Flags): { load: LoadResult } | RunResult {
  const loreDir = findLoreDir(cwd, flags.lore);
  if (loreDir === null) {
    return usageError(
      flags.lore === undefined
        ? "no lore/ found (walked up from the current directory) — run: npx loredown init"
        : `no config.yaml in --lore path "${flags.lore}"`,
    );
  }
  return { load: loadLore(loreDir) };
}

function findingsResult(findings: Finding[], flags: Flags, failOnWarn: boolean): RunResult {
  const summary = summarize(findings);
  const failed = failOnWarn ? findings.length > 0 : summary.errors > 0;
  return {
    code: failed ? 1 : 0,
    stdout: flags.json ? formatJson(findings) : formatHuman(findings),
    stderr: "",
  };
}

export function run(argv: readonly string[], cwd = process.cwd()): RunResult {
  const args = argv.filter((a) => a.length > 0);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    return { code: 0, stdout: USAGE, stderr: "" };
  }
  if (args.includes("--version") || args.includes("-v")) {
    return { code: 0, stdout: VERSION, stderr: "" };
  }

  const parsed = parseArgs(argv);
  if (typeof parsed === "string") return usageError(parsed);
  const { flags, positional } = parsed;

  const command = positional[0];
  if (command === undefined) return { code: 0, stdout: USAGE, stderr: "" };

  switch (command) {
    case "init": {
      const month = new Date().toISOString().slice(0, 7);
      const result = initLore(cwd, flags.dryRun, month);
      if (result.error !== undefined) return usageError(result.error);
      const verb = flags.dryRun ? "would create" : "created";
      const lines = result.created.map((f) => `${verb} ${f}`);
      if (flags.seed) lines.push("", SEED_GUIDE);
      return { code: 0, stdout: lines.join("\n"), stderr: "" };
    }

    case "new": {
      const kind = positional[1];
      const slug = positional[2];
      if (kind === undefined || slug === undefined) {
        return usageError("usage: loredown new <kind> <slug>");
      }
      const located = requireLore(cwd, flags);
      if ("code" in located) return located;
      const { load } = located;
      const today = new Date().toISOString().slice(0, 10);
      const result = newPage(load.loreDir, load.config, kind, slug, {
        agent: flags.agent,
        task: flags.task,
        cwd,
        dryRun: flags.dryRun,
        today,
      });
      if (result.error !== undefined) return usageError(result.error);
      const lines = flags.dryRun
        ? [`would create ${result.file}`, "", result.content ?? ""]
        : [
            `created ${result.file}`,
            "fill the TODOs, then run: npx loredown index && npx loredown lint",
          ];
      return { code: 0, stdout: lines.join("\n"), stderr: "" };
    }

    case "lint": {
      const located = requireLore(cwd, flags);
      if ("code" in located) return located;
      const { load } = located;
      const findings = lintLore(load);
      const result = findingsResult(findings, flags, false);
      if (flags.verbose && !flags.json) {
        result.stdout = `checked ${load.pages.length} page${load.pages.length === 1 ? "" : "s"} in ${basename(load.loreDir)}/\n${result.stdout}`;
      }
      return result;
    }

    case "index": {
      const located = requireLore(cwd, flags);
      if ("code" in located) return located;
      const { load } = located;
      if (load.schemaTooNew) return findingsResult(load.findings, flags, false);
      const fresh = generateIndex(load.config, load.pages);
      const indexPath = join(load.loreDir, "index.md");
      const current = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : null;
      const upToDate = current === fresh;
      if (flags.check) {
        return {
          code: upToDate ? 0 : 1,
          stdout: upToDate
            ? "lore/index.md is up to date"
            : "lore/index.md is stale — run: npx loredown index",
          stderr: "",
        };
      }
      if (upToDate) return { code: 0, stdout: "lore/index.md already up to date", stderr: "" };
      if (flags.dryRun) {
        const preview = flags.verbose ? `\n${fresh}` : "";
        return {
          code: 0,
          stdout: `would write lore/index.md (${Buffer.byteLength(fresh)} bytes)${preview}`,
          stderr: "",
        };
      }
      writeFileSync(indexPath, fresh);
      const active = load.pages.filter((p) => p.status === "active").length;
      return {
        code: 0,
        stdout: `lore/index.md updated (${active} active page${active === 1 ? "" : "s"})`,
        stderr: "",
      };
    }

    case "drift": {
      const located = requireLore(cwd, flags);
      if ("code" in located) return located;
      // Drift findings are the command's entire point: any finding fails.
      return findingsResult(driftLore(located.load, cwd), flags, true);
    }

    case "trace": {
      const id = positional[1];
      if (id === undefined) return usageError("usage: loredown trace <page-id>");
      const located = requireLore(cwd, flags);
      if ("code" in located) return located;
      const report = tracePage(located.load, id, cwd);
      if (report === null) return usageError(`no page with id "${id}"`);
      return { code: 0, stdout: report.trimEnd(), stderr: "" };
    }

    default:
      return usageError(`Unknown command: ${command}`);
  }
}
