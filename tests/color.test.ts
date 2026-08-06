import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { colorEnabled } from "../src/color.js";
import { type Finding, formatHuman } from "../src/findings.js";

const DIRTY = fileURLToPath(new URL("fixtures/dirty/lore", import.meta.url));
const ROOT = fileURLToPath(new URL("..", import.meta.url));

const FINDINGS: Finding[] = [
  { level: "error", code: "X_ERR", file: "lore/pages/a.md", message: "broken" },
  { level: "warn", code: "X_WARN", file: "lore/pages/a.md", message: "questionable" },
];

describe("colorEnabled (the gate, SPEC §14)", () => {
  it("requires a TTY and honors NO_COLOR and TERM=dumb", () => {
    expect(colorEnabled({}, undefined)).toBe(false);
    expect(colorEnabled({}, false)).toBe(false);
    expect(colorEnabled({}, true)).toBe(true);
    expect(colorEnabled({ NO_COLOR: "1" }, true)).toBe(false);
    expect(colorEnabled({ NO_COLOR: "" }, true)).toBe(true); // no-color.org: empty counts as unset
    expect(colorEnabled({ TERM: "dumb" }, true)).toBe(false);
  });
});

describe("colored human output", () => {
  it("colors severity labels and non-zero counts; stripping escapes yields the plain bytes", () => {
    const plain = formatHuman(FINDINGS);
    const colored = formatHuman(FINDINGS, true);
    expect(colored).toContain("\u001b[31merror\u001b[0m");
    expect(colored).toContain("\u001b[33mwarn\u001b[0m");
    expect(colored.replace(/\u001b\[\d+m/g, "")).toBe(plain);
  });

  it("leaves zero counts uncolored", () => {
    const colored = formatHuman(
      FINDINGS.filter((f) => f.level === "warn"),
      true,
    );
    expect(colored).toContain(": 0 errors,"); // plain — a red zero would be a false signal
    expect(colored).not.toContain("\u001b[31m");
  });

  it("emits no escapes by default — color only ever arrives as data", () => {
    expect(formatHuman(FINDINGS)).not.toContain("\u001b");
  });
});

describe("the process edge", () => {
  it("a piped CLI run (non-TTY) emits zero escape sequences", () => {
    let stdout = "";
    try {
      stdout = execFileSync("node_modules/.bin/tsx", ["src/cli.ts", "lint", "--lore", DIRTY], {
        cwd: ROOT,
        encoding: "utf8",
      });
    } catch (e) {
      stdout = (e as { stdout?: string }).stdout ?? ""; // lint exits 1 on the dirty fixture
    }
    expect(stdout).toContain("error"); // real findings flowed through
    expect(stdout).not.toContain("\u001b");
  });
});
