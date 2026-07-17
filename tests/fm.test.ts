import { describe, expect, it } from "vitest";
import { ParseError, parseYamlSubset, splitFrontmatter } from "../src/fm.js";

describe("parseYamlSubset", () => {
  it("parses scalars, nested maps, lists of maps, and flow lists", () => {
    const doc = parseYamlSubset(
      [
        "schema_version: 1",
        "budgets:",
        "  page_body_lines: 40",
        "provenance:",
        "  agent: claude-code",
        '  task: "PR #12"',
        "sources:",
        "  - path: src/db/client.ts",
        "    sha: abc1234",
        "  - url: https://example.com/x",
        "    accessed: 2026-07-01",
        "kinds: []",
        "extra: [a, b]",
      ].join("\n"),
    );
    expect(doc).toEqual({
      schema_version: "1",
      budgets: { page_body_lines: "40" },
      provenance: { agent: "claude-code", task: "PR #12" },
      sources: [
        { path: "src/db/client.ts", sha: "abc1234" },
        { url: "https://example.com/x", accessed: "2026-07-01" },
      ],
      kinds: [],
      extra: ["a", "b"],
    });
  });

  it("keeps # inside quotes but strips inline comments outside them", () => {
    const doc = parseYamlSubset(['task: "PR #12"', "level: warn  # off | warn | error"].join("\n"));
    expect(doc).toEqual({ task: "PR #12", level: "warn" });
  });

  it("preserves colons in unquoted URL values", () => {
    expect(parseYamlSubset("url: https://example.com/a?b=c")).toEqual({
      url: "https://example.com/a?b=c",
    });
  });

  it("handles quoted strings with escapes", () => {
    expect(parseYamlSubset("a: \"he said \\\"hi\\\"\"\nb: 'it''s'")).toEqual({
      a: 'he said "hi"',
      b: "it's",
    });
  });

  it("rejects tabs, odd indentation, duplicate keys, and dangling keys", () => {
    expect(() => parseYamlSubset("a:\n\tb: 1")).toThrow(ParseError);
    expect(() => parseYamlSubset("a:\n   b: 1")).toThrow(/multiple of 2/);
    expect(() => parseYamlSubset("a: 1\na: 2")).toThrow(/duplicate key/);
    expect(() => parseYamlSubset("a:")).toThrow(/has no value/);
    expect(() => parseYamlSubset('a: "unterminated')).toThrow(/unterminated/);
  });

  it("is deterministic", () => {
    const source = "a: 1\nb:\n  c: 2";
    expect(JSON.stringify(parseYamlSubset(source))).toBe(JSON.stringify(parseYamlSubset(source)));
  });
});

describe("splitFrontmatter", () => {
  it("separates frontmatter from body", () => {
    const doc = splitFrontmatter("---\nid: gotcha/x\n---\n\nBody line.\n");
    expect(doc.frontmatter).toEqual({ id: "gotcha/x" });
    expect(doc.body).toBe("\nBody line.\n");
    expect(doc.bodyStartLine).toBe(4);
  });

  it("rejects files without a frontmatter fence", () => {
    expect(() => splitFrontmatter("no fence")).toThrow(/must start/);
    expect(() => splitFrontmatter("---\nid: x")).toThrow(/missing closing/);
  });
});
