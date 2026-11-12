import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathSourceStatus } from "./drift.js";
import { byteCompare } from "./findings.js";
import { isCheckout, repoRoot } from "./git.js";
import type { LoadResult } from "./load.js";

/** Render one PathSourceStatus for the trace report — same verdicts as drift, by construction. */
function statusLine(status: ReturnType<typeof pathSourceStatus>, sha: string): string {
  const n = (c: number) => `${c} commit${c === 1 ? "" : "s"}`;
  switch (status.kind) {
    case "sha-unresolvable":
      return `sha ${sha} not found in repository`;
    case "gone":
      return "path no longer exists at HEAD";
    case "untracked":
      return "on disk but not tracked (nested repo or ignored path)";
    case "compare-failed":
      return "drift status unavailable";
    case "clean":
      return "verified against current HEAD lineage — no commits since";
    case "content-equal":
      return `content unchanged since verification (${n(status.commits)} touched the file)`;
    case "diverged":
      return "content differs but no commits connect the anchor to HEAD";
    case "stale":
      return `${n(status.commits)} since verification`;
    case "section-ok":
      return `section unchanged since verification (${n(status.commits)} touched the file)`;
    case "section-changed":
      return "section changed since verification";
    case "section-missing-head":
      return "section no longer found — renamed or removed";
    case "section-missing-anchor":
      return "section never present at the anchored sha — fix the anchor";
    case "section-file-missing-anchor":
      return "not a file at the anchored sha — fix the anchor";
    case "section-ambiguous":
      return `section heading occurs ${status.count} times — ambiguous`;
  }
}

/** Human-readable provenance report for one page (SPEC §14): the "where did this come from?" command. */
export function tracePage(load: LoadResult, id: string, cwd: string): string | null {
  const page = load.pages.find((p) => p.id === id);
  if (page === undefined) return null;

  const lines: string[] = [
    `${page.id} — ${page.title}`,
    `kind ${page.kind} · status ${page.status} · created ${page.created} · updated ${page.updated}`,
    `provenance: written by ${page.provenance.agent} (actor: ${page.provenance.actor}) during ${page.provenance.task}`,
    "",
    "sources:",
  ];

  const root = repoRoot(cwd);
  for (const source of page.sources) {
    if ("url" in source) {
      lines.push(`  - url ${source.url} (accessed ${source.accessed})`);
      continue;
    }
    let gitCwd = root;
    let unverifiable: string | null = null;
    if (source.repo !== undefined) {
      const rel = load.config.repos[source.repo];
      if (rel === undefined) {
        unverifiable = `repo "${source.repo}" is not declared in config.repos`;
        gitCwd = null;
      } else {
        const checkout = resolve(dirname(load.loreDir), rel);
        if (!existsSync(checkout)) {
          unverifiable = `repo "${source.repo}" checkout not present — unverifiable here`;
          gitCwd = null;
        } else if (!isCheckout(checkout)) {
          // Same gate as drift: never run git in a directory that is not a checkout (SPEC §16).
          unverifiable = `repo "${source.repo}" directory is not a git checkout (no .git entry of its own) — git is never run inside it`;
          gitCwd = null;
        } else {
          gitCwd = checkout;
        }
      }
    }
    const drift =
      gitCwd === null
        ? (unverifiable ?? "drift status unavailable (not a git repository)")
        : statusLine(pathSourceStatus(gitCwd, source), source.sha);
    const note = source.note === undefined ? "" : ` (${source.note})`;
    const section = source.section === undefined ? "" : ` § "${source.section}"`;
    const label = source.repo === undefined ? source.path : `${source.repo}:${source.path}`;
    lines.push(`  - path ${label}${section} @ ${source.sha}${note} — ${drift}`);
  }

  const inbound = load.pages
    .filter(
      (p) =>
        p.id !== page.id &&
        (p.body.includes(`[[${page.id}]]`) ||
          p.body.includes(`[[${page.id}|`) ||
          p.body.includes(`[[${page.id}\\|`) ||
          p.body.includes(`[[${page.id}#`)),
    )
    .map((p) => p.id)
    .sort(byteCompare);
  lines.push("", "inbound links:");
  if (inbound.length === 0) lines.push("  (none)");
  else for (const link of inbound) lines.push(`  - [[${link}]]`);

  lines.push("", "log mentions:");
  const logDir = join(load.loreDir, "log");
  let mentions = 0;
  if (existsSync(logDir)) {
    for (const name of readdirSync(logDir).sort(byteCompare)) {
      if (!name.endsWith(".md")) continue;
      const text = readFileSync(join(logDir, name), "utf8");
      for (const line of text.split("\n")) {
        if (line.startsWith("## ") && line.includes(page.id)) {
          lines.push(`  - ${basename(load.loreDir)}/log/${name}: ${line}`);
          mentions++;
        }
      }
    }
  }
  if (mentions === 0) lines.push("  (none)");

  return `${lines.join("\n")}\n`;
}
