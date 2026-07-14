import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COMMANDS, run } from "../src/main.js";
import { VERSION } from "../src/version.js";

describe("run", () => {
  it("prints usage with no args and with --help", () => {
    for (const argv of [[], ["--help"], ["-h"]]) {
      const result = run(argv);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Usage: loredown");
      expect(result.stderr).toBe("");
    }
  });

  it("prints the version with --version", () => {
    for (const argv of [["--version"], ["-v"]]) {
      const result = run(argv);
      expect(result.code).toBe(0);
      expect(result.stdout).toBe(VERSION);
    }
  });

  it("stubs every known command with exit code 3", () => {
    for (const command of COMMANDS) {
      const result = run([command]);
      expect(result.code).toBe(3);
      expect(result.stderr).toContain(command);
      expect(result.stderr).toContain("not implemented");
    }
  });

  it("rejects unknown commands with exit code 2", () => {
    const result = run(["frobnicate"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Unknown command: frobnicate");
  });

  it("is deterministic: same argv, same result", () => {
    expect(run(["lint"])).toEqual(run(["lint"]));
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
