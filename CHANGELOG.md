# Changelog

All notable changes to loredown are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project adheres to
[Semantic Versioning](https://semver.org/).

## [0.3.0] — 2026-08-05

Driven by the second field report from the same umbrella-project team — the
first real 27-page migration through `import`. Both gaps it surfaced are
closed; the umbrella/`repos:` pattern itself was verified end-to-end (6/6
cases) by the reporter against v0.2.0.

### Added

- **Wiki-link display text** — `[[kind/slug|display text]]` (the target-first
  convention shared by MediaWiki, Obsidian and Logseq): `lint` validates the
  target and leaves the display free; `trace` counts aliased inbound links.
- **`import` rewrites wiki-links to the id namespace** — bare targets are
  slugified and resolved against all lore pages plus the batch; a unique match
  becomes `[[kind/slug|original text]]` (rendered text preserved), ambiguous or
  unknown targets are left for lint to flag — guessing would be worse than
  reporting. Targets already containing `/` are never touched. The pass covers
  every page still marked `imported: true`, so a KB imported kind by kind
  converges: later runs resolve the forward links earlier runs could not.
  Rewritten / left-for-review counts are reported.
- **`import` harvests pre-existing frontmatter** instead of leaking it into the
  body: `title` is adopted (a divergent H1 stays in the body — it is content),
  `created`/`updated` are adopted when they are ISO dates (the original KB's
  dates survive repo moves that git history does not), and `sources:` entries
  resolve to real anchors — longest-prefix match against `config.repos` yields
  `repo:` anchors at the sibling's HEAD; paths tracked in this repo become
  plain anchors; directory paths work. An entry becomes an anchor only when it
  verifies — **an anchor is never born `SRC_GONE`**. Everything unadopted
  (unknown keys, unresolved entries, unparseable frontmatter) is preserved
  visibly: in the import anchor's note or, for unparseable blocks, in the body
  with a per-file report line.

### Changed

- SPEC §14 gains the full **import contract** ("no judgment, no information
  loss") and the documented migration order: import → re-anchor to code →
  only then delete the old KB.

## [0.2.0] — 2026-08-05

Driven by the first field report — a multi-repo *umbrella* project (docs + wiki
in a parent repo, six independently-deployed sibling repos) where v0.1's drift
inverted: it errored precisely on the highest-value pages. Thanks to the
reporting team for an exemplary writeup.

### Added

- **Cross-repo source anchors** (the umbrella/docs-repo/handbook pattern):
  `config.repos` maps repo names to sibling checkouts (relative paths only);
  path sources gain an optional `repo:` field and `drift` verifies them inside
  the mapped checkout. An **absent checkout is a reported skip, never a
  finding** — "not verifiable here" is a different fact from "the evidence is
  gone". Undeclared repo names are lint/drift errors (`SRC_REPO`).
- **`SRC_UNTRACKED` diagnostic** — distinguishes "exists on disk but not
  tracked" (nested-repo gitlinks, ignored paths) from `SRC_GONE`, with a hint
  pointing at the `repos:` mapping.
- **URL staleness horizon** — `budgets.url_accessed_max_age_days` (default 0 =
  off): `drift` warns (`URL_STALE`) when a URL source's `accessed` date is older
  than the horizon. Offline, drift-only; `lint` stays byte-deterministic.
- **`loredown import <path…> --kind <kind>`** — the adoption path from an
  existing markdown KB: H1 → title, body preserved, provenance from the file's
  git history, source anchored to the *original file* at HEAD (lint-valid by
  construction — no TODOs), `imported: true` marking the curation debt.
- **Imported-page semantics**: the hard body-budget error downgrades to a
  warning on `imported: true` pages so a migration lands in one reviewable PR;
  a per-page `IMPORTED` warning keeps the debt visible until curated.
- **Split-seam hints** — over-budget findings now list the page's `##` headings,
  the usual seams for splitting one trench-coat page into several facts.

### Changed

- Strict YAML-subset parser accepts hyphens and dots in map keys (repo names
  like `rfid-svc`).
- `drift --json` output now includes the `skipped` sources array.

## [0.1.0] — 2026-08-03

First public release.

### Added

- **The `lore/` schema** — one markdown file per fact with provenance frontmatter and
  source anchors; six kinds (decision, constraint, gotcha, incident, glossary, map);
  slug-as-identity merge semantics; generated index; monthly append-only log.
  Full design in SPEC.md.
- **Zero-dependency validator CLI** (`npx loredown …`):
  - `lint` — 13 checks: schema, id↔path, kinds, dates, sources, wiki-links, body
    budgets, near-duplicate titles, instruction scan (anti prompt-injection),
    secret scan, index freshness, supersedes consistency, log format
  - `index` — byte-deterministic catalog generation (`--check` for CI)
  - `drift` — git-aware staleness: flags pages whose anchored sources changed
    since last verification; never auto-updates anchors
  - `trace` — page provenance, per-source drift status, inbound links, log mentions
  - `new` — templated page scaffolding with prefilled frontmatter
  - `init [--seed]` — skeleton creation plus a guided bootstrap interview
  - `--json`, `--dry-run`, `--verbose` on every command; no network I/O
- **Agent adapters** (`loredown install <tool>`) — idempotent fenced-block install,
  content outside the fence never touched: Claude Code (CLAUDE.md shim,
  `/lore-ingest`, `/lore-query`), Codex (AGENTS.md), Cursor (always-apply rule).
- **Agent eval harness** (`npm run eval`) — real Claude Code headless sessions
  against fixture repos with scoped permissions; ingest/drift/query scenarios plus
  an LLM judge for the derivability rule. Validated with Claude Sonnet 5 and
  Claude Opus 4.8.
