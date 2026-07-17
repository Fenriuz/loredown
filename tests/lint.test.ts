import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { formatJson } from "../src/findings.js";
import { lintLore } from "../src/lint.js";
import { loadLore } from "../src/load.js";

const CLEAN = fileURLToPath(new URL("fixtures/clean/lore", import.meta.url));
const DIRTY = fileURLToPath(new URL("fixtures/dirty/lore", import.meta.url));

describe("lintLore on the clean fixture", () => {
  it("reports zero findings", () => {
    expect(lintLore(loadLore(CLEAN))).toEqual([]);
  });
});

describe("lintLore on the dirty fixture", () => {
  const findings = lintLore(loadLore(DIRTY));

  it("reports exactly the expected code/file pairs", () => {
    const got = findings.map((f) => `${f.code} ${f.file}`).sort();
    expect(got).toEqual(
      [
        "BODY_OVER_BUDGET lore/pages/gotcha/slightly-long.md",
        "BODY_OVER_HARD lore/pages/gotcha/too-long.md",
        "DUP_TITLE lore/pages/decision/twin-b.md",
        "FM_FIELD lore/pages/decision/broken-fm.md",
        "ID_MISMATCH lore/pages/decision/wrong-id.md",
        "INDEX_STALE lore/index.md",
        "KIND_UNKNOWN lore/pages/mystery/thing.md",
        "LINK_BROKEN lore/pages/decision/bad-link.md",
        "LOG_ENTRY lore/log/2026-01.md",
        "LOG_NAME lore/log/bad-name.md",
        "SCAN_INSTRUCTION lore/pages/gotcha/hijack.md",
        "SCAN_SECRET lore/pages/gotcha/leaky.md",
        "SUPERSEDES_MISSING lore/pages/decision/orphaned-successor.md",
      ].sort(),
    );
  });

  it("assigns the configured levels", () => {
    const levels = new Map(findings.map((f) => [f.code, f.level]));
    expect(levels.get("SCAN_INSTRUCTION")).toBe("warn");
    expect(levels.get("SCAN_SECRET")).toBe("error");
    expect(levels.get("DUP_TITLE")).toBe("warn");
    expect(levels.get("BODY_OVER_BUDGET")).toBe("warn");
    expect(levels.get("BODY_OVER_HARD")).toBe("error");
  });

  it("produces deterministic, sorted output", () => {
    const again = lintLore(loadLore(DIRTY));
    expect(formatJson(findings)).toBe(formatJson(again));
    const files = findings.map((f) => f.file);
    expect(files).toEqual([...files].sort());
  });
});
