---
id: decision/use-postgres
title: Postgres over MySQL for the primary store
kind: decision
status: active
created: 2026-07-01
updated: 2026-07-10
provenance:
  agent: claude-code
  actor: alice
  task: "PR #12"
sources:
  - path: src/db/client.ts
    sha: abc1234
    note: connection setup
  - url: https://example.com/benchmark
    accessed: 2026-07-01
---

## Context
We needed a relational store with JSON support.

## Decision
Postgres 16.

## Why
JSONB indexing beat MySQL in our benchmark; see [[gotcha/pg-pool-timeout]].

## Rejected alternatives
MySQL 8 (weaker JSON), SQLite (no concurrent writers).
