import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface GitResult {
  ok: boolean;
  stdout: string;
}

/**
 * Passed on every invocation (SPEC §16): git must never adopt a directory as a
 * repository just because it is laid out like a bare one — ordinary tracked
 * files can fake that layout, and git would then obey the `config` among them.
 * Command-line scope is protected configuration, so the directory itself
 * cannot override it. Honored by git >= 2.38; older git ignores the key, which
 * is why `isCheckout` does not rely on it.
 */
const HARDENING = ["-c", "safe.bareRepository=explicit"];

export function git(cwd: string, args: string[]): GitResult {
  try {
    const stdout = execFileSync("git", [...HARDENING, ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, stdout };
  } catch {
    return { ok: false, stdout: "" };
  }
}

/**
 * Whether `dir` is a checkout loredown may run git inside (SPEC §9, §16). It
 * must carry its own `.git` entry — a directory for a clone, a file for a
 * worktree or submodule. Git refuses to track any path named `.git`, so
 * repository content can never create one; it CAN create a bare-repository
 * layout (HEAD, config, objects/, refs/), whose config would name programs
 * for git to execute. Every `repos:` directory goes through this gate before
 * any git command runs in it.
 */
export function isCheckout(dir: string): boolean {
  return existsSync(join(dir, ".git")) && git(dir, ["rev-parse", "--git-dir"]).ok;
}

export function repoRoot(cwd: string): string | null {
  const result = git(cwd, ["rev-parse", "--show-toplevel"]);
  return result.ok ? result.stdout.trim() : null;
}

export function headShortSha(cwd: string): string | null {
  const result = git(cwd, ["rev-parse", "--short", "HEAD"]);
  return result.ok ? result.stdout.trim() : null;
}

export function userName(cwd: string): string | null {
  const result = git(cwd, ["config", "user.name"]);
  return result.ok ? result.stdout.trim() : null;
}

export function shaResolvable(cwd: string, sha: string): boolean {
  return git(cwd, ["rev-parse", "--verify", "--quiet", `${sha}^{commit}`]).ok;
}

export function pathExistsAtHead(cwd: string, path: string): boolean {
  return git(cwd, ["cat-file", "-e", `HEAD:${path}`]).ok;
}

/** Number of commits touching `path` since `sha` (exclusive). Null if git fails. */
export function commitsTouchingSince(cwd: string, sha: string, path: string): number | null {
  const result = git(cwd, ["log", "--format=%h", `${sha}..HEAD`, "--", path]);
  if (!result.ok) return null;
  const trimmed = result.stdout.trim();
  return trimmed === "" ? 0 : trimmed.split("\n").length;
}

/** The ls-tree entry ("<mode> <type> <oid>") for a path at a rev, or null when absent. */
export function treeEntry(cwd: string, rev: string, path: string): string | null {
  const result = git(cwd, ["ls-tree", rev, "--", path.replace(/\/+$/, "")]);
  if (!result.ok) return null;
  const line = result.stdout.split("\n", 1)[0] ?? "";
  if (line === "") return null;
  const tab = line.indexOf("\t");
  return tab === -1 ? line : line.slice(0, tab);
}

/**
 * Blob content at `rev:path`, or null when absent or not a blob. Always
 * `cat-file blob`, never `git show` — show applies textconv/diff drivers from
 * local git configuration, which would make verdicts machine-dependent (SPEC §9).
 */
export function blobAt(cwd: string, rev: string, path: string): string | null {
  const result = git(cwd, ["cat-file", "blob", `${rev}:${path.replace(/\/+$/, "")}`]);
  return result.ok ? result.stdout : null;
}
