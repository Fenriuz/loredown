import { execFileSync } from "node:child_process";

export interface GitResult {
  ok: boolean;
  stdout: string;
}

export function git(cwd: string, args: string[]): GitResult {
  try {
    const stdout = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, stdout };
  } catch {
    return { ok: false, stdout: "" };
  }
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
