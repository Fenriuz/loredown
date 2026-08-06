---
id: decision/pinned-adapter-commands
title: Adapter-written commands are pinned to the installing version
kind: decision
status: active
created: 2026-08-05
updated: 2026-08-05
provenance:
  agent: claude-code
  actor: fenriuz
  task: "v0.4.0 field report"
sources:
  - path: SPEC.md
    sha: "1f3730e"
    section: "## 12. Entry point and adapters"
    note: §12 pinning rationale
---

## Context
Adapters wrote unpinned `npx loredown` into AGENTS.md, slash commands and
rules. Three releases shipped in three days; `latest` resolution meant a
team's behavior could change with no commit in their repo, through
agent-executed commands — the least observable channel (third field report).

## Decision
`install` writes `npx loredown@<version>` — the version that wrote the block.
Re-running install refreshes the pin, so an upgrade is always a reviewable
fence diff in a PR, never a silent registry-side change.

## Why
"LLM proposes, toolchain disposes" only holds if the toolchain is fixed: an
unpinned npx lets the deterministic half of the contract float with the
registry. Same supply-chain stance as the zero-runtime-deps rule.

## Rejected alternatives
`cli_version` in config with an older-version warning (redundant once the
executed commands are pinned; one more field somebody must bump per release);
relying on devDependency pinning alone (works and is documented, but requires
teams to know to do it — the default must be the safe one).
