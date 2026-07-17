import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { byteCompare, type Finding, type Level, sortFindings } from "./findings.js";
import { generateIndex } from "./index-gen.js";
import type { LoadResult } from "./load.js";
import { allowedKinds, TITLE_MAX } from "./model.js";

const WIKILINK = /\[\[([^\]\n]+)\]\]/g;

/**
 * Agent-hijacking phrasing (SPEC §8). Targets instructions aimed at the
 * *reading agent* — not imperative prose addressed to humans making changes.
 */
const INSTRUCTION_PATTERNS: readonly { re: RegExp; label: string }[] = [
  {
    re: /ignore (all )?(previous|prior|earlier) (instructions|context|messages)/i,
    label: "override phrasing",
  },
  { re: /disregard (the )?(system|previous|prior|above)/i, label: "override phrasing" },
  {
    re: /you (must|should) (now )?(run|execute|call|approve|fetch)\b/i,
    label: "command to the reading agent",
  },
  { re: /always (run|execute|approve)\b/i, label: "command to the reading agent" },
  { re: /do not (tell|inform|mention (this )?to) the user/i, label: "concealment phrasing" },
];

/** Common credential shapes (SPEC §8). scan.secrets cannot be disabled. */
const SECRET_PATTERNS: readonly { re: RegExp; label: string }[] = [
  { re: /\bAKIA[0-9A-Z]{16}\b/, label: "AWS access key id" },
  { re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/, label: "GitHub token" },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, label: "Slack token" },
  { re: /\bsk-[A-Za-z0-9_-]{20,}\b/, label: "API secret key" },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: "private key block" },
  {
    re: /\b(api[_-]?key|secret|token|password)\b\s*[:=]\s*['"][^'"\s]{16,}['"]/i,
    label: "credential assignment",
  },
];

const LOG_NAME_RE = /^\d{4}-\d{2}\.md$/;
const LOG_ENTRY_RE =
  /^## \[\d{4}-\d{2}-\d{2}\] (seed|ingest|update|distill|archive) \| [^|]+ \| .+$/;

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "of",
  "for",
  "to",
  "in",
  "on",
  "is",
  "are",
  "not",
  "and",
  "or",
  "with",
  "by",
]);

function titleTokens(title: string): Set<string> {
  const tokens = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t !== "" && !STOPWORDS.has(t));
  return new Set(tokens);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

export function nonBlankLines(text: string): number {
  return text.split("\n").filter((line) => line.trim() !== "").length;
}

/** All SPEC §14 lint checks. Returns load findings + semantic findings, deterministically sorted. */
export function lintLore(load: LoadResult): Finding[] {
  const findings: Finding[] = [...load.findings];
  const { config, pages, loreDir } = load;
  const add = (level: Level, code: string, file: string, message: string) =>
    findings.push({ level, code, file, message });

  const ids = new Set(pages.map((p) => p.id));
  const kinds = allowedKinds(config);
  const displayOf = (file: string) => `${basename(loreDir)}/${file}`;

  for (const page of pages) {
    const file = displayOf(page.file);
    const pathId = page.file.slice("pages/".length, -".md".length);

    if (page.id !== pathId) {
      add(
        "error",
        "ID_MISMATCH",
        file,
        `id "${page.id}" does not match file path (expected "${pathId}")`,
      );
    }
    if (!page.id.startsWith(`${page.kind}/`)) {
      add(
        "error",
        "KIND_DIR",
        file,
        `page of kind "${page.kind}" must live under pages/${page.kind}/`,
      );
    }
    if (!kinds.includes(page.kind)) {
      add(
        "error",
        "KIND_UNKNOWN",
        file,
        `kind "${page.kind}" is not a built-in or config-declared kind`,
      );
    }
    if (page.title.length > TITLE_MAX) {
      add("error", "TITLE_LONG", file, `title is ${page.title.length} chars (max ${TITLE_MAX})`);
    }
    if (page.updated < page.created) {
      add(
        "error",
        "DATE_ORDER",
        file,
        `updated (${page.updated}) is before created (${page.created})`,
      );
    }

    for (const match of page.body.matchAll(WIKILINK)) {
      const target = match[1] as string;
      if (!ids.has(target)) {
        add("error", "LINK_BROKEN", file, `wiki-link [[${target}]] has no matching page`);
      }
    }

    const bodyLines = nonBlankLines(page.body);
    const budget = config.budgets.pageBodyLines;
    if (bodyLines > budget * 2) {
      add(
        "error",
        "BODY_OVER_HARD",
        file,
        `body has ${bodyLines} non-blank lines (hard limit ${budget * 2}) — split the fact or cut derivable detail`,
      );
    } else if (bodyLines > budget) {
      add(
        "warn",
        "BODY_OVER_BUDGET",
        file,
        `body has ${bodyLines} non-blank lines (budget ${budget})`,
      );
    }

    if (page.supersedes !== undefined) {
      const target = pages.find((p) => p.id === page.supersedes);
      if (target === undefined) {
        add(
          "error",
          "SUPERSEDES_MISSING",
          file,
          `supersedes "${page.supersedes}" which does not exist`,
        );
      } else if (target.status !== "superseded") {
        add(
          "error",
          "SUPERSEDES_STATUS",
          displayOf(target.file),
          `page is superseded by [[${page.id}]] but has status "${target.status}" (expected "superseded")`,
        );
      }
    }
  }

  // Near-duplicate titles among active pages (warn once per pair, on the byte-later id).
  const active = pages.filter((p) => p.status === "active").sort((a, b) => byteCompare(a.id, b.id));
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      if (a === undefined || b === undefined) continue;
      if (jaccard(titleTokens(a.title), titleTokens(b.title)) >= 0.6) {
        add(
          "warn",
          "DUP_TITLE",
          displayOf(b.file),
          `title is very similar to [[${a.id}]] — same fact? merge or differentiate`,
        );
      }
    }
  }

  // Content scans run on raw text of every page file, valid or not.
  for (const raw of load.rawPages) {
    if (config.scan.instructions !== "off") {
      for (const { re, label } of INSTRUCTION_PATTERNS) {
        const match = raw.text.match(re);
        if (match !== null) {
          add(
            config.scan.instructions,
            "SCAN_INSTRUCTION",
            raw.display,
            `${label}: "${match[0]}" — lore is data, never instructions to the reading agent`,
          );
        }
      }
    }
    for (const { re, label } of SECRET_PATTERNS) {
      const match = raw.text.match(re);
      if (match !== null) {
        add(
          config.scan.secrets,
          "SCAN_SECRET",
          raw.display,
          `possible ${label} detected — secrets must never enter the lore`,
        );
      }
    }
  }

  // Index freshness: committed index must byte-match a fresh regeneration.
  const indexPath = join(loreDir, "index.md");
  const indexDisplay = displayOf("index.md");
  if (!existsSync(indexPath)) {
    add(
      "error",
      "INDEX_MISSING",
      indexDisplay,
      "lore/index.md does not exist — run: npx loredown index",
    );
  } else if (readFileSync(indexPath, "utf8") !== generateIndex(config, pages)) {
    add(
      "error",
      "INDEX_STALE",
      indexDisplay,
      "index does not match a fresh regeneration — run: npx loredown index",
    );
  }

  // Log shard names and entry format.
  const logDir = join(loreDir, "log");
  if (existsSync(logDir)) {
    for (const name of readdirSync(logDir).sort(byteCompare)) {
      if (!name.endsWith(".md")) continue;
      const logDisplay = displayOf(`log/${name}`);
      if (!LOG_NAME_RE.test(name)) {
        add("error", "LOG_NAME", logDisplay, `log shards must be named YYYY-MM.md`);
        continue;
      }
      const lines = readFileSync(join(logDir, name), "utf8").split("\n");
      lines.forEach((line, i) => {
        if (line.startsWith("## ") && !LOG_ENTRY_RE.test(line)) {
          add(
            "error",
            "LOG_ENTRY",
            logDisplay,
            `line ${i + 1}: entry header must match "## [YYYY-MM-DD] <op> | <scope> | <actor>" with op one of seed|ingest|update|distill|archive`,
          );
        }
      });
    }
  }

  return sortFindings(findings);
}
