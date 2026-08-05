import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { type Finding, sortFindings } from "./findings.js";
import { commitsTouchingSince, git, pathExistsAtHead, repoRoot, shaResolvable } from "./git.js";
import type { LoadResult } from "./load.js";

export interface DriftResult {
  findings: Finding[];
  /** Sources that could not be verified here (absent sibling checkout) — reported, never findings. */
  skipped: { repo: string; checkout: string; count: number }[];
}

type RepoState =
  | { state: "ok"; checkout: string }
  | { state: "missing"; checkout: string }
  | { state: "not-git"; checkout: string };

/**
 * Drift checks (SPEC §9): for every path source of every active page, verify the
 * anchor still resolves and report commits touching it since verification.
 * Cross-repo sources (`repo:`) are verified inside the mapped sibling checkout;
 * an absent checkout is a skip, never a finding — "not verifiable here" is a
 * different fact from "the evidence is gone". Never mutates anchors.
 */
export function driftLore(load: LoadResult, cwd: string): DriftResult {
  const findings: Finding[] = [];
  const displayOf = (file: string) => `${basename(load.loreDir)}/${file}`;

  const root = repoRoot(cwd);
  if (root === null) {
    return {
      findings: [
        {
          level: "error",
          code: "GIT_REPO",
          file: displayOf(""),
          message:
            "not inside a git repository — drift compares source anchors against git history",
        },
      ],
      skipped: [],
    };
  }
  if (!git(root, ["rev-parse", "--verify", "--quiet", "HEAD"]).ok) {
    return {
      findings: [
        {
          level: "error",
          code: "GIT_HEAD",
          file: displayOf(""),
          message: "repository has no commits yet — drift needs a HEAD to compare against",
        },
      ],
      skipped: [],
    };
  }

  // Resolve each declared sibling checkout once (relative to the lore's parent).
  const repoBase = dirname(load.loreDir);
  const repoStates = new Map<string, RepoState>();
  const stateOf = (name: string): RepoState | null => {
    const rel = load.config.repos[name];
    if (rel === undefined) return null;
    let cached = repoStates.get(name);
    if (cached === undefined) {
      const checkout = resolve(repoBase, rel);
      if (!existsSync(checkout)) cached = { state: "missing", checkout };
      else if (!git(checkout, ["rev-parse", "--git-dir"]).ok)
        cached = { state: "not-git", checkout };
      else cached = { state: "ok", checkout };
      repoStates.set(name, cached);
      if (cached.state === "not-git") {
        findings.push({
          level: "error",
          code: "SRC_REPO",
          file: displayOf("config.yaml"),
          message: `repos.${name}: "${rel}" exists but is not a git repository`,
        });
      }
    }
    return cached;
  };

  const skipCounts = new Map<string, { checkout: string; count: number }>();
  const horizon = load.config.budgets.urlAccessedMaxAgeDays;
  const now = Date.now();

  const checkPathSource = (
    gitCwd: string,
    file: string,
    source: { path: string; sha: string; repo?: string },
  ): void => {
    const label = source.repo === undefined ? source.path : `${source.repo}:${source.path}`;
    if (!shaResolvable(gitCwd, source.sha)) {
      findings.push({
        level: "error",
        code: "SRC_SHA",
        file,
        message: `source "${label}": sha ${source.sha} not found in ${
          source.repo === undefined ? "this repository" : `repo "${source.repo}"`
        }`,
      });
      return;
    }
    if (!pathExistsAtHead(gitCwd, source.path)) {
      if (existsSync(join(gitCwd, source.path))) {
        findings.push({
          level: "error",
          code: "SRC_UNTRACKED",
          file,
          message: `source "${label}" exists on disk but is not tracked in ${
            source.repo === undefined ? "this repository" : `repo "${source.repo}"`
          } (nested repo or ignored path) — declare a repos: mapping or fix the anchor`,
        });
      } else {
        findings.push({
          level: "error",
          code: "SRC_GONE",
          file,
          message: `source "${label}" no longer exists at HEAD — the page's evidence is gone`,
        });
      }
      return;
    }
    const commits = commitsTouchingSince(gitCwd, source.sha, source.path);
    if (commits === null) {
      findings.push({
        level: "error",
        code: "SRC_SHA",
        file,
        message: `source "${label}": git could not compare ${source.sha}..HEAD`,
      });
    } else if (commits > 0) {
      findings.push({
        level: "warn",
        code: "SRC_STALE",
        file,
        message: `may be stale — ${commits} commit${commits === 1 ? "" : "s"} touched "${label}" since verification (${source.sha}); re-verify and bump the sha`,
      });
    }
  };

  for (const page of load.pages) {
    if (page.status !== "active") continue;
    const file = displayOf(page.file);
    for (const source of page.sources) {
      if ("url" in source) {
        if (horizon > 0) {
          const accessed = Date.parse(source.accessed);
          const ageDays = Math.floor((now - accessed) / 86_400_000);
          if (Number.isFinite(accessed) && ageDays > horizon) {
            findings.push({
              level: "warn",
              code: "URL_STALE",
              file,
              message: `external evidence "${source.url}" last checked ${ageDays} days ago (horizon ${horizon}) — re-verify and bump accessed`,
            });
          }
        }
        continue;
      }
      if (source.repo !== undefined) {
        const state = stateOf(source.repo);
        if (state === null) {
          findings.push({
            level: "error",
            code: "SRC_REPO",
            file,
            message: `source "${source.path}": repo "${source.repo}" is not declared in config.repos`,
          });
          continue;
        }
        if (state.state === "missing") {
          const entry = skipCounts.get(source.repo) ?? { checkout: state.checkout, count: 0 };
          entry.count++;
          skipCounts.set(source.repo, entry);
          continue;
        }
        if (state.state === "not-git") continue; // reported once at config level
        checkPathSource(state.checkout, file, source);
        continue;
      }
      checkPathSource(root, file, source);
    }
  }

  return {
    findings: sortFindings(findings),
    skipped: [...skipCounts.entries()]
      .map(([repo, { checkout, count }]) => ({ repo, checkout, count }))
      .sort((a, b) => (a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : 0)),
  };
}
