import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { byteCompare } from "./findings.js";
import { commitsTouchingSince, pathExistsAtHead, repoRoot, shaResolvable } from "./git.js";
import type { LoadResult } from "./load.js";

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
        } else {
          gitCwd = checkout;
        }
      }
    }
    let drift = unverifiable ?? "drift status unavailable (not a git repository)";
    if (gitCwd !== null) {
      if (!shaResolvable(gitCwd, source.sha)) drift = `sha ${source.sha} not found in repository`;
      else if (!pathExistsAtHead(gitCwd, source.path)) drift = "path no longer exists at HEAD";
      else {
        const commits = commitsTouchingSince(gitCwd, source.sha, source.path);
        drift =
          commits === null
            ? "drift status unavailable"
            : commits === 0
              ? "verified against current HEAD lineage — no commits since"
              : `${commits} commit${commits === 1 ? "" : "s"} since verification`;
      }
    }
    const note = source.note === undefined ? "" : ` (${source.note})`;
    const label = source.repo === undefined ? source.path : `${source.repo}:${source.path}`;
    lines.push(`  - path ${label} @ ${source.sha}${note} — ${drift}`);
  }

  const inbound = load.pages
    .filter((p) => p.id !== page.id && p.body.includes(`[[${page.id}]]`))
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
