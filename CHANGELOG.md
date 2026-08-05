# Changelog

All notable changes to loredown are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project adheres to
[Semantic Versioning](https://semver.org/).

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
