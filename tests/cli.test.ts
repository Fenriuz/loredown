import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { run } from "../src/main.js";
import { VERSION } from "../src/version.js";

const DIRTY = fileURLToPath(new URL("fixtures/dirty/lore", import.meta.url));

describe("cli basics", () => {
  it("prints usage with no args and with --help", () => {
    for (const argv of [[], ["--help"], ["-h"], ["lint", "-h"]]) {
      const result = run(argv);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Usage: loredown");
    }
  });

  it("prints the version with --version", () => {
    expect(run(["--version"])).toEqual({ code: 0, stdout: VERSION, stderr: "" });
  });

  it("rejects unknown commands and options with exit code 2", () => {
    expect(run(["frobnicate"]).code).toBe(2);
    expect(run(["lint", "--frobnicate"]).code).toBe(2);
    expect(run(["--lore"]).code).toBe(2); // missing value
  });

  it("fails with guidance when no lore/ exists", () => {
    const result = run(["lint"], tmpdir());
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("loredown init");
  });

  it("exits 1 on lint errors and emits stable JSON", () => {
    const result = run(["lint", "--json", "--lore", DIRTY]);
    expect(result.code).toBe(1);
    const parsed = JSON.parse(result.stdout) as {
      version: number;
      findings: unknown[];
      summary: { errors: number; warnings: number };
    };
    expect(parsed.version).toBe(1);
    expect(parsed.summary.errors).toBeGreaterThan(0);
    expect(parsed.summary.warnings).toBeGreaterThan(0);
  });

  it("reports a stale index via index --check with exit 1", () => {
    const result = run(["index", "--check", "--lore", DIRTY]);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("stale");
  });
});

describe("version consistency", () => {
  it("matches package.json", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      version: string;
    };
    expect(VERSION).toBe(pkg.version);
  });
});
