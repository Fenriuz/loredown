---
id: decision/import-mechanical-not-verbatim
title: Import is mechanical and lossless, not verbatim
kind: decision
status: active
created: 2026-08-05
updated: 2026-08-05
provenance:
  agent: claude-code
  actor: fenriuz
  task: "v0.3.0 field report"
sources:
  - path: SPEC.md
    sha: "33f69b4"
    note: §14 import contract
---

## Context
The first real migration (27 pages, three `--kind` runs) produced 169 broken
wiki-links and pages with their original frontmatter leaked into the body.
v0.2's import promised "body preserved" — byte-verbatim copying.

## Decision
Import's invariant is *no judgment, no information loss* — not verbatim bytes.
It may apply deterministic, reversible, reported transforms (link-namespace
rewriting, frontmatter harvesting) but never guesses: ambiguous links stay put,
unadopted metadata stays visible, and a harvested anchor must verify in its
target repo — never born SRC_GONE, the same philosophy as
[[decision/absent-checkouts-skip-not-error]]. A path-style link naming a file
skipped this run is left broken rather than re-pointed by name — mis-anchoring
is worse than a broken link. And the summary's left-for-review count equals
what lint will flag: the summary predicts the lint.

## Why
One-PR migration is the reason import exists; verbatim copying was the means,
not the end. Link rewriting must cover all `imported: true` pages, not just the
current batch: real KBs import kind by kind, so batch-local resolution leaves
every cross-kind link broken forever — later runs resolve the forward links
earlier runs could not.

## Rejected alternatives
Batch-local link resolution (fails the very migration that motivated it); an
opt-out flag (unneeded — targets containing `/` are never touched, so a
`kind/slug`-form KB imports unchanged); preserving unmapped metadata as HTML
comments in the body (non-blank lines eat the budget; the anchor note is
structured and budget-free).
