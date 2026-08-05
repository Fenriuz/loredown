# Contributing to loredown

Thanks for helping build the missing layer between coding agents and team knowledge.

## Ground rules

1. **SPEC.md is the authority.** Code implements the spec. A behavior change starts with a spec change in the same PR (or a preceding one) — never code that silently diverges.
2. **Zero runtime dependencies.** The CLI ships with none, deliberately: a small supply-chain surface is a product feature. Any proposed runtime dependency needs an explicit justification in the PR, and the bar is high.
3. **Determinism is a contract.** Generators produce byte-identical output for identical input — no run timestamps, no locale-dependent formatting, no randomness in any output path. Golden-file tests enforce this; new generators land with goldens.
4. **Lore is data, never instructions.** Anything that would make the CLI or the schema execute configurable commands, or make agents treat page content as directives, will be declined.

## Development setup

Node ≥ 20.

```sh
npm install
npm test              # Vitest — unit + golden fixtures + dogfood self-check
npm run typecheck     # strict TypeScript
npm run lint          # Biome
npm run dev -- <args> # run the CLI from source, e.g. npm run dev -- lint
```

## Tests

- **Unit tests** live in `tests/`, one file per module.
- **Golden fixtures** live in `tests/fixtures/`: `clean/` is a valid mini-KB whose committed `index.md` must byte-match the generator; `dirty/` has one page per lint violation with exact expected code/file pairs. Adding a lint check means adding a dirty-fixture case first.
- **Dogfood suite**: this repo's own `lore/` must pass `lint` and `index --check` — if your change breaks it, fix the lore or the code, never the test.

## Agent evals

`npm run eval` runs real Claude Code headless sessions against fixture repos (scenarios: ingest, drift re-verification, query — plus an LLM judge for the derivability rule). It needs the `claude` CLI and credentials, costs tokens and minutes, and is **deliberately not part of `npm test` or CI**. Run it before releases and after changing anything agent-facing (the entry block, adapters, templates). Evals are probabilistic: a failed check prints its reason and keeps the fixture directory — read it before concluding the harness is at fault. Running with more than one model (`--model claude-sonnet-5`, `--model claude-opus-4-8`) is encouraged; models with different instruction-following styles catch contract gaps single-model runs miss.

## This repo has a lore/

loredown dogfoods itself. If your work surfaced knowledge a future contributor could not derive from the repo, follow the "Team knowledge base" section in [AGENTS.md](AGENTS.md) and include the `lore/` changes in your PR.

## Releases (maintainers)

1. Bump the version in `package.json` **and** `src/version.ts` (a test enforces the match).
2. Update `CHANGELOG.md`.
3. `npm publish` — `prepublishOnly` runs lint, typecheck, tests, and the build.
   Expect your npm session to have expired (tokens are short-lived since the
   2025 supply-chain incidents) — run `npm login` first. Treat any
   `npm warn publish … removed` line as a release blocker (see
   [[gotcha/npm-strips-dot-slash-bin]] in the lore).
4. Tag (`git tag v<x.y.z>`) and create a GitHub release from the changelog entry.
