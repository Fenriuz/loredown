import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ENTRY_BLOCK } from "../src/adapters.js";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

let distBuilt = false;
function ensureBuilt(): void {
  if (distBuilt) return;
  execFileSync("npm", ["run", "build"], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "ignore", "pipe"],
  });
  distBuilt = true;
}

export interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

export function check(name: string, ok: boolean, detail?: string): Check {
  return detail === undefined ? { name, ok } : { name, ok, detail };
}

export function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
  }).trim();
}

export function makeRepo(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `loredown-eval-${label}-`));
  git(dir, ["init", "-b", "main"]);
  git(dir, ["config", "user.email", "eval@loredown.local"]);
  git(dir, ["config", "user.name", "Eval"]);
  return dir;
}

export function writeFileIn(dir: string, rel: string, content: string): void {
  const path = join(dir, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

export function commitAll(dir: string, message: string): string {
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-m", message]);
  return git(dir, ["rev-parse", "--short", "HEAD"]);
}

/** The entry block for eval fixtures — plain `loredown` (the shim), not the pinned `npx loredown@x.y.z` (SPEC §12) real installs write: the sandbox provides the CLI on PATH. */
export function fixtureEntryBlock(): string {
  return ENTRY_BLOCK.replace(/npx loredown(@\S+)?/g, "loredown");
}

/**
 * Install a self-contained `loredown` into the fixture so the sandboxed agent
 * needs nothing outside its own working directory: the built dist/ (zero
 * runtime deps) is copied in and run with the system `node`.
 */
export function installBin(dir: string): string {
  ensureBuilt();
  const binDir = join(dir, ".loredown-bin");
  mkdirSync(binDir, { recursive: true });
  cpSync(join(REPO_ROOT, "dist"), join(binDir, "dist"), { recursive: true });
  writeFileSync(join(binDir, "dist/package.json"), '{"type":"module"}\n');
  const shim = join(binDir, "loredown");
  writeFileSync(shim, `#!/bin/sh\nexec node "${binDir}/dist/cli.js" "$@"\n`);
  chmodSync(shim, 0o755);
  return binDir;
}

export interface AgentRunOptions {
  binDir?: string;
  model?: string;
  timeoutMs?: number;
  /** Grant Bash for loredown/git (scoped) — needed by mutating scenarios. */
  allowBash?: boolean;
}

export interface AgentRunResult {
  output: string;
  failed: boolean;
  error?: string;
}

export function claudeAvailable(): boolean {
  try {
    execFileSync("claude", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run Claude Code headless in the fixture. Permissions stay scoped: acceptEdits
 * for file changes plus explicitly allowed Bash patterns — never bypassPermissions.
 */
export function runAgent(cwd: string, prompt: string, opts: AgentRunOptions = {}): AgentRunResult {
  const args = ["-p", prompt, "--permission-mode", "acceptEdits"];
  if (opts.allowBash === true) {
    // Cover every invocation form agents reach for: bare (on PATH), shim path, direct node.
    args.push(
      "--allowedTools",
      "Bash(loredown:*),Bash(./.loredown-bin/loredown:*),Bash(node ./.loredown-bin/dist/cli.js:*),Bash(git:*)",
    );
  }
  const model = opts.model ?? process.env.LOREDOWN_EVAL_MODEL;
  if (model !== undefined && model !== "") args.push("--model", model);
  const pathEnv =
    opts.binDir === undefined ? process.env.PATH : `${opts.binDir}:${process.env.PATH ?? ""}`;
  try {
    const output = execFileSync("claude", args, {
      cwd,
      encoding: "utf8",
      timeout: opts.timeoutMs ?? Number(process.env.LOREDOWN_EVAL_TIMEOUT_MS ?? 300_000),
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PATH: pathEnv,
        // Keep eval runs out of the operator's auto-memory.
        CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
      },
    });
    return { output, failed: false };
  } catch (e) {
    const err = e as { stdout?: string; message?: string };
    return {
      output: typeof err.stdout === "string" ? err.stdout : "",
      failed: true,
      error: err.message ?? String(e),
    };
  }
}

/** Extract the first JSON object from model output. */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

const JUDGE_RULE = `You are auditing one page of a team knowledge base for a rule violation.
RULE: a page's SUBSTANCE must be knowledge that could NOT be derived by reading
the repository itself. Allowed: decisions with their why, failed approaches,
external constraints (vendor/platform behavior), gotchas learned from
experience, domain terms.
A page VIOLATES the rule only when its core claims are derivable — it restates
what the code does, catalogs the file layout, or documents behavior fully
visible in the source. Incidental references to files or functions that anchor
a non-derivable fact (e.g. "this cap bites in createCharge") are NOT
violations — the schema requires claims to be anchored to code locations.`;

/** LLM judge for the derivability rule. Returns null when the verdict is unparseable. */
export function judgeDerivability(
  repoFiles: { path: string; content: string }[],
  pageText: string,
  model?: string,
): { violates: boolean; reason: string } | null {
  const files = repoFiles.map((f) => `--- ${f.path} ---\n${f.content}`).join("\n");
  const prompt = `${JUDGE_RULE}

REPOSITORY FILES:
${files}

PAGE UNDER AUDIT:
${pageText}

Answer with ONLY a JSON object: {"violates": true|false, "reason": "<one sentence>"}`;
  const result = runAgent(process.cwd(), prompt, {
    timeoutMs: 120_000,
    ...(model === undefined ? {} : { model }),
  });
  if (result.failed) return null;
  const parsed = extractJson(result.output);
  if (parsed === null || typeof parsed !== "object") return null;
  const obj = parsed as { violates?: unknown; reason?: unknown };
  if (typeof obj.violates !== "boolean") return null;
  return { violates: obj.violates, reason: typeof obj.reason === "string" ? obj.reason : "" };
}
