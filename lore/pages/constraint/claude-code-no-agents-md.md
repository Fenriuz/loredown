---
id: constraint/claude-code-no-agents-md
title: Claude Code does not read AGENTS.md natively
kind: constraint
status: active
created: 2026-07-14
updated: 2026-07-14
provenance:
  agent: claude-code
  actor: fenriuz
  task: "phase-0 bootstrap"
sources:
  - url: https://code.claude.com/docs/en/memory
    accessed: 2026-07-07
  - url: https://agents.md
    accessed: 2026-07-07
---

## The constraint
Claude Code reads CLAUDE.md, not AGENTS.md — despite AGENTS.md being the
cross-tool standard (Linux Foundation AAIF, ~23 adopters including Codex,
Cursor, Copilot, Gemini CLI). Anthropic co-founded AAIF but has not adopted
the file. Official workarounds: a CLAUDE.md containing `@AGENTS.md`, or a
symlink.

## Origin
Verified against the official Claude Code memory docs on 2026-07-07, which
explicitly recommend the import/symlink workaround. Third-party posts claiming
native support are contradicted by those docs.

## Implications
The Claude Code adapter must ship a CLAUDE.md shim (`@AGENTS.md`) and must not
assume AGENTS.md is loaded. Re-check this constraint periodically — if
Anthropic adopts AGENTS.md, the shim becomes unnecessary.
