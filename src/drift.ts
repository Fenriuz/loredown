import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { type Finding, sortFindings } from "./findings.js";
import {
  blobAt,
  commitsTouchingSince,
  git,
  pathExistsAtHead,
  repoRoot,
  shaResolvable,
  treeEntry,
} from "./git.js";
import type { LoadResult } from "./load.js";
import { extractSection } from "./section.js";

/**
 * The verdict for one path source, shared by `drift` (maps to findings) and
 * `trace` (maps to display strings) — the two must never disagree about the
 * same anchor.
 */
export type PathSourceStatus =
  | { kind: "sha-unresolvable" }
  | { kind: "gone" }
  | { kind: "untracked" }
  | { kind: "compare-failed" }
  | { kind: "clean" }
  | { kind: "content-equal"; commits: number }
  | { kind: "diverged" }
  | { kind: "stale"; commits: number }
  | { kind: "section-ok"; commits: number }
  | { kind: "section-changed"; commits: number; section: string }
  | { kind: "section-missing-head"; section: string }
  | { kind: "section-missing-anchor"; section: string }
  | { kind: "section-file-missing-anchor"; section: string }
  | { kind: "section-ambiguous"; section: string; count: number };

/** Evaluate one path source against the repo at `gitCwd` (SPEC §9 order). */
export function pathSourceStatus(
  gitCwd: string,
  source: { path: string; sha: string; repo?: string; section?: string },
): PathSourceStatus {
  if (!shaResolvable(gitCwd, source.sha)) return { kind: "sha-unresolvable" };
  if (!pathExistsAtHead(gitCwd, source.path)) {
    return existsSync(join(gitCwd, source.path)) ? { kind: "untracked" } : { kind: "gone" };
  }

  // Anchor-side section validation comes FIRST: a broken section anchor must
  // never hide behind an unchanged file (SPEC §9).
  const section = source.section;
  let anchorRegion: string | null = null;
  if (section !== undefined) {
    const anchorText = blobAt(gitCwd, source.sha, source.path);
    if (anchorText === null) return { kind: "section-file-missing-anchor", section };
    const result = extractSection(anchorText, section);
    if (result.found === "none") return { kind: "section-missing-anchor", section };
    if (result.found === "many") return { kind: "section-ambiguous", section, count: result.count };
    anchorRegion = result.content;
  }

  const commits = commitsTouchingSince(gitCwd, source.sha, source.path);
  if (commits === null) return { kind: "compare-failed" };

  // Fast path: identical tree entries (mode + type + oid) mean nothing changed,
  // however many commits touched the path in between (reverts, merges).
  const anchorEntry = treeEntry(gitCwd, source.sha, source.path);
  const headEntry = treeEntry(gitCwd, "HEAD", source.path);
  if (anchorEntry !== null && headEntry !== null && anchorEntry === headEntry) {
    return commits === 0 ? { kind: "clean" } : { kind: "content-equal", commits };
  }
  if (commits === 0) return { kind: "diverged" };

  if (section !== undefined && anchorRegion !== null) {
    const headText = blobAt(gitCwd, "HEAD", source.path);
    if (headText !== null) {
      const result = extractSection(headText, section);
      if (result.found === "none") return { kind: "section-missing-head", section };
      if (result.found === "many")
        return { kind: "section-ambiguous", section, count: result.count };
      if (result.content === anchorRegion) return { kind: "section-ok", commits };
      return { kind: "section-changed", commits, section };
    }
  }
  return { kind: "stale", commits };
}

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
    source: { path: string; sha: string; repo?: string; section?: string },
  ): void => {
    const label = source.repo === undefined ? source.path : `${source.repo}:${source.path}`;
    const where = source.repo === undefined ? "this repository" : `repo "${source.repo}"`;
    const status = pathSourceStatus(gitCwd, source);
    switch (status.kind) {
      case "clean":
      case "content-equal":
      case "section-ok":
        return;
      case "sha-unresolvable":
        findings.push({
          level: "error",
          code: "SRC_SHA",
          file,
          message: `source "${label}": sha ${source.sha} not found in ${where}`,
        });
        return;
      case "untracked":
        findings.push({
          level: "error",
          code: "SRC_UNTRACKED",
          file,
          message: `source "${label}" exists on disk but is not tracked in ${where} (nested repo or ignored path) — declare a repos: mapping or fix the anchor`,
        });
        return;
      case "gone":
        findings.push({
          level: "error",
          code: "SRC_GONE",
          file,
          message: `source "${label}" no longer exists at HEAD — the page's evidence is gone`,
        });
        return;
      case "compare-failed":
        findings.push({
          level: "error",
          code: "SRC_SHA",
          file,
          message: `source "${label}": git could not compare ${source.sha}..HEAD`,
        });
        return;
      case "diverged":
        findings.push({
          level: "warn",
          code: "SRC_STALE",
          file,
          message: `may be stale — "${label}" differs from the anchor but no commits connect ${source.sha} to HEAD — is the anchor on this lineage?`,
        });
        return;
      case "stale":
        findings.push({
          level: "warn",
          code: "SRC_STALE",
          file,
          message: `may be stale — ${status.commits} commit${status.commits === 1 ? "" : "s"} touched "${label}" since verification (${source.sha}); re-verify and bump the sha`,
        });
        return;
      case "section-changed":
        findings.push({
          level: "warn",
          code: "SRC_STALE",
          file,
          message: `may be stale — section "${status.section}" of "${label}" changed since verification (${source.sha}); re-verify and bump the sha`,
        });
        return;
      case "section-missing-head":
        findings.push({
          level: "warn",
          code: "SRC_SECTION",
          file,
          message: `section "${status.section}" no longer found in "${label}" — renamed or removed; re-verify and update the anchor`,
        });
        return;
      case "section-missing-anchor":
        findings.push({
          level: "error",
          code: "SRC_SECTION",
          file,
          message: `section "${status.section}" was never present in "${label}" at the anchored sha (${source.sha}) — fix the anchor`,
        });
        return;
      case "section-file-missing-anchor":
        findings.push({
          level: "error",
          code: "SRC_SECTION",
          file,
          message: `source "${label}" is not a file at the anchored sha (${source.sha}) — fix the anchor (sha or path)`,
        });
        return;
      case "section-ambiguous":
        findings.push({
          level: "warn",
          code: "SRC_SECTION",
          file,
          message: `section "${status.section}" occurs ${status.count} times in "${label}" — ambiguous; cite a unique heading`,
        });
        return;
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
