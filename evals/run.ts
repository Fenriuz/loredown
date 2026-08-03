/**
 * Agent eval harness (SPEC §18). Runs real Claude Code sessions against fixture
 * repos and asserts the invariants the schema promises. Deliberately NOT part of
 * `npm test`: it needs the `claude` CLI, credentials, minutes, and tokens.
 *
 *   npm run eval               # all scenarios
 *   npm run eval -- query      # one scenario
 *   npm run eval -- --no-judge # skip the LLM derivability judge
 *   npm run eval -- --keep     # keep fixture dirs (always kept on failure)
 *
 * Evals are probabilistic: agents vary between runs. A failed check always
 * prints its reason and keeps the fixture for inspection — read before
 * concluding the harness (or the schema) is at fault.
 */
import { readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadLore } from "../src/load.js";
import {
  type Check,
  check,
  claudeAvailable,
  installBin,
  judgeDerivability,
  runAgent,
} from "./harness.js";
import { makeRepo, SCENARIOS } from "./scenarios.js";

interface CliArgs {
  filters: string[];
  judge: boolean;
  keep: boolean;
  model?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { filters: [], judge: true, keep: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--no-judge") args.judge = false;
    else if (arg === "--keep") args.keep = true;
    else if (arg === "--model") {
      const value = argv[++i];
      if (value !== undefined) args.model = value;
    } else args.filters.push(arg);
  }
  return args;
}

function srcFiles(dir: string): { path: string; content: string }[] {
  const out: { path: string; content: string }[] = [];
  const walk = (rel: string): void => {
    const full = join(dir, rel);
    for (const entry of readdirSync(full)) {
      const childRel = `${rel}/${entry}`;
      if (statSync(join(dir, childRel)).isDirectory()) walk(childRel);
      else out.push({ path: childRel, content: readFileSync(join(dir, childRel), "utf8") });
    }
  };
  try {
    walk("src");
  } catch {
    /* no src dir */
  }
  return out;
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  if (!claudeAvailable()) {
    console.error("The `claude` CLI is required for evals (https://claude.com/claude-code).");
    return 2;
  }
  const scenarios = SCENARIOS.filter(
    (s) => args.filters.length === 0 || args.filters.includes(s.name),
  );
  if (scenarios.length === 0) {
    console.error(
      `No scenario matches [${args.filters.join(", ")}] — have: ${SCENARIOS.map((s) => s.name).join(", ")}`,
    );
    return 2;
  }

  let failedScenarios = 0;
  for (const scenario of scenarios) {
    console.log(`\n■ ${scenario.name} — ${scenario.description}`);
    const dir = makeRepo(scenario.name);
    const ctx = scenario.build(dir);
    const binDir = installBin(dir);
    const started = Date.now();
    const agent = runAgent(dir, scenario.prompt(dir, ctx), {
      binDir,
      allowBash: scenario.mutating,
      ...(args.model === undefined ? {} : { model: args.model }),
    });
    const seconds = Math.round((Date.now() - started) / 1000);

    const checks: Check[] = [
      check("agent run completed", !agent.failed, agent.error),
      ...(agent.failed ? [] : scenario.assert(dir, ctx, agent.output)),
    ];

    if (!agent.failed && scenario.judgeNewPages && args.judge) {
      const load = loadLore(join(dir, "lore"));
      const files = srcFiles(dir);
      for (const page of load.pages) {
        if (ctx.baselineIds.includes(page.id)) continue;
        const raw = readFileSync(join(load.loreDir, page.file), "utf8");
        const verdict = judgeDerivability(files, raw, args.model);
        if (verdict === null) {
          checks.push(check(`judge: ${page.id}`, true, "verdict unparseable — skipped"));
        } else {
          checks.push(
            check(`judge: ${page.id} is non-derivable`, !verdict.violates, verdict.reason),
          );
        }
      }
    }

    const failed = checks.filter((c) => !c.ok);
    for (const c of checks) {
      const mark = c.ok ? "✓" : "✗";
      const detail = c.detail !== undefined && c.detail !== "" ? `  (${c.detail})` : "";
      console.log(`  ${mark} ${c.name}${c.ok ? "" : detail}`);
    }
    console.log(`  — ${checks.length - failed.length}/${checks.length} checks, ${seconds}s`);

    if (failed.length > 0) {
      failedScenarios++;
      console.log(`  fixture kept at: ${dir}`);
      const tail = agent.output.split("\n").slice(-15).join("\n  | ");
      if (tail.trim() !== "") console.log(`  | ${tail}`);
    } else if (!args.keep) {
      rmSync(dir, { recursive: true, force: true });
    } else {
      console.log(`  fixture kept at: ${dir}`);
    }
  }

  console.log(`\n${scenarios.length - failedScenarios}/${scenarios.length} scenarios passed`);
  return failedScenarios === 0 ? 0 : 1;
}

process.exit(main());
