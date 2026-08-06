import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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

describe("the section: schema gate (SPEC §3, §17)", () => {
  const page = (source: string) =>
    `---\nid: gotcha/g\ntitle: Gated\nkind: gotcha\nstatus: active\ncreated: 2026-08-01\nupdated: 2026-08-01\nprovenance:\n  agent: human\n  actor: test\n  task: T-1\nsources:\n${source}---\n\nBody.\n`;

  function loreWith(source: string, schemaVersion: 1 | 2): string {
    const dir = mkdtempSync(join(tmpdir(), "loredown-gate-"));
    initLore(dir, false, "2026-08");
    if (schemaVersion === 2) {
      writeFileSync(
        join(dir, "lore/config.yaml"),
        "schema_version: 2\nbudgets:\n  page_body_lines: 40\n  pages_per_task: 3\nscan:\n  instructions: warn\n  secrets: error\nkinds: []\n",
      );
    }
    const pageDir = join(dir, "lore/pages/gotcha");
    mkdirSync(pageDir, { recursive: true });
    writeFileSync(join(pageDir, "g.md"), page(source));
    return dir;
  }

  const SECTIONED = '  - path: docs/x.md\n    sha: abc1234\n    section: "## Billing"\n';

  it("section: on a schema-1 lore fails with a pointed, guiding error", () => {
    const result = run(["lint"], loreWith(SECTIONED, 1));
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("requires schema_version: 2");
    expect(result.stdout).toContain("loredown >= 0.6");
  });

  it("section: on a schema-2 lore parses", () => {
    const result = run(["lint"], loreWith(SECTIONED, 2));
    expect(result.stdout).not.toContain("requires schema_version");
  });

  it("a section value that is not a heading line is rejected", () => {
    const result = run(
      ["lint"],
      loreWith('  - path: docs/x.md\n    sha: abc1234\n    section: "Billing"\n', 2),
    );
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("expected the quoted heading line");
  });
});
