---
id: decision/small-page-budgets
title: Page and task budgets stay small even as context windows grow
kind: decision
status: active
created: 2026-08-05
updated: 2026-08-05
provenance:
  agent: claude-code
  actor: fenriuz
  task: "budget review after field report"
sources:
  - path: SPEC.md
    sha: "33f69b4"
    note: §8 budgets + long-form pointer pattern
  - url: https://arxiv.org/abs/2307.03172
    accessed: 2026-08-05
---

## Context
The budgets (40-line bodies, hard error at 2×, 3 pages per task) were
questioned after the first field report, and again as model context windows
keep growing (1M is now table stakes).

## Decision
Keep the small defaults. Budgets are per-repo config, not universal law — but
the shipped defaults stay curation-first.

## Why
A page is a fact, not an article: complex topics are clusters of linked pages,
and the budget is what forces the graph to exist. Every page is re-read by
every future agent session, so bloat compounds across the whole team forever.
Retrieval quality degrades with distractor context regardless of window size
("lost in the middle"). Small models and CI readers consume the lore too —
tool-agnostic includes model-tier-agnostic. A 40-line diff is what keeps human
PR review real. Field data: 22 of 27 pages of a real legacy wiki fit under the
hard limit, and the reporter endorsed the budget ("3–5 facts wearing a trench
coat").

## Rejected alternatives
Raising defaults because context windows grew (bigger windows make bloat
possible, not good; as models read code better, the derivable share grows and
the lore should densify, not swell). Enforcing pages-per-task in lint (a
"task" has no deterministic boundary — PR review is the right enforcement
point).
