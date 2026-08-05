import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { driftLore } from "../src/drift.js";
import { initLore } from "../src/init.js";
import { loadLore } from "../src/load.js";

function sh(cwd: string, args: string[]): string {
  return execFileSync("git", ["-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
  }).trim();
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "loredown-drift-"));
  sh(dir, ["init", "-b", "main"]);
  sh(dir, ["config", "user.email", "test@example.com"]);
  sh(dir, ["config", "user.name", "Test"]);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src/a.ts"), "export const a = 1;\n");
  sh(dir, ["add", "-A"]);
  sh(dir, ["commit", "-m", "initial"]);
  return dir;
}

function writeAnchoredPage(dir: string, sha: string): void {
  const path = join(dir, "lore/pages/gotcha/anchored.md");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    [
      "---",
      "id: gotcha/anchored",
      "title: A fact anchored to src/a.ts",
      "kind: gotcha",
      "status: active",
      "created: 2026-07-01",
      "updated: 2026-07-01",
      "provenance:",
      "  agent: claude-code",
      "  actor: test",
      "  task: T-1",
      "sources:",
      "  - path: src/a.ts",
      `    sha: ${sha}`,
      "---",
      "",
      "Body.",
      "",
    ].join("\n"),
  );
}

describe("driftLore", () => {
  it("is clean when the anchored file is untouched since the sha", () => {
    const dir = makeRepo();
    initLore(dir, false, "2026-07");
    writeAnchoredPage(dir, sh(dir, ["rev-parse", "--short", "HEAD"]));
    expect(driftLore(loadLore(join(dir, "lore")), dir).findings).toEqual([]);
  });

  it("warns with the commit count when the anchored file changed", () => {
    const dir = makeRepo();
    initLore(dir, false, "2026-07");
    writeAnchoredPage(dir, sh(dir, ["rev-parse", "--short", "HEAD"]));
    writeFileSync(join(dir, "src/a.ts"), "export const a = 2;\n");
    sh(dir, ["commit", "-am", "change a"]);
    const findings = driftLore(loadLore(join(dir, "lore")), dir).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("SRC_STALE");
    expect(findings[0]?.level).toBe("warn");
    expect(findings[0]?.message).toContain("1 commit");
  });

  it("errors when the anchored file was deleted", () => {
    const dir = makeRepo();
    initLore(dir, false, "2026-07");
    writeAnchoredPage(dir, sh(dir, ["rev-parse", "--short", "HEAD"]));
    sh(dir, ["rm", "src/a.ts"]);
    sh(dir, ["commit", "-m", "remove a"]);
    const findings = driftLore(loadLore(join(dir, "lore")), dir).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("SRC_GONE");
    expect(findings[0]?.level).toBe("error");
  });

  it("errors on an unresolvable sha", () => {
    const dir = makeRepo();
    initLore(dir, false, "2026-07");
    writeAnchoredPage(dir, "deadbee");
    const findings = driftLore(loadLore(join(dir, "lore")), dir).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("SRC_SHA");
  });

  it("errors outside a git repository", () => {
    const dir = mkdtempSync(join(tmpdir(), "loredown-norepo-"));
    initLore(dir, false, "2026-07");
    const findings = driftLore(loadLore(join(dir, "lore")), dir).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("GIT_REPO");
  });

  it("ignores superseded pages and url sources", () => {
    const dir = makeRepo();
    initLore(dir, false, "2026-07");
    writeAnchoredPage(dir, sh(dir, ["rev-parse", "--short", "HEAD"]));
    writeFileSync(join(dir, "src/a.ts"), "export const a = 3;\n");
    sh(dir, ["commit", "-am", "change a"]);
    // Flip the page to superseded: its stale anchor must no longer be reported.
    const page = join(dir, "lore/pages/gotcha/anchored.md");
    const text = readFileSync(page, "utf8");
    writeFileSync(page, text.replace("status: active", "status: superseded"));
    expect(driftLore(loadLore(join(dir, "lore")), dir).findings).toEqual([]);
  });
});
