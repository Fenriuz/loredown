---
id: gotcha/bare-layout-obeys-tracked-config
title: Tracked files laid out like a bare repo make git obey their config
kind: gotcha
status: active
created: 2026-11-12
updated: 2026-11-12
provenance:
  agent: claude-code
  actor: fenriuz
  task: "0.6.1 security patch"
sources:
  - url: https://git-scm.com/docs/git-config#Documentation/git-config.txt-safebareRepository
    accessed: 2026-11-12
---

## Symptom
From 0.2.0 through 0.6.0, `drift` on a freshly pulled change could run a
program that the change itself chose. `lint` was clean and nothing in the diff
was named `.git`.

## Cause
Git adopts any directory holding `HEAD`, `config`, `objects/` and `refs/` as a
bare repository when a command runs inside it, and then obeys that `config` —
including the keys that name programs (signature verification, filters, diff
drivers). Git refuses to track a path named `.git`, but those four names are
ordinary files anyone can commit. A `repos:` entry pointing at such a directory
was enough: loredown asked git "is this a repository?" and git said yes. The
hole sat in three commands (`drift`, `trace`, `import`) for three months and
was found only by an adversarial review of an unrelated spec draft.

## What to do
Any code path that runs git in a directory named by config or by page content
passes one gate first: the directory carries its own `.git` entry. Passing
`safe.bareRepository=explicit` on every invocation is the second lock, but git
older than 2.38 ignores that key, so it can never be the only one. A bare
mirror is not a valid `repos:` target for the same reason. The regression
fixture plants such a layout and carries a control assertion proving the
planted config is still live under raw git — without that control the tests
prove nothing. Nested repositories surprise this tool in a second, unrelated
way: [[gotcha/gitlinks-defeat-cat-file]].
