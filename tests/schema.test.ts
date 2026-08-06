import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { initLore } from "../src/init.js";
import { run } from "../src/main.js";

/** A lore declaring a schema newer than this CLI knows. */
function makeFutureLore(): string {
  const dir = mkdtempSync(join(tmpdir(), "loredown-schema-"));
  initLore(dir, false, "2026-08");
  writeFileSync(
    join(dir, "lore/config.yaml"),
    "schema_version: 99\nbudgets:\n  page_body_lines: 40\n  pages_per_task: 3\nscan:\n  instructions: warn\n  secrets: error\nkinds: []\n",
  );
  return dir;
}

describe("uniform schema refusal (SPEC §17)", () => {
  const COMMANDS: string[][] = [
    ["lint"],
    ["index"],
    ["index", "--check"],
    ["drift"],
    ["trace", "gotcha/x"],
    ["new", "gotcha", "x"],
    ["import", "docs", "--kind", "map"],
    ["install", "codex"],
  ];

  it("every lore-reading command refuses with exit 1 and only the schema finding", () => {
    const dir = makeFutureLore();
    for (const argv of COMMANDS) {
      const result = run(argv, dir);
      expect(result.code, argv.join(" ")).toBe(1);
      expect(result.stdout, argv.join(" ")).toContain("schema_version 99 is newer");
      // Per-page noise against a future schema is exactly what the refusal suppresses.
      expect(result.stdout, argv.join(" ")).not.toContain("FM_FIELD");
    }
  });

  it("--json refusal carries exactly the schema finding, nothing else", () => {
    const result = run(["drift", "--json"], makeFutureLore());
    expect(result.code).toBe(1);
    const parsed = JSON.parse(result.stdout) as { findings: { code: string }[] };
    expect(parsed.findings.map((f) => f.code)).toEqual(["SCHEMA_VERSION"]);
  });

  it("a current-schema lore is unaffected", () => {
    const dir = mkdtempSync(join(tmpdir(), "loredown-schema-ok-"));
    initLore(dir, false, "2026-08");
    expect(run(["lint"], dir).code).toBe(0);
  });
});
