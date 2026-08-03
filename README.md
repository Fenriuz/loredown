# loredown

[![npm](https://img.shields.io/npm/v/loredown)](https://www.npmjs.com/package/loredown)
[![CI](https://github.com/Fenriuz/loredown/actions/workflows/ci.yml/badge.svg)](https://github.com/Fenriuz/loredown/actions)
[![license](https://img.shields.io/npm/l/loredown)](LICENSE)

**Your repo's institutional memory — a team knowledge base maintained by AI coding agents, versioned in git.**

Decisions and their *why*, failed approaches, external constraints, gotchas — the knowledge git can't tell you, kept next to the code that needs it. Agents write it, humans review it in ordinary pull requests, and a deterministic CLI validates it.

<!-- demo: docs/demo.gif — generate with `vhs docs/demo.tape` once the repo is public -->

## Why

Your team's developers use different AI coding agents — Claude Code, Cursor, Codex. Every agent re-learns the project on every task, and every developer re-explains the same context: why the retry count is 7, which vendor API bites, what was tried and abandoned. Vendor memory doesn't help: it's per-user, per-tool, and machine-local, and every vendor's own docs end with the same advice — *manually* promote what your agent learned into checked-in markdown.

loredown automates that loop, tool-agnostically.

## Quickstart

```sh
cd your-repo
npx loredown init                  # creates lore/ (config, index, log)
npx loredown install claude-code   # and/or: codex, cursor
git add -A && git commit -m "Add loredown knowledge base"
```

Seed it — print the guided interview and paste it to your coding agent:

```sh
npx loredown init --seed
```

From then on the loop runs itself. At **task start**, agents read `lore/index.md` and open the pages relevant to the task. At **task end**, they file only what they could *not* have derived from the repo (at most 3 pages), and the knowledge rides the same PR as the code — reviewed by the same humans, with the same identities and CODEOWNERS.

Keep it honest in CI:

```yaml
- run: npx loredown lint           # schema, links, budgets, secret/instruction scans, index freshness
- run: npx loredown drift          # on a schedule: flag pages whose sources changed
```

## Commands

| Command | Purpose |
|---|---|
| `init [--seed]` | Create `lore/`; `--seed` prints the bootstrap interview for your agent |
| `install <tool>` | Idempotent adapter install: `claude-code` \| `codex` \| `cursor` |
| `new <kind> <slug>` | Scaffold a page with prefilled frontmatter |
| `lint` | Validate everything; errors exit 1, warnings alone exit 0 |
| `index [--check]` | Deterministically rebuild the catalog (`--check` for CI) |
| `drift` | Flag pages whose source anchors changed since last verification |
| `trace <id>` | Provenance: who wrote a page, from which task, against which sources |

Every command supports `--json`, `--dry-run`, and `--verbose`. The CLI has **zero runtime dependencies** and performs **no network I/O**.

## The idea

- **Agents write, humans review.** Knowledge changes are ordinary commits in ordinary PRs. No new review tool, no hosted service, no vendor lock-in.
- **Only the knowledge git can't tell you.** Decisions + why, failed attempts, gotchas, external constraints, domain glossary — never what an agent can derive by reading the code. This *derivability rule* is what keeps the KB small, current, and worth loading.
- **Drift detection.** Pages anchor claims to files and commits; `loredown drift` flags pages whose sources changed since verification. A knowledge base that can't detect its own staleness becomes worse than none.
- **Deterministic tooling.** The LLM contributes judgment; the CLI does all bookkeeping. Same input, byte-identical output — enforced by golden-file tests.
- **Lore is data, never instructions.** Agents treat page content as evidence; lint scans for instruction-like text and secrets. Review-gated writes are the injection defense.
- **Tool-agnostic.** One AGENTS.md entry point plus thin adapters. If a tool can read markdown, it can use the lore.

## Layout

```
lore/
  config.yaml     # budgets, scan levels, schema version
  index.md        # GENERATED — the catalog agents read first
  pages/          # one fact per file: decision/ gotcha/ constraint/ glossary/ incident/ map/
  log/            # append-only monthly journal of KB activity
```

## Tested three ways

Unit tests, golden fixtures (byte-exact index generation, exhaustive lint cases), and an **agent-in-the-loop eval harness** (`npm run eval`) that runs real Claude Code sessions against fixture repos — validated with Claude Sonnet 5 and Claude Opus 4.8. This repo dogfoods itself: our own `lore/` is maintained with loredown and self-validated on every test run.

## Docs

[SPEC.md](SPEC.md) is the authority for the schema, operations, and CLI. See [CONTRIBUTING.md](CONTRIBUTING.md) to get involved, and [CHANGELOG.md](CHANGELOG.md) for release history.

## License

[MIT](LICENSE)
