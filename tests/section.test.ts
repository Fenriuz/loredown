import { describe, expect, it } from "vitest";
import { extractSection } from "../src/section.js";

const DOC = [
  "# Title",
  "",
  "intro",
  "",
  "## Alpha",
  "a1",
  "",
  "### Alpha child",
  "a2",
  "",
  "## Beta",
  "b1",
].join("\n");

describe("extractSection (SPEC §9)", () => {
  it("runs from the heading through the line before the next ≤-hash-count heading", () => {
    expect(extractSection(DOC, "## Alpha")).toEqual({
      found: "one",
      content: "## Alpha\na1\n\n### Alpha child\na2\n", // a deeper heading does not terminate
    });
  });

  it("a ### section is terminated by a ## heading (hash-count ≤, not same-level)", () => {
    expect(extractSection(DOC, "### Alpha child")).toEqual({
      found: "one",
      content: "### Alpha child\na2\n",
    });
  });

  it("the last section runs to EOF, with or without a final newline", () => {
    expect(extractSection(DOC, "## Beta")).toEqual({ found: "one", content: "## Beta\nb1" });
    expect(extractSection("intro\n## End", "## End")).toEqual({
      found: "one",
      content: "## End",
    });
  });

  it("reports missing and duplicate headings distinctly", () => {
    expect(extractSection(DOC, "## Gamma")).toEqual({ found: "none" });
    expect(extractSection(`${DOC}\n## Alpha\nagain`, "## Alpha")).toEqual({
      found: "many",
      count: 2,
    });
  });

  it("matches headings through CRLF and trailing whitespace; region keeps trailing spaces", () => {
    const crlf = "## Alpha  \r\ncontent\r\n## Beta\r\nx\r\n";
    // The heading matches via normalization; region content strips only \r —
    // the heading line keeps its trailing spaces (content is content).
    expect(extractSection(crlf, "## Alpha")).toEqual({
      found: "one",
      content: "## Alpha  \ncontent",
    });
  });
});
