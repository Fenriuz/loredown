---
id: decision/in-repo-markdown-over-memory-stores
title: The KB is markdown in the repo, not an external memory store
kind: decision
status: active
created: 2026-07-14
updated: 2026-07-14
provenance:
  agent: claude-code
  actor: fenriuz
  task: "phase-0 bootstrap"
sources:
  - url: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
    accessed: 2026-07-07
  - url: https://developers.openai.com/codex/memories
    accessed: 2026-07-07
---

## Context
Team knowledge for coding agents could live in an external memory service
(mem0, Letta, Zep, cloud sync) or as plain files versioned with the code.

## Decision
Plain markdown inside the repo, shared via ordinary git flow.

## Why
Reviewable in PRs (the trust mechanism opaque stores cannot offer), zero
infrastructure, versioned and branched with the code it describes, readable
by any tool that can open a file, and survives vendor churn. Vendors agree on
the substrate: OpenAI's own docs say to keep durable team guidance "in
AGENTS.md or checked-in documentation". At repo scale, index-first navigation
plus grep beats embedding retrieval (Karpathy's observation, confirmed by our
prototype).

## Rejected alternatives
External vector/graph memory stores (opaque, per-user or cloud-team, not
reviewable); vendor team-memory features (single-ecosystem, hosted, not
portable across the mixed-tool teams this project targets).
