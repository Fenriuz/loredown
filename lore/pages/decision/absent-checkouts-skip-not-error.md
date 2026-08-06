---
id: decision/absent-checkouts-skip-not-error
title: Drift treats absent sibling checkouts as skips, never findings
kind: decision
status: active
created: 2026-08-05
updated: 2026-08-05
provenance:
  agent: claude-code
  actor: fenriuz
  task: "v0.2.0 field report"
sources:
  - path: SPEC.md
    sha: "1f3730e"
    section: "## 9. Drift and verification"
    note: §9 sibling-repos design
---

## Context
Cross-repo anchors (`repo:` sources) can only be verified where the mapped
checkout exists. CI runners and fresh clones usually lack sibling checkouts,
and `drift` exits 1 on any finding.

## Decision
An absent checkout produces a reported *skip* (counted, printed, in `--json`),
never an error or warning finding.

## Why
"Not verifiable here" and "the evidence is gone" are different facts; conflating
them makes the flagship feature fail pipelines precisely in the environments
where it runs on a schedule. The first field report (umbrella repo, six sibling
repos) showed v0.1 erroring on exactly the highest-value pages. The second
field report verified the full design in the field: 6/6 cases including
absent-checkout → reported skip, exit 0.

## Rejected alternatives
Warn-level finding (spurious CI failures everywhere the checkout is absent);
hiding skips behind --verbose (invisible debt — skips must stay visible).
