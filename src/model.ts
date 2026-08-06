export const BUILTIN_KINDS = [
  "decision",
  "constraint",
  "gotcha",
  "incident",
  "glossary",
  "map",
] as const;
export type BuiltinKind = (typeof BUILTIN_KINDS)[number];

/** Index section order and headings (SPEC §6). Custom kinds append after builtins. */
export const KIND_SECTIONS: Record<BuiltinKind, string> = {
  decision: "Decisions",
  constraint: "Constraints",
  gotcha: "Gotchas",
  incident: "Incidents",
  glossary: "Glossary",
  map: "Maps",
};

export const STATUSES = ["active", "superseded", "archived"] as const;
export type Status = (typeof STATUSES)[number];

export const LOG_OPS = ["seed", "ingest", "update", "distill", "archive"] as const;

export interface PathSource {
  path: string;
  sha: string;
  note?: string;
  /** Name of a sibling checkout declared in config.repos (SPEC §9). */
  repo?: string;
}

export interface UrlSource {
  url: string;
  accessed: string;
}

export type Source = PathSource | UrlSource;

export interface Provenance {
  agent: string;
  actor: string;
  task: string;
}

export interface Page {
  /** Path under lore/pages/ without .md — must equal frontmatter id. */
  id: string;
  title: string;
  kind: string;
  status: Status;
  created: string;
  updated: string;
  provenance: Provenance;
  sources: Source[];
  supersedes?: string;
  /** Imported from a pre-existing KB, pending curation (SPEC §3). */
  imported?: boolean;
  /** Markdown body after the closing frontmatter fence. */
  body: string;
  /** File path relative to the lore dir, e.g. "pages/gotcha/foo.md". */
  file: string;
}

export interface Config {
  schemaVersion: number;
  budgets: {
    pageBodyLines: number;
    pagesPerTask: number;
    /** Drift-only URL staleness horizon in days; 0 disables (SPEC §9). */
    urlAccessedMaxAgeDays: number;
  };
  scan: {
    instructions: "off" | "warn" | "error";
    secrets: "warn" | "error";
  };
  kinds: string[];
  /** Sibling checkouts for cross-repo anchors: name → relative path (SPEC §9). */
  repos: Record<string, string>;
}

export const DEFAULT_CONFIG: Config = {
  schemaVersion: 1,
  budgets: { pageBodyLines: 40, pagesPerTask: 3, urlAccessedMaxAgeDays: 0 },
  scan: { instructions: "warn", secrets: "error" },
  kinds: [],
  repos: {},
};

/** The newest schema this build of the CLI understands (SPEC §17). */
export const KNOWN_SCHEMA_VERSION = 1;

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const SHORT_SHA = /^[0-9a-f]{7,40}$/;
export const SLUG = /^[a-z0-9][a-z0-9-]*$/;
export const TITLE_MAX = 80;

/** Wiki-link syntax (SPEC §3): `[[target]]` or `[[target|display text]]`. */
export const WIKILINK = /\[\[([^\]\n]+)\]\]/g;

/**
 * Split a wiki-link's inner text per the grammar `target(#heading)?(|display)?` (SPEC §3).
 * The alias separator may be written escaped (`\|`) — the table-cell form; the backslash
 * belongs to neither the target nor the display.
 */
export function splitWikiLink(inner: string): {
  target: string;
  heading: string | null;
  alias: string | null;
  /** True when the alias separator was written `\|` (markdown table cells). */
  escapedPipe: boolean;
} {
  const pipe = inner.indexOf("|");
  const escapedPipe = pipe > 0 && inner[pipe - 1] === "\\";
  const alias = pipe === -1 ? null : inner.slice(pipe + 1);
  const full = pipe === -1 ? inner : inner.slice(0, escapedPipe ? pipe - 1 : pipe);
  const hash = full.indexOf("#");
  if (hash === -1) return { target: full, heading: null, alias, escapedPipe };
  return { target: full.slice(0, hash), heading: full.slice(hash + 1), alias, escapedPipe };
}

export function isBuiltinKind(kind: string): kind is BuiltinKind {
  return (BUILTIN_KINDS as readonly string[]).includes(kind);
}

export function allowedKinds(config: Config): string[] {
  return [...BUILTIN_KINDS, ...config.kinds];
}

/** Section heading for a kind: builtins from the table, custom kinds get "s" appended. */
export function sectionHeading(kind: string): string {
  if (isBuiltinKind(kind)) return KIND_SECTIONS[kind];
  return `${kind.charAt(0).toUpperCase()}${kind.slice(1)}s`;
}

/** Body templates used by `loredown new` (SPEC §4). */
export const KIND_TEMPLATES: Record<BuiltinKind, string> = {
  decision: "## Context\n\n## Decision\n\n## Why\n\n## Rejected alternatives\n",
  constraint: "## The constraint\n\n## Origin\n\n## Implications\n",
  gotcha: "## Symptom\n\n## Cause\n\n## What to do\n",
  incident: "## What happened\n\n## Root cause\n\n## Lesson\n",
  glossary: "",
  map: "",
};
