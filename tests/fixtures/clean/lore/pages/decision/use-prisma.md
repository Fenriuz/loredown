---
id: decision/use-prisma
title: Prisma replaces TypeORM
kind: decision
status: active
created: 2026-07-05
updated: 2026-07-05
provenance:
  agent: claude-code
  actor: alice
  task: "PR #30"
sources:
  - path: prisma/schema.prisma
    sha: def5678
supersedes: decision/old-orm
---

## Context
TypeORM migrations kept breaking on every schema change.

## Decision
Prisma.

## Why
Generated types caught three bugs in the first week.

## Rejected alternatives
Drizzle (too new for the team at the time).
