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
  };
  scan: {
    instructions: "off" | "warn" | "error";
    secrets: "warn" | "error";
  };
  kinds: string[];
}

export const DEFAULT_CONFIG: Config = {
  schemaVersion: 1,
  budgets: { pageBodyLines: 40, pagesPerTask: 3 },
  scan: { instructions: "warn", secrets: "error" },
  kinds: [],
};

/** The newest schema this build of the CLI understands (SPEC §17). */
export const KNOWN_SCHEMA_VERSION = 1;

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const SHORT_SHA = /^[0-9a-f]{7,40}$/;
export const SLUG = /^[a-z0-9][a-z0-9-]*$/;
export const TITLE_MAX = 80;

export function isBuiltinKind(kind: string): kind is BuiltinKind {
  return (BUILTIN_KINDS as readonly string[]).includes(kind);
}

export function allowedKinds(config: Config): string[] {
  return [...BUILTIN_KINDS, ...config.kinds];
}

/** Section heading for a kind: builtins from the table, custom kinds get "s" appended. */
export function sectionHeading(kind: string): string {
  if (isBuiltinKind(kind)) return KIND_SECTIONS[kind];
  return kind.charAt(0).toUpperCase() + kind.slice(1) + "s";
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
