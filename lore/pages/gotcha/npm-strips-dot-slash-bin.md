---
id: gotcha/npm-strips-dot-slash-bin
title: Newer npm removes ./-prefixed bin entries at publish instead of normalizing
kind: gotcha
status: active
created: 2026-08-05
updated: 2026-08-05
provenance:
  agent: claude-code
  actor: fenriuz
  task: "v0.2.0 release"
sources:
  - url: https://docs.npmjs.com/cli/v11/configuring-npm/package-json
    accessed: 2026-08-05
---

## Symptom
`npm publish` warns `"bin[loredown]" script name dist/cli.js was invalid and
removed` — and the published package ships with **no executable**, so every
`npx loredown` breaks. Easy to miss among publish noise.

## Cause
Older npm normalized `"./dist/cli.js"` to `"dist/cli.js"`. Newer npm (the
post-2025 hardened releases) treats the `./` prefix as invalid and silently
*removes* the whole bin entry from the manifest it publishes.

## What to do
Keep `bin` values bare (`dist/cli.js`, no `./`). Before any release, treat any
`npm warn publish … removed` line as a release blocker, and check
`npm pack --dry-run` output. `npm pkg fix` normalizes the field.
