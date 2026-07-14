---
id: decision/name-loredown
title: The project is named loredown
kind: decision
status: active
created: 2026-07-14
updated: 2026-07-14
provenance:
  agent: claude-code
  actor: fenriuz
  task: "phase-0 bootstrap"
sources:
  - url: https://registry.npmjs.org/loredown
    accessed: 2026-07-14
  - url: https://github.com/loredown
    accessed: 2026-07-14
---

## Context
The tool needed a name that is pronounceable, meaningful, and free on npm and
GitHub. Availability was checked on 2026-07-14 against the npm registry and
GitHub org namespace (404 = free on both for "loredown").

## Decision
**loredown** — wordplay on "the lowdown" (the essential, real facts), "lore"
(a team's accumulated knowledge), and the "-down" of markdown, the medium.

## Why
Says what it is before it's explained, easy to say in a standup, unique in
search results, and both namespaces were free.

## Rejected alternatives
`tacit`, `gitlore`, `canonize`, `engram`, `folklore`, `deja`, `knowhow`,
`codelore` — all taken on npm (checked 2026-07-14). `kbllm` — available but
unpronounceable and dated by "llm". `lorestone` — npm free but GitHub org
taken. Also noted: "vouch" as a name is dominated by mitchellh/vouch, a
lesson in checking collisions early.
