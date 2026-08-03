import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ENTRY_BLOCK, installAdapter, upsertFencedBlock } from "../src/adapters.js";
import { initLore } from "../src/init.js";
import { run } from "../src/main.js";

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "loredown-adapter-"));
  initLore(dir, false, "2026-08");
  return dir;
}

describe("upsertFencedBlock", () => {
  it("creates content from scratch and appends to existing files", () => {
    expect(upsertFencedBlock(null, ENTRY_BLOCK)).toBe(`${ENTRY_BLOCK}\n`);
    const appended = upsertFencedBlock("# My rules\n", ENTRY_BLOCK);
    expect(appended.startsWith("# My rules\n")).toBe(true);
    expect(appended).toContain(ENTRY_BLOCK);
  });

  it("replaces an existing fence without touching surrounding content", () => {
    const before = `# Above\n\n<!-- loredown:begin -->\nstale content\n<!-- loredown:end -->\n\n# Below\n`;
    const after = upsertFencedBlock(before, ENTRY_BLOCK);
    expect(after).toContain("# Above");
    expect(after).toContain("# Below");
    expect(after).toContain("## Team knowledge base (lore/)");
    expect(after).not.toContain("stale content");
  });
});

describe("installAdapter", () => {
  it("rejects unknown tools", () => {
    const result = installAdapter(makeRepo(), "vim", false);
    expect(result.error).toContain('unknown tool "vim"');
  });

  it("codex: creates AGENTS.md with the entry block", () => {
    const dir = makeRepo();
    const result = installAdapter(dir, "codex", false);
    expect(result.actions).toEqual([{ path: "AGENTS.md", action: "created" }]);
    expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toContain(
      "## Team knowledge base (lore/)",
    );
  });

  it("is idempotent: a second run changes nothing", () => {
    const dir = makeRepo();
    installAdapter(dir, "claude-code", false);
    const snapshot = readFileSync(join(dir, "AGENTS.md"), "utf8");
    const again = installAdapter(dir, "claude-code", false);
    expect(again.actions.every((a) => a.action === "unchanged")).toBe(true);
    expect(readFileSync(join(dir, "AGENTS.md"), "utf8")).toBe(snapshot);
  });

  it("repairs a hand-edited fence while preserving surrounding content", () => {
    const dir = makeRepo();
    writeFileSync(join(dir, "AGENTS.md"), "# Team conventions\nUse tabs.\n");
    installAdapter(dir, "codex", false);
    const installed = readFileSync(join(dir, "AGENTS.md"), "utf8");
    writeFileSync(join(dir, "AGENTS.md"), installed.replace("**Task start:**", "**Tampered:**"));
    const repair = installAdapter(dir, "codex", false);
    expect(repair.actions).toEqual([{ path: "AGENTS.md", action: "updated" }]);
    const repaired = readFileSync(join(dir, "AGENTS.md"), "utf8");
    expect(repaired).toContain("# Team conventions\nUse tabs.");
    expect(repaired).toContain("**Task start:**");
    expect(repaired).not.toContain("**Tampered:**");
  });

  it("claude-code: ships the CLAUDE.md shim and both slash commands", () => {
    const dir = makeRepo();
    const result = installAdapter(dir, "claude-code", false);
    expect(result.actions.map((a) => a.path)).toEqual([
      "AGENTS.md",
      "CLAUDE.md",
      ".claude/commands/lore-ingest.md",
      ".claude/commands/lore-query.md",
    ]);
    expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toContain("@AGENTS.md");
    expect(readFileSync(join(dir, ".claude/commands/lore-query.md"), "utf8")).toContain(
      "$ARGUMENTS",
    );
  });

  it("claude-code: leaves a CLAUDE.md alone when it already imports AGENTS.md", () => {
    const dir = makeRepo();
    writeFileSync(join(dir, "CLAUDE.md"), "# Repo notes\n@AGENTS.md\n");
    const result = installAdapter(dir, "claude-code", false);
    const claudeAction = result.actions.find((a) => a.path === "CLAUDE.md");
    expect(claudeAction?.action).toBe("unchanged");
    expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toBe("# Repo notes\n@AGENTS.md\n");
  });

  it("cursor: creates the .mdc rule alongside AGENTS.md", () => {
    const dir = makeRepo();
    installAdapter(dir, "cursor", false);
    const rule = readFileSync(join(dir, ".cursor/rules/loredown.mdc"), "utf8");
    expect(rule).toContain("alwaysApply: true");
    expect(rule).toContain("AGENTS.md");
  });

  it("dry-run reports actions without writing anything", () => {
    const dir = makeRepo();
    const result = installAdapter(dir, "cursor", true);
    expect(result.actions.map((a) => a.action)).toEqual(["created", "created"]);
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(dir, ".cursor"))).toBe(false);
  });
});

describe("install via the CLI", () => {
  it("installs relative to the lore root and reports files", () => {
    const dir = makeRepo();
    const result = run(["install", "codex"], dir);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("created  AGENTS.md");
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(true);
  });

  it("requires an initialized lore/", () => {
    const empty = mkdtempSync(join(tmpdir(), "loredown-empty-"));
    const result = run(["install", "codex"], empty);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("loredown init");
  });

  it("init --seed on an existing lore prints the guide instead of erroring", () => {
    const dir = makeRepo();
    const result = run(["init", "--seed"], dir);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Guided bootstrap");
  });
});
