---
id: gotcha/obsidian-vault-state-in-git
title: Viewer state (lore/.obsidian) must stay out of git
kind: gotcha
status: active
created: 2026-08-05
updated: 2026-08-05
provenance:
  agent: claude-code
  actor: fenriuz
  task: "v0.3.0 publish"
sources:
  - path: .gitignore
    sha: "1a73065"
    note: lore/.obsidian/ ignore line
---

## Symptom
`npm publish` fails in the `prepublishOnly` gate: Biome reports a formatter
error on `lore/.obsidian/workspace.json` — a file nobody edited.

## Cause
Opening `lore/` as an Obsidian vault creates `lore/.obsidian/`, and Obsidian
rewrites `workspace.json` on every interaction (open tabs, cursor state). Once
the directory slips into git (any `git add -A`), it churns in every commit and
feeds the format gate: Biome with `vcs.useIgnoreFile` checks everything git
tracks.

## What to do
Keep viewer state untracked: `lore/.obsidian/` is gitignored and was removed
from tracking with `git rm -r --cached` (files stay on disk). The lore is
markdown plus config only — any viewer is welcome, its state is not. The same
applies to any tool that writes state files into the tree.
