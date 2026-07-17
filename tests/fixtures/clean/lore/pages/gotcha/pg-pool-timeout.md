---
id: gotcha/pg-pool-timeout
title: Pool exhaustion looks like random 30s hangs
kind: gotcha
status: active
created: 2026-07-10
updated: 2026-07-10
provenance:
  agent: codex
  actor: carol
  task: INC-7
sources:
  - path: src/db/pool.ts
    sha: 1234abc
---

## Symptom
Requests hang for ~30 seconds and then fail under load.

## Cause
Default pool size is 10; long transactions starve it.

## What to do
Check for long-running transactions before raising the pool size.
