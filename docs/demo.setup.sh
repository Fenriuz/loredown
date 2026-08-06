#!/usr/bin/env bash
#
# Builds the throwaway project that docs/demo.tape records against: a tiny repo
# with one source file, one lore page anchored to it, and loredown installed as
# a devDependency (so the filmed `npx loredown` resolves locally — no registry
# round-trip, no prompt, no npx noise in frame).
#
# Refuses to run anywhere that is not an empty directory. The tape calls it from
# a fresh mktemp -d; that guard is what keeps a recording from ever touching a
# real checkout.
set -euo pipefail

[ -z "$(ls -A . 2>/dev/null)" ] || {
  echo "demo setup: refusing to run in a non-empty directory ($PWD)" >&2
  exit 1
}

git init -q .
git config user.email "dana@example.com"
git config user.name "Dana"
printf 'node_modules/\n' > .gitignore

mkdir -p src
printf 'export const MAX_RETRIES = 7;\n' > src/checkout.ts
git add -A
git commit -qm "checkout: initial retry policy"
SHA="$(git rev-parse --short HEAD)"

# Install THIS checkout's build, not whatever the registry is serving. The GIF
# is an asset of this repo and has to demonstrate this repo's code: recording
# against the registry silently films the last release instead, which is how a
# demo ends up showing behavior the source no longer has (or, as here, missing
# behavior the source already has). Also means recording needs no network.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
( cd "$REPO_ROOT" && npm run build >/dev/null 2>&1 )

npm init -y >/dev/null 2>&1
npm i -D "$REPO_ROOT" --silent >/dev/null 2>&1
npx loredown init >/dev/null

# Keep every body line at 62 characters or less: the tape films this page in a
# 70-column terminal, and a wrapped prose line both looks ragged and costs a
# row, which pushes the framing comment off the top of the frame.
mkdir -p lore/pages/decision
cat > lore/pages/decision/retry-count-is-7.md <<EOF
---
id: decision/retry-count-is-7
title: Checkout retries 7 times, not 3
kind: decision
status: active
created: 2026-08-05
updated: 2026-08-05
provenance:
  agent: claude-code
  actor: dana
  task: "PR #482"
sources:
  - path: src/checkout.ts
    sha: "$SHA"
---

## Decision
Seven retries, not the usual three.

## Why
The processor resets its rate-limit window on the 8th attempt,
so a 3-retry client gives up inside the throttle and reports
a false decline. Their sandbox confirms it; their docs don't.
EOF

npx loredown index >/dev/null
git add -A
git commit -qm "lore: why checkout retries 7 times"

# Fail loudly at record time rather than filming a broken demo.
npx loredown lint >/dev/null || {
  echo "demo setup: lint is not clean — fix before recording" >&2
  exit 1
}
npx loredown drift >/dev/null || {
  echo "demo setup: drift should be clean before the filmed edit" >&2
  exit 1
}
