import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { driftLore } from "../src/drift.js";
import { parseYamlSubset } from "../src/fm.js";
import { initLore } from "../src/init.js";
import { loadLore } from "../src/load.js";

function sh(cwd: string, args: string[]): string {
  return execFileSync("git", ["-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
  }).trim();
}

function makeRepo(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `loredown-${label}-`));
  sh(dir, ["init", "-b", "main"]);
  sh(dir, ["config", "user.email", "test@example.com"]);
  sh(dir, ["config", "user.name", "Test"]);
  return dir;
}

function commitAll(dir: string, message: string): string {
  sh(dir, ["add", "-A"]);
  sh(dir, ["commit", "-m", message]);
  return sh(dir, ["rev-parse", "--short", "HEAD"]);
}

function writeConfig(umbrella: string, extra: string): void {
  writeFileSync(
    join(umbrella, "lore/config.yaml"),
    `schema_version: 1\nbudgets:\n  page_body_lines: 40\n  pages_per_task: 3\nscan:\n  instructions: warn\n  secrets: error\nkinds: []\n${extra}`,
  );
}

function writePage(umbrella: string, sourceLines: string[]): void {
  const path = join(umbrella, "lore/pages/constraint/cross.md");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    [
      "---",
      "id: constraint/cross",
      "title: A fact anchored across repos",
      "kind: constraint",
      "status: active",
      "created: 2026-08-01",
      "updated: 2026-08-01",
      "provenance:",
      "  agent: claude-code",
      "  actor: test",
      "  task: T-1",
      "sources:",
      ...sourceLines,
      "---",
      "",
      "Body.",
      "",
    ].join("\n"),
  );
}

/** Umbrella repo + sibling module repo (the field-reported pattern). */
function makeUmbrellaWithModule(): { umbrella: string; module: string; moduleSha: string } {
  const umbrella = makeRepo("umbrella");
  const module = makeRepo("module");
  writeFileSync(join(module, "lib.ts"), "export const LIMIT = 3;\n");
  const moduleSha = commitAll(module, "module: initial");
  initLore(umbrella, false, "2026-08");
  writeConfig(umbrella, `repos:\n  mod: ../${basename(module)}\n`);
  commitAll(umbrella, "umbrella: lore");
  return { umbrella, module, moduleSha };
}

describe("driftLore across sibling repos", () => {
  it("verifies a repo: source inside the mapped checkout", () => {
    const { umbrella, moduleSha } = makeUmbrellaWithModule();
    writePage(umbrella, ["  - repo: mod", "    path: lib.ts", `    sha: ${moduleSha}`]);
    const result = driftLore(loadLore(join(umbrella, "lore")), umbrella);
    expect(result.findings).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it("warns SRC_STALE when the sibling file changed since the anchor", () => {
    const { umbrella, module, moduleSha } = makeUmbrellaWithModule();
    writePage(umbrella, ["  - repo: mod", "    path: lib.ts", `    sha: ${moduleSha}`]);
    writeFileSync(join(module, "lib.ts"), "export const LIMIT = 5;\n");
    commitAll(module, "raise limit");
    const { findings } = driftLore(loadLore(join(umbrella, "lore")), umbrella);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("SRC_STALE");
    expect(findings[0]?.message).toContain("mod:lib.ts");
  });

  it("skips (never fails) when the checkout is absent", () => {
    const { umbrella, moduleSha } = makeUmbrellaWithModule();
    writeConfig(umbrella, "repos:\n  mod: ../this-checkout-does-not-exist\n");
    writePage(umbrella, ["  - repo: mod", "    path: lib.ts", `    sha: ${moduleSha}`]);
    const result = driftLore(loadLore(join(umbrella, "lore")), umbrella);
    expect(result.findings).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.repo).toBe("mod");
    expect(result.skipped[0]?.count).toBe(1);
  });

  it("errors SRC_REPO on an undeclared repo name", () => {
    const { umbrella, moduleSha } = makeUmbrellaWithModule();
    writePage(umbrella, ["  - repo: ghost", "    path: lib.ts", `    sha: ${moduleSha}`]);
    const { findings } = driftLore(loadLore(join(umbrella, "lore")), umbrella);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("SRC_REPO");
  });

  it("distinguishes SRC_UNTRACKED (on disk, not in tree) from SRC_GONE", () => {
    const umbrella = makeRepo("untracked");
    initLore(umbrella, false, "2026-08");
    const sha = commitAll(umbrella, "initial");
    // Present on disk, never committed — the gitlink/ignored-path shape.
    mkdirSync(join(umbrella, "modulo"), { recursive: true });
    writeFileSync(join(umbrella, "modulo/package.json"), "{}\n");
    writePage(umbrella, ["  - path: modulo/package.json", `    sha: ${sha}`]);
    const { findings } = driftLore(loadLore(join(umbrella, "lore")), umbrella);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("SRC_UNTRACKED");
    expect(findings[0]?.message).toContain("exists on disk");
  });

  it("warns URL_STALE past the configured accessed-age horizon (drift-only)", () => {
    const umbrella = makeRepo("urlage");
    initLore(umbrella, false, "2026-08");
    writeConfig(umbrella, "repos: {}\n");
    writeFileSync(
      join(umbrella, "lore/config.yaml"),
      `schema_version: 1\nbudgets:\n  url_accessed_max_age_days: 180\nscan:\n  instructions: warn\n  secrets: error\nkinds: []\n`,
    );
    writePage(umbrella, ["  - url: https://example.com/doc", "    accessed: 2020-01-01"]);
    commitAll(umbrella, "lore");
    const { findings } = driftLore(loadLore(join(umbrella, "lore")), umbrella);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("URL_STALE");
    expect(findings[0]?.level).toBe("warn");
  });
});

describe("config repos validation", () => {
  it("parses hyphenated repo names in the YAML subset", () => {
    expect(parseYamlSubset("repos:\n  rfid-svc: ../rfid-svc")).toEqual({
      repos: { "rfid-svc": "../rfid-svc" },
    });
  });

  it("rejects absolute paths in repos values", () => {
    const umbrella = makeRepo("absrepo");
    initLore(umbrella, false, "2026-08");
    writeConfig(umbrella, "repos:\n  mod: /tmp/somewhere\n");
    const load = loadLore(join(umbrella, "lore"));
    expect(
      load.findings.some((f) => f.code === "CONFIG_FIELD" && f.message.includes("absolute")),
    ).toBe(true);
  });
});
