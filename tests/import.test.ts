import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { initLore } from "../src/init.js";
import { lintLore } from "../src/lint.js";
import { loadLore } from "../src/load.js";
import { run } from "../src/main.js";

function sh(cwd: string, args: string[]): string {
  return execFileSync("git", ["-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
  }).trim();
}

function makeWikiRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "loredown-import-"));
  sh(dir, ["init", "-b", "main"]);
  sh(dir, ["config", "user.email", "test@example.com"]);
  sh(dir, ["config", "user.name", "Test"]);
  mkdirSync(join(dir, "docs"), { recursive: true });
  const longBody = Array.from({ length: 85 }, (_, i) => `line ${i + 1} of the old wiki page`);
  writeFileSync(
    join(dir, "docs/API Reference.md"),
    `# Payment API Reference\n\n## Endpoints\n${longBody.join("\n")}\n\n## Auth\nmore text\n`,
  );
  writeFileSync(join(dir, "docs/notes.md"), "Short page without a heading.\n");
  initLore(dir, false, "2026-08");
  sh(dir, ["add", "-A"]);
  sh(dir, ["commit", "-m", "wiki + lore"]);
  return dir;
}

describe("loredown import", () => {
  it("scaffolds valid pages anchored to the original files, marked imported", () => {
    const dir = makeWikiRepo();
    const result = run(["import", "docs", "--kind", "map"], dir);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("2 pages imported");

    const load = loadLore(join(dir, "lore"));
    expect(load.findings).toEqual([]); // structurally valid by construction — no TODOs
    const api = load.pages.find((p) => p.id === "map/api-reference");
    expect(api).toBeDefined();
    expect(api?.title).toBe("Payment API Reference");
    expect(api?.imported).toBe(true);
    const source = api?.sources[0];
    expect(source !== undefined && "path" in source && source.path).toBe("docs/API Reference.md");
    expect(load.pages.some((p) => p.id === "map/notes")).toBe(true);
  });

  it("downgrades the hard budget error on imported pages and flags pending curation", () => {
    const dir = makeWikiRepo();
    run(["import", "docs", "--kind", "map"], dir);
    run(["index", "--lore", join(dir, "lore")], dir);
    const findings = lintLore(loadLore(join(dir, "lore")));
    expect(findings.filter((f) => f.level === "error")).toEqual([]);
    const hard = findings.find((f) => f.code === "BODY_OVER_HARD");
    expect(hard?.level).toBe("warn");
    expect(hard?.message).toContain("split seams: Endpoints · Auth");
    expect(findings.filter((f) => f.code === "IMPORTED")).toHaveLength(2);
  });

  it("keeps the hard budget as an error on non-imported pages", () => {
    const dir = makeWikiRepo();
    const body = Array.from({ length: 85 }, (_, i) => `line ${i + 1}`).join("\n");
    mkdirSync(join(dir, "lore/pages/map"), { recursive: true });
    writeFileSync(
      join(dir, "lore/pages/map/manual.md"),
      `---\nid: map/manual\ntitle: Manually written oversized page\nkind: map\nstatus: active\ncreated: 2026-08-01\nupdated: 2026-08-01\nprovenance:\n  agent: human\n  actor: test\n  task: T-1\nsources:\n  - url: https://example.com\n    accessed: 2026-08-01\n---\n\n${body}\n`,
    );
    run(["index", "--lore", join(dir, "lore")], dir);
    const findings = lintLore(loadLore(join(dir, "lore")));
    expect(findings.find((f) => f.code === "BODY_OVER_HARD")?.level).toBe("error");
  });

  it("skips slug collisions instead of overwriting", () => {
    const dir = makeWikiRepo();
    run(["import", "docs", "--kind", "map"], dir);
    const again = run(["import", "docs", "--kind", "map"], dir);
    expect(again.code).toBe(0);
    expect(again.stdout).toContain("0 pages imported");
    expect(again.stdout).toContain("already exists");
  });

  it("requires --kind and writes nothing on --dry-run", () => {
    const dir = makeWikiRepo();
    expect(run(["import", "docs"], dir).code).toBe(2);
    const dry = run(["import", "docs", "--kind", "map", "--dry-run"], dir);
    expect(dry.code).toBe(0);
    expect(existsSync(join(dir, "lore/pages/map/notes.md"))).toBe(false);
  });

  it("lint errors SRC_REPO when a source names an undeclared repo", () => {
    const dir = makeWikiRepo();
    mkdirSync(join(dir, "lore/pages/constraint"), { recursive: true });
    writeFileSync(
      join(dir, "lore/pages/constraint/x.md"),
      `---\nid: constraint/x\ntitle: Cross-repo fact\nkind: constraint\nstatus: active\ncreated: 2026-08-01\nupdated: 2026-08-01\nprovenance:\n  agent: human\n  actor: test\n  task: T-1\nsources:\n  - repo: ghost\n    path: lib.ts\n    sha: abc1234\n---\n\nBody.\n`,
    );
    run(["index", "--lore", join(dir, "lore")], dir);
    const findings = lintLore(loadLore(join(dir, "lore")));
    expect(findings.some((f) => f.code === "SRC_REPO" && f.level === "error")).toBe(true);
  });
});
