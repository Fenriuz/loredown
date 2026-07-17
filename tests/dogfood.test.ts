import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { run } from "../src/main.js";

/**
 * loredown validates itself: this repo's own lore/ must always pass lint,
 * and its committed index must byte-match a fresh regeneration.
 */
const OWN_LORE = fileURLToPath(new URL("../lore", import.meta.url));

describe("dogfood: this repo's own lore/", () => {
  it("passes lint with zero errors", () => {
    const result = run(["lint", "--lore", OWN_LORE]);
    expect(result.stderr).toBe("");
    expect(result.code, result.stdout).toBe(0);
  });

  it("has an up-to-date committed index", () => {
    const result = run(["index", "--check", "--lore", OWN_LORE]);
    expect(result.code, result.stdout).toBe(0);
  });
});
