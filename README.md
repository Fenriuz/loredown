# loredown

**Your repo's institutional memory — a team knowledge base maintained by AI coding agents, versioned in git.**

> Status: **pre-release, spec phase.** The design lives in [SPEC.md](SPEC.md); the validator CLI is under construction. Nothing is published to npm yet.

## The problem

Your team's developers use different AI coding agents — Claude Code, Cursor, Codex. Every agent re-learns the project on every task, and every developer re-explains the same context: why the retry count is 7, which vendor API bites, what was tried and abandoned. Vendor memory doesn't help — it's per-user, per-tool, and machine-local. Every vendor's own docs end with the same advice: *manually* promote what your agent learned into checked-in markdown.

loredown automates that loop.

## The idea

A `lore/` directory of small markdown pages inside your repo, written and maintained by whatever coding agent each teammate uses, reviewed by humans in ordinary pull requests, and validated by a deterministic CLI:

- **Agents write, humans review.** Knowledge changes ride the same PRs as code. No new review tool, no hosted service, no vendor lock-in.
- **Only the knowledge git can't tell you.** Decisions and their *why*, failed attempts, gotchas, constraints, domain glossary — never what an agent can derive by reading the code. That rule is what keeps the KB small, current, and worth loading.
- **Drift detection.** Pages anchor their claims to files and commits; `loredown drift` flags pages whose sources changed since they were last verified. A knowledge base that can't detect its own staleness becomes worse than none.
- **Deterministic tooling.** The LLM contributes judgment; a CLI does all bookkeeping — index generation, link checking, schema validation, secret/instruction scanning. Same input, byte-identical output.
- **Tool-agnostic.** One AGENTS.md entry point plus thin adapters for Claude Code, Codex, and Cursor. If a tool can read markdown, it can use the lore.

## Layout

```
lore/
  config.yaml     # budgets, scan levels, schema version
  index.md        # GENERATED — the catalog agents read first
  pages/          # one fact per file: decision/ gotcha/ constraint/ glossary/ incident/ map/
  log/            # append-only monthly journal of KB activity
```

This repo dogfoods itself: our own `lore/` is maintained with loredown from day one.

## Roadmap

Spec → validator CLI (`init`, `lint`, `index`, `drift`, `trace`) → agent adapters → seeded bootstrap → agent-in-the-loop eval harness → publish. See [SPEC.md](SPEC.md).

## License

[MIT](LICENSE)
