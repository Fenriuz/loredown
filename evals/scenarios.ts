import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { driftLore } from "../src/drift.js";
import { generateIndex } from "../src/index-gen.js";
import { lintLore } from "../src/lint.js";
import { loadLore } from "../src/load.js";
import {
  type Check,
  check,
  commitAll,
  fixtureEntryBlock,
  git,
  makeRepo,
  writeFileIn,
} from "./harness.js";

export interface Ctx {
  baselineIds: string[];
  baselineLogEntries: number;
  [key: string]: unknown;
}

export interface Scenario {
  name: string;
  description: string;
  /** Mutating scenarios get Bash(loredown/git) and are judged on new pages. */
  mutating: boolean;
  judgeNewPages: boolean;
  build(dir: string): Ctx;
  prompt(dir: string, ctx: Ctx): string;
  assert(dir: string, ctx: Ctx, output: string): Check[];
}

const FIXTURE_CONFIG = `schema_version: 1
budgets:
  page_body_lines: 40
  pages_per_task: 3
scan:
  instructions: warn
  secrets: error
kinds: []
`;

interface PageSpec {
  id: string;
  title: string;
  kind: string;
  body: string;
  created: string;
  updated: string;
  source: { path: string; sha: string } | { url: string; accessed: string };
}

function pageText(spec: PageSpec): string {
  const source =
    "path" in spec.source
      ? `  - path: ${spec.source.path}\n    sha: ${spec.source.sha}`
      : `  - url: ${spec.source.url}\n    accessed: ${spec.source.accessed}`;
  return [
    "---",
    `id: ${spec.id}`,
    `title: ${spec.title}`,
    `kind: ${spec.kind}`,
    "status: active",
    `created: ${spec.created}`,
    `updated: ${spec.updated}`,
    "provenance:",
    "  agent: human",
    "  actor: eval",
    "  task: fixture",
    "sources:",
    source,
    "---",
    "",
    spec.body,
    "",
  ].join("\n");
}

function writeLore(dir: string, pages: PageSpec[]): void {
  // The CLI shim dir is harness plumbing — keep it out of `git status`.
  writeFileIn(dir, ".gitignore", ".loredown-bin/\n");
  writeFileIn(dir, "lore/config.yaml", FIXTURE_CONFIG);
  for (const page of pages) {
    writeFileIn(dir, `lore/pages/${page.id}.md`, pageText(page));
  }
  writeFileIn(
    dir,
    "lore/log/2026-08.md",
    "# Lore log — 2026-08\n\n## [2026-08-01] seed | lore | eval/human\nFixture seed.\n",
  );
  writeFileIn(dir, "AGENTS.md", `# Fixture repo\n\n${fixtureEntryBlock()}\n`);
  const load = loadLore(join(dir, "lore"));
  writeFileIn(dir, "lore/index.md", generateIndex(load.config, load.pages));
}

function totalLogEntries(dir: string): number {
  const logDir = join(dir, "lore/log");
  if (!existsSync(logDir)) return 0;
  let count = 0;
  for (const name of readdirSync(logDir)) {
    if (!name.endsWith(".md")) continue;
    count += readFileSync(join(logDir, name), "utf8")
      .split("\n")
      .filter((l) => l.startsWith("## [")).length;
  }
  return count;
}

const ingest: Scenario = {
  name: "ingest",
  description: "agent files a non-derivable discovery as lore and keeps the KB valid",
  mutating: true,
  judgeNewPages: true,
  build(dir) {
    writeFileIn(
      dir,
      "src/payments.ts",
      [
        "export interface Charge {",
        "  amountCents: number;",
        "  currency: string;",
        "}",
        "",
        "export async function createCharge(charge: Charge): Promise<string> {",
        "  // Sends the charge to the payment provider.",
        "  return `ch_${charge.amountCents}`;",
        "}",
        "",
      ].join("\n"),
    );
    writeLore(dir, [
      {
        id: "gotcha/flaky-e2e-checkout",
        title: "Checkout E2E flakes when run before noon UTC",
        kind: "gotcha",
        body: "## Symptom\nCI reruns needed most mornings.\n\n## Cause\nUpstream sandbox maintenance window.\n\n## What to do\nRe-run once before investigating.",
        created: "2026-08-01",
        updated: "2026-08-01",
        source: { url: "https://status.example.com", accessed: "2026-08-01" },
      },
    ]);
    commitAll(dir, "fixture: payments service with lore");
    return { baselineIds: ["gotcha/flaky-e2e-checkout"], baselineLogEntries: totalLogEntries(dir) };
  },
  prompt() {
    return [
      "You have just finished a coding task in this repository. Task summary:",
      "while fixing the checkout E2E test we discovered that our payment",
      "provider's TEST-MODE sandbox silently caps charge amounts at 999999",
      "cents — larger test charges succeed but with the amount capped instead",
      "of failing, which is documented nowhere and cost us half a day. We",
      "worked around it by keeping test fixtures below the cap.",
      "",
      "Now follow the 'Team knowledge base (lore/)' section of AGENTS.md and",
      "file what belongs in the knowledge base. The relevant code is",
      "src/payments.ts. Use --agent claude-code and --task 'PR #42' when",
      "scaffolding pages. When you are done, `loredown lint` must report no",
      "errors and the index must be up to date.",
      "",
      "The loredown CLI is already on your PATH — invoke it as plain",
      "`loredown <command>`.",
    ].join("\n");
  },
  assert(dir, ctx) {
    const checks: Check[] = [];
    const load = loadLore(join(dir, "lore"));
    const findings = lintLore(load);
    const errors = findings.filter((f) => f.level === "error");
    checks.push(
      check(
        "lint reports zero errors",
        errors.length === 0,
        errors.map((f) => `${f.code} ${f.file}`).join("; "),
      ),
    );
    const index = readFileSync(join(dir, "lore/index.md"), "utf8");
    checks.push(
      check("index matches regeneration", index === generateIndex(load.config, load.pages)),
    );
    const newPages = load.pages.filter((p) => !ctx.baselineIds.includes(p.id));
    checks.push(
      check(
        "files 1-3 new pages",
        newPages.length >= 1 && newPages.length <= 3,
        `${newPages.length} new pages`,
      ),
    );
    checks.push(
      check(
        "a new page captures the discovery",
        newPages.some((p) =>
          /999999|9,?999\.99|sandbox.*cap|cap.*sandbox/i.test(`${p.title}\n${p.body}`),
        ),
        newPages.map((p) => p.id).join(", "),
      ),
    );
    checks.push(check("log entry appended", totalLogEntries(dir) > ctx.baselineLogEntries));
    checks.push(
      check(
        "baseline page preserved",
        load.pages.some((p) => p.id === "gotcha/flaky-e2e-checkout"),
      ),
    );
    return checks;
  },
};

const driftReverify: Scenario = {
  name: "drift",
  description: "agent re-verifies a stale page against changed source and bumps the anchor",
  mutating: true,
  judgeNewPages: false,
  build(dir) {
    writeFileIn(dir, "src/payments.ts", "export const RETRY_LIMIT = 3;\n");
    const sha1 = commitAll(dir, "payments: retry limit");
    writeLore(dir, [
      {
        id: "constraint/psp-retry-limit",
        title: "Payment provider allows at most 3 retries per charge",
        kind: "constraint",
        body: "## The constraint\nThe provider rejects a charge after 3 retry attempts; `RETRY_LIMIT` mirrors this ceiling.\n\n## Origin\nProvider support ticket, 2026-07.\n\n## Implications\nKeep `RETRY_LIMIT` in sync with the provider contract.",
        created: "2026-08-01",
        updated: "2026-08-01",
        source: { path: "src/payments.ts", sha: sha1 },
      },
    ]);
    commitAll(dir, "add lore");
    writeFileIn(dir, "src/payments.ts", "export const RETRY_LIMIT = 5;\n");
    commitAll(dir, "provider raised the retry ceiling to 5");
    return {
      baselineIds: ["constraint/psp-retry-limit"],
      baselineLogEntries: totalLogEntries(dir),
      oldSha: sha1,
    };
  },
  prompt() {
    return [
      "Run `loredown drift` in this repository. For every page it flags,",
      "re-read the anchored source files and update the page so its claims",
      "match current reality. Bump each re-verified source sha to the current",
      "HEAD short sha and set the page's `updated` date to today, following",
      "the conventions in AGENTS.md. Add an update log entry. When you are",
      "done, `loredown drift`, `loredown index` and `loredown lint` must all",
      "be clean.",
      "",
      "The loredown CLI is already on your PATH — invoke it as plain",
      "`loredown <command>`.",
    ].join("\n");
  },
  assert(dir, ctx) {
    const checks: Check[] = [];
    const load = loadLore(join(dir, "lore"));
    const drift = driftLore(load, dir);
    checks.push(
      check(
        "drift clean after re-verification",
        drift.length === 0,
        drift.map((f) => f.code).join("; "),
      ),
    );
    const findings = lintLore(load).filter((f) => f.level === "error");
    checks.push(check("lint reports zero errors", findings.length === 0));
    const page = load.pages.find((p) => p.id === "constraint/psp-retry-limit");
    checks.push(check("page still exists", page !== undefined));
    if (page !== undefined) {
      checks.push(check("claim reflects the new limit", /5/.test(`${page.title}\n${page.body}`)));
      const source = page.sources[0];
      checks.push(
        check(
          "anchor sha bumped",
          source !== undefined && "sha" in source && source.sha !== ctx.oldSha,
        ),
      );
      checks.push(check("updated date bumped", page.updated > page.created));
    }
    return checks;
  },
};

const query: Scenario = {
  name: "query",
  description: "agent answers from the lore with citations and without mutating the repo",
  mutating: false,
  judgeNewPages: false,
  build(dir) {
    writeFileIn(dir, "src/db/pool.ts", "export const POOL_SIZE = 10;\n");
    writeLore(dir, [
      {
        id: "gotcha/pg-pool-timeout",
        title: "Pool exhaustion looks like random 30s hangs",
        kind: "gotcha",
        body: "## Symptom\nRequests hang for ~30 seconds and then fail under load.\n\n## Cause\nDefault pool size is 10; long transactions starve it.\n\n## What to do\nCheck for long-running transactions before raising the pool size.",
        created: "2026-08-01",
        updated: "2026-08-01",
        source: { path: "src/db/pool.ts", sha: "0000000" },
      },
      {
        id: "glossary/ledger",
        title: "Ledger",
        kind: "glossary",
        body: "The append-only record of balance mutations; never updated in place.",
        created: "2026-08-01",
        updated: "2026-08-01",
        source: { url: "https://example.com/glossary", accessed: "2026-08-01" },
      },
    ]);
    commitAll(dir, "fixture: db service with lore");
    return {
      baselineIds: ["gotcha/pg-pool-timeout", "glossary/ledger"],
      baselineLogEntries: totalLogEntries(dir),
    };
  },
  prompt() {
    return [
      "Using this repository's team knowledge base as described in AGENTS.md,",
      "answer this question: why do requests hang for about 30 seconds under",
      "load, and what should be checked first? Cite the page ids you used in",
      "[[kind/slug]] form. Do not modify any files.",
    ].join("\n");
  },
  assert(dir, _ctx, output) {
    return [
      check("cites the pool gotcha page", output.includes("[[gotcha/pg-pool-timeout]]")),
      check("answer mentions the pool", /pool/i.test(output)),
      check("repo untouched", git(dir, ["status", "--porcelain"]) === ""),
    ];
  },
};

export const SCENARIOS: Scenario[] = [ingest, driftReverify, query];
export { makeRepo };
