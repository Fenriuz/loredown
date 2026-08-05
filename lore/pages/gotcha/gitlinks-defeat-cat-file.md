---
id: gotcha/gitlinks-defeat-cat-file
title: Nested git repos are gitlinks — cat-file cannot resolve through them
kind: gotcha
status: active
created: 2026-08-05
updated: 2026-08-05
provenance:
  agent: claude-code
  actor: fenriuz
  task: "v0.2.0 field report"
sources:
  - url: https://git-scm.com/book/en/v2/Git-Tools-Submodules
    accessed: 2026-08-05
---

## Symptom
`git cat-file -e HEAD:<nested>/<file>` fails with "exists on disk, but not in
HEAD" for any file inside a nested git checkout, even though the file is
plainly there.

## Cause
Git stores a nested repository as a *gitlink* (tree entry mode 160000): a
commit pointer, not a tree. Neither removing the folder from .gitignore nor
declaring it a proper submodule changes this — the parent's object database
never contains the nested repo's blobs.

## What to do
Never assume the parent repo can resolve paths inside nested checkouts. Any
verification must run git *inside* the nested repo (this is why drift's
`config.repos` mapping exists). The first field report burned a full
investigation rediscovering this.
