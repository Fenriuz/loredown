import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateIndex } from "../src/index-gen.js";
import { loadLore } from "../src/load.js";
import { DEFAULT_CONFIG } from "../src/model.js";

const CLEAN = fileURLToPath(new URL("fixtures/clean/lore", import.meta.url));

describe("generateIndex", () => {
  it("matches the committed golden index byte for byte", () => {
    const load = loadLore(CLEAN);
    expect(load.findings).toEqual([]);
    const fresh = generateIndex(load.config, load.pages);
    expect(fresh).toBe(readFileSync(`${CLEAN}/index.md`, "utf8"));
  });

  it("is deterministic across runs", () => {
    const a = generateIndex(loadLore(CLEAN).config, loadLore(CLEAN).pages);
    const b = generateIndex(loadLore(CLEAN).config, loadLore(CLEAN).pages);
    expect(a).toBe(b);
  });

  it("uses singular wording for one page and omits empty sections", () => {
    const page = loadLore(CLEAN).pages.find((p) => p.id === "gotcha/pg-pool-timeout");
    expect(page).toBeDefined();
    const index = generateIndex(DEFAULT_CONFIG, page === undefined ? [] : [page]);
    expect(index).toContain("_1 active page ·");
    expect(index).toContain("## Gotchas");
    expect(index).not.toContain("## Decisions");
    expect(index).not.toContain("## Archive");
  });

  it("renders an empty lore as zero pages with no sections", () => {
    const index = generateIndex(DEFAULT_CONFIG, []);
    expect(index).toContain("_0 active pages ·");
    expect(index).not.toContain("##");
  });
});
