---
id: decision/feedback-triage
title: Feedback is triaged by a fixed rubric, kept in lore not CONTRIBUTING
kind: decision
status: active
created: 2026-08-05
updated: 2026-08-05
provenance:
  agent: claude-code
  actor: fenriuz
  task: "triage review after third field report"
sources:
  - path: CHANGELOG.md
    sha: "5efc4a1"
    note: the three field-report cycles that shaped the rubric
---

## Context
Three field reports in three days each produced a release. The feedback was
excellent, but the filter deciding what to build was implicit — and all field
evidence so far comes from one team and one corpus.

## Decision
Every report or feature request is triaged with fixed questions, in order:
1. Reproduce the claim before adopting anything (each of the three reports
   contained an error or design gap the repro caught).
2. Does the problem violate a loredown principle (determinism, never-guess,
   curation-first, supply-chain)? Fix loredown, with priority.
3. Is it a legitimate user practice we fail to support (umbrella repos,
   folder-organised vaults)? Support it.
4. Is it a user-side bad practice (raising budgets instead of curating,
   silencing real broken links)? Document the right path; never build the
   exception.
5. Is the evidence single-team/single-corpus and not principle-driven?
   Watch-item until a second independent case appears.

## Why
The filter lived in conversation, not in the repo. Lore is read at task start,
so the rubric is applied by whoever handles the next report — no single
maintainer or session required. Deliberately NOT in CONTRIBUTING: the project
needs frictionless DX while it has near-zero contributors, and gatekeeping
prose in contributor docs optimizes for a problem we do not have.

## Rejected alternatives
A triage section in CONTRIBUTING.md (contributor-facing friction now;
reconsider only if low-quality reports actually arrive); leaving the rubric
unwritten (survives only as long as one session's memory).
