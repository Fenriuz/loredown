---
id: decision/positioning-not-memory
title: Public copy never leads with the word "memory"
kind: decision
status: active
created: 2026-08-05
updated: 2026-08-05
provenance:
  agent: claude-code
  actor: fenriuz
  task: "v0.4.1 positioning"
sources:
  - path: README.md
    sha: "5641b7b"
    note: hook and above-the-fold claims
---

## Context
The AI-memory category is noise: mem0, supermemory, Copilot Memory, and every
vendor's per-user auto-memory. graphify — 103k stars on 2026-08-05, growing
roughly 5.5k/week — titles its own book "The Memory Layer". Leading with
"institutional memory" placed loredown inside that category, competing against
features that ship free and bundled.

## Decision
Public copy never leads with "memory". The hook leads with the problem the
reader recognises and closes on the property competitors lack: *"Your agents
keep re-learning your codebase. Make them write it down — reviewed like code,
checked for staleness."* Two rules follow. Never write "linted for staleness":
staleness is `drift`, while lint covers schema, links, budgets and secrets. And
the single deliberate use of "memory" is the essay title that subverts it.

## Why
The two real differentiators — the review gate and drift detection — are not
expressible in category language. "Memory" invites comparison on capture
volume, the axis loredown deliberately loses by design (the derivability rule).
Positioning as documentation-with-a-linter puts it beside ADRs, which teams
already trust, instead of beside vector stores, which they do not.

## Rejected alternatives
Leading with "team wiki": it names the known failure mode and lets drift kill
it in the same breath, which works in a README where the next paragraph can
qualify it — but in a search result it triggers "we already have Confluence and
it's dead" with no room to recover, so it is kept for long-form only. Leading
with "reviewed in pull requests": the strongest differentiator against vendors,
but it answers a second-line objection (*agent-written docs are slop*) rather
than the first-line question, so it is compressed to three words inside the
hook.
