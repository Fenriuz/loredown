# Changelog

All notable changes to loredown are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project adheres to
[Semantic Versioning](https://semver.org/).

## [0.6.1] — 2026-11-12

A security release. Upgrade, and re-run `loredown install <tool>` so the pinned
adapter commands move to 0.6.1.

### Security

- **A `repos:` directory could make loredown run a program chosen by repository
  content.** A directory mapped in `config.repos` was accepted whenever git
  recognised it as a repository — and git recognises a *bare repository layout*
  (`HEAD`, `config`, `objects/`, `refs/`) made of ordinary tracked files, then
  obeys the `config` among them, including the keys that name programs to run.
  A change that added such a directory, a `repos:` entry pointing at it and a
  page citing it passed `lint` cleanly and made `drift` execute that program on
  the machine of whoever ran it; `trace` and `import` ran git in the same
  directory. The code path dates from the introduction of `repos:` (`drift` and
  `trace` since 0.2.0, `import` since 0.3.0); it was reproduced on 0.6.0. It
  broke a promise SPEC §15 already made — a pull request must not be able to
  turn the CLI into an execution vector.

  Fixed with two independent locks. A mapped directory is now a checkout only
  if it carries its own `.git` entry — git refuses to track any path named
  `.git`, so repository content cannot create one — and anything else that
  exists there is an `SRC_REPO` error, with git never run inside it; `drift`,
  `trace` and `import` share that one gate. And every git invocation now passes
  `safe.bareRepository=explicit`, so git itself (≥ 2.38) refuses to adopt a bare
  layout from the working directory.

### Changed

- A **bare repository** is no longer accepted as a `repos:` target (it was never
  documented as one). Map a checkout: a clone, a linked worktree and a submodule
  all qualify.

## [0.6.0] — 2026-08-06

Driven by our own dogfooding this time: five consecutive cycles in this repo
staled 4–6 of 13 lore pages after SPEC edits to unrelated sections, and
re-verification degenerated into a mechanical sha bump — a false positive
training the operator to rubber-stamp, the exact failure drift exists to
prevent. This release makes drift's signal precise, and performs the project's
first schema version bump doing it.

### Added

- **Section anchors** (`schema_version: 2`) — a path source may carry
  `section: "## Heading"` (always quoted — unquoted, the ` #` starts a YAML
  comment): the exact heading line the claim cites. Drift compares only that
  region between the anchored sha and HEAD, so edits to the rest of the file
  no longer stale the page. Renamed/removed headings get their own diagnostic
  (`SRC_SECTION`: warn at HEAD; error when the heading was never present at
  the anchor — checked *before* any fast path, so a broken anchor cannot hide
  behind an unchanged file); duplicated headings are flagged as ambiguous,
  never guessed at.
- **Content-identical is not stale** — drift compares the path's tree entry
  (mode, type, object id) between anchor and HEAD: reverts, merges, and
  touch-only history no longer warn. Entries rather than blob ids, so a mode
  flip with identical bytes still counts. An anchor whose content differs with
  *no* connecting commits now warns — it never did before.
- **One verdict engine** — `trace` renders the same per-source status drift
  computes (`pathSourceStatus`), so the two commands can no longer disagree
  about an anchor; trace gains its first tests.

### Fixed

- **Uniform schema refusal** — previously only `index` consulted the
  schema-too-new flag: `drift` on a newer-schema lore silently dropped the
  unreadable pages and reported **clean** (exit 0), and `trace` claimed the
  page did not exist. Every lore-reading command now refuses with a single
  `SCHEMA_VERSION` error and exit 1, `install` included.

### Migration

`schema_version: 2` is opt-in and only needed for `section:` anchors — `init`
still writes version 1, and a version-1 lore is untouched by this release.
Before declaring version 2: pin CI to loredown ≥ 0.6 and re-run
`loredown install <tool>` (0.5's `drift` reports clean on a version-2 lore —
SPEC §17 has the full compatibility note).

## [0.5.1] — 2026-08-06

### Added

- **Severity color in human output** — `error` red, `warn` yellow, plus the
  non-zero counts in the summary line; nothing else. Emitted only when stdout
  is a TTY, `NO_COLOR` is unset or empty ([no-color.org](https://no-color.org)),
  and `TERM` is not `dumb`. The decision is computed once at the process edge
  (the CLI entry) and travels inward as data — no code below it reads TTY or
  environment state — so `--json`, every non-TTY stream, every generated file,
  and every library/test call are byte-identical with color on or off. The
  existing golden fixtures pass without a single edit, which is the point.

## [0.5.0] — 2026-08-06

Driven by the fourth field report — the same team's migration done for real and
delivered: 27 wiki pages became 39 curated lore pages with 88 cross-repo
anchors, handed over as a standalone folder. The handoff and the curation each
surfaced one gap.

### Added

- **Escaped alias separators** — `[[target\|display]]`, the only way to write
  an aliased wiki-link inside a markdown table cell, now parses everywhere the
  plain form does: lint resolves it, import rewrites it, and the escape is
  never lost. Rewrites preserve rendered *structure* as well as text: an
  escaped separator stays escaped, and an alias synthesized into a table row
  is written escaped — previously a bare link in a table cell was rewritten
  with an unescaped `|` that silently split the cell while lint stayed green.
- **The provenance anchor is a specified concept** (SPEC §14): the first
  source of an imported page records where the page came from, not what it
  asserts. Import's link resolution already relied on it; now it has a name
  and a contract.

### Changed

- Migration docs (SPEC §14, README) now cover **extraction**: the
  `SRC_SHA`/`SRC_GONE` cascade fires not only when the old KB is deleted but
  when the lore moves without its repo — copied, split out of a monorepo, or
  handed over as a folder. Re-anchor to `repo:` sources before the lore
  travels; `repo:` anchors skip (exit 0) at a destination without the mapped
  checkouts and start verifying when they appear.

## [0.4.1] — 2026-08-05

Positioning and documentation only — no code changes, no behavior changes. The
adapter pin moves with the version, so blocks written by this release read
`npx loredown@0.4.1`; existing installs are untouched until someone re-runs
`install`.

### Changed

- README top-of-fold and the package description now lead with the problem
  (agents re-learning the codebase on every task) and the two properties that
  distinguish loredown from vendor memory: review rides pull requests, and the
  tool detects its own staleness.
- README links `lore/` directly. This repo's own knowledge base is the clearest
  demonstration of the format, and it was previously invisible to readers.

## [0.4.0] — 2026-08-05

Driven by the third field report — the same team's 27-page migration re-run on
v0.3.0 (169 → 17 broken links; 58 harvested code anchors, drift-clean; 2 of the
remaining errors were real dangling links the wiki's own author did not know it
had). The three gaps it surfaced are closed.

### Added

- **Heading anchors in wiki-links** — the grammar is now
  `[[target(#heading)?(|display)?]]`: `[[#Setup]]` is a same-page anchor, not a
  page link (lint no longer false-flags it); `[[page#Setup|display]]` validates
  and rewrites only the page part, the heading rides along untouched. Heading
  *existence* is deliberately unchecked — real headings carry formatting that
  text-matching would false-flag, and a false positive trains people to ignore
  lint.
- **Relative-path wiki-links resolve on import** — how folder-organised vaults
  link across directories. Path-style targets (leading segment is not a
  declared kind) resolve exact-path-first against the linking file's own
  directory — batch pages know their source path, previously imported pages
  carry theirs as their first source anchor — then fall back to basename→slug.
  A path that names a file *skipped this run* is left alone: rewriting it by
  name could point at the wrong page, and mis-anchoring is worse than a broken
  link. Id-form targets (`decision/beta`) keep namespace precedence and are
  never rewritten.
- **Counter invariant** — the import summary's "left for review" now equals
  the `LINK_BROKEN` findings lint will raise over the pages import scanned
  (including id-form targets that do not exist). The summary predicts the lint.
- **Pinned adapter commands** — `install` writes `npx loredown@<version>` (the
  version that wrote the block) instead of unpinned `npx loredown`. These
  commands are executed by agents — the least observable place for behavior to
  change — so a new release must never alter a team's toolchain until someone
  re-runs `install` and reviews the fence diff. `npm i -D loredown` remains the
  lockfile-level alternative.

### Fixed

- Intra-batch slug collisions: since import began deferring writes for link
  resolution (0.3.0), two files in one run yielding the same slug silently
  clobbered each other's page. The collision check now covers pages pending in
  the same run — the later file is skipped and reported like any other
  collision.

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
