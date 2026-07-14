---
id: decision/pr-native-review
title: Knowledge review rides pull requests, not a custom approval gate
kind: decision
status: active
created: 2026-07-14
updated: 2026-07-14
provenance:
  agent: claude-code
  actor: fenriuz
  task: "phase-0 bootstrap"
sources:
  - url: https://github.com/vouchdev/vouch
    accessed: 2026-07-08
  - url: https://github.com/gastownhall/beads
    accessed: 2026-07-07
---

## Context
Agent-written knowledge needs human review before it becomes shared truth.
The 2026-07-08 deep-dive of vouch (the closest prior art) showed what a
custom local approval gate costs.

## Decision
Lore changes are reviewed in ordinary pull requests, in the same PR as the
code that produced the knowledge. loredown ships no approval state, queue,
or identity system.

## Why
Git review machinery already exists, carries real identities and CODEOWNERS,
travels with every clone, and survives parallel branches. vouch's custom gate
demonstrated the failure mode: its pending-proposals directory was gitignored
(reviews never reached teammates), and its hash-chained audit log corrupted on
any branch merge. beads showed the positive pattern: git-native, merge-safe
state with no parallel trust system.

## Rejected alternatives
vouch-style local approve/reject CLI (duplicate trust system, does not
travel); a hosted review dashboard (infrastructure, lock-in, breaks the
zero-service promise).
