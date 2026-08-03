# Changelog

All notable changes to loredown are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project adheres to
[Semantic Versioning](https://semver.org/).

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
