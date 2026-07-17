import { basename } from "node:path";
import { type Finding, sortFindings } from "./findings.js";
import { commitsTouchingSince, git, pathExistsAtHead, repoRoot, shaResolvable } from "./git.js";
import type { LoadResult } from "./load.js";

/**
 * Drift checks (SPEC §9): for every path source of every active page, verify the
 * anchor still resolves and report commits touching it since verification.
 * Never mutates anchors — re-verification is a judgment call.
 */
export function driftLore(load: LoadResult, cwd: string): Finding[] {
  const findings: Finding[] = [];
  const displayOf = (file: string) => `${basename(load.loreDir)}/${file}`;

  const root = repoRoot(cwd);
  if (root === null) {
    return [
      {
        level: "error",
        code: "GIT_REPO",
        file: displayOf(""),
        message: "not inside a git repository — drift compares source anchors against git history",
      },
    ];
  }
  if (!git(root, ["rev-parse", "--verify", "--quiet", "HEAD"]).ok) {
    return [
      {
        level: "error",
        code: "GIT_HEAD",
        file: displayOf(""),
        message: "repository has no commits yet — drift needs a HEAD to compare against",
      },
    ];
  }

  for (const page of load.pages) {
    if (page.status !== "active") continue;
    const file = displayOf(page.file);
    for (const source of page.sources) {
      if (!("path" in source)) continue; // URL sources are not drift-checked in v0.1.
      if (!shaResolvable(root, source.sha)) {
        findings.push({
          level: "error",
          code: "SRC_SHA",
          file,
          message: `source "${source.path}": sha ${source.sha} not found in this repository`,
        });
        continue;
      }
      if (!pathExistsAtHead(root, source.path)) {
        findings.push({
          level: "error",
          code: "SRC_GONE",
          file,
          message: `source "${source.path}" no longer exists at HEAD — the page's evidence is gone`,
        });
        continue;
      }
      const commits = commitsTouchingSince(root, source.sha, source.path);
      if (commits === null) {
        findings.push({
          level: "error",
          code: "SRC_SHA",
          file,
          message: `source "${source.path}": git could not compare ${source.sha}..HEAD`,
        });
      } else if (commits > 0) {
        findings.push({
          level: "warn",
          code: "SRC_STALE",
          file,
          message: `may be stale — ${commits} commit${commits === 1 ? "" : "s"} touched "${source.path}" since verification (${source.sha}); re-verify and bump the sha`,
        });
      }
    }
  }

  return sortFindings(findings);
}
