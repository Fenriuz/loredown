import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { driftLore } from "../src/drift.js";
import { initLore } from "../src/init.js";
import { loadLore } from "../src/load.js";

function sh(cwd: string, args: string[]): string {
  return execFileSync("git", ["-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
  }).trim();
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "loredown-drift-"));
  sh(dir, ["init", "-b", "main"]);
  sh(dir, ["config", "user.email", "test@example.com"]);
  sh(dir, ["config", "user.name", "Test"]);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src/a.ts"), "export const a = 1;\n");
  sh(dir, ["add", "-A"]);
  sh(dir, ["commit", "-m", "initial"]);
  return dir;
}

function writeAnchoredPage(dir: string, sha: string): void {
  const path = join(dir, "lore/pages/gotcha/anchored.md");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    [
      "---",
      "id: gotcha/anchored",
      "title: A fact anchored to src/a.ts",
      "kind: gotcha",
      "status: active",
      "created: 2026-07-01",
      "updated: 2026-07-01",
      "provenance:",
      "  agent: claude-code",
      "  actor: test",
      "  task: T-1",
      "sources:",
      "  - path: src/a.ts",
      `    sha: ${sha}`,
      "---",
      "",
      "Body.",
      "",
    ].join("\n"),
  );
}

describe("driftLore", () => {
  it("is clean when the anchored file is untouched since the sha", () => {
    const dir = makeRepo();
    initLore(dir, false, "2026-07");
    writeAnchoredPage(dir, sh(dir, ["rev-parse", "--short", "HEAD"]));
    expect(driftLore(loadLore(join(dir, "lore")), dir).findings).toEqual([]);
  });

  it("warns with the commit count when the anchored file changed", () => {
    const dir = makeRepo();
    initLore(dir, false, "2026-07");
    writeAnchoredPage(dir, sh(dir, ["rev-parse", "--short", "HEAD"]));
    writeFileSync(join(dir, "src/a.ts"), "export const a = 2;\n");
    sh(dir, ["commit", "-am", "change a"]);
    const findings = driftLore(loadLore(join(dir, "lore")), dir).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("SRC_STALE");
    expect(findings[0]?.level).toBe("warn");
    expect(findings[0]?.message).toContain("1 commit");
  });

  it("errors when the anchored file was deleted", () => {
    const dir = makeRepo();
    initLore(dir, false, "2026-07");
    writeAnchoredPage(dir, sh(dir, ["rev-parse", "--short", "HEAD"]));
    sh(dir, ["rm", "src/a.ts"]);
    sh(dir, ["commit", "-m", "remove a"]);
    const findings = driftLore(loadLore(join(dir, "lore")), dir).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("SRC_GONE");
    expect(findings[0]?.level).toBe("error");
  });

  it("errors on an unresolvable sha", () => {
    const dir = makeRepo();
    initLore(dir, false, "2026-07");
    writeAnchoredPage(dir, "deadbee");
    const findings = driftLore(loadLore(join(dir, "lore")), dir).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("SRC_SHA");
  });

  it("errors outside a git repository", () => {
    const dir = mkdtempSync(join(tmpdir(), "loredown-norepo-"));
    initLore(dir, false, "2026-07");
    const findings = driftLore(loadLore(join(dir, "lore")), dir).findings;
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("GIT_REPO");
  });

  it("ignores superseded pages and url sources", () => {
    const dir = makeRepo();
    initLore(dir, false, "2026-07");
    writeAnchoredPage(dir, sh(dir, ["rev-parse", "--short", "HEAD"]));
    writeFileSync(join(dir, "src/a.ts"), "export const a = 3;\n");
    sh(dir, ["commit", "-am", "change a"]);
    // Flip the page to superseded: its stale anchor must no longer be reported.
    const page = join(dir, "lore/pages/gotcha/anchored.md");
    const text = readFileSync(page, "utf8");
    writeFileSync(page, text.replace("status: active", "status: superseded"));
    expect(driftLore(loadLore(join(dir, "lore")), dir).findings).toEqual([]);
  });
});

const SCHEMA2_CONFIG =
  "schema_version: 2\nbudgets:\n  page_body_lines: 40\n  pages_per_task: 3\nscan:\n  instructions: warn\n  secrets: error\nkinds: []\n";

const DOC = "# Guide\n\n## Alpha\nalpha body\n\n## Beta\nbeta body\n";

/** A repo with a two-section doc and a schema-2 lore. */
function makeDocRepo(content = DOC): string {
  const dir = makeRepo();
  mkdirSync(join(dir, "docs"), { recursive: true });
  writeFileSync(join(dir, "docs/guide.md"), content);
  sh(dir, ["add", "-A"]);
  sh(dir, ["commit", "-m", "docs"]);
  initLore(dir, false, "2026-08");
  writeFileSync(join(dir, "lore/config.yaml"), SCHEMA2_CONFIG);
  return dir;
}

function writeSectionPage(dir: string, sha: string, section: string, repo?: string): void {
  const file = join(dir, "lore/pages/gotcha/sectioned.md");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    [
      "---",
      "id: gotcha/sectioned",
      "title: A fact anchored to one section",
      "kind: gotcha",
      "status: active",
      "created: 2026-08-01",
      "updated: 2026-08-01",
      "provenance:",
      "  agent: claude-code",
      "  actor: test",
      "  task: T-1",
      "sources:",
      ...(repo === undefined ? [] : [`  - repo: ${repo}`]),
      `  ${repo === undefined ? "-" : " "} path: docs/guide.md`,
      `    sha: ${sha}`,
      `    section: "${section}"`,
      "---",
      "",
      "Body.",
      "",
    ].join("\n"),
  );
}

describe("tree-entry fast path (SPEC §9)", () => {
  it("a change-and-revert cycle is not stale — content-identical beats commit count", () => {
    const dir = makeRepo();
    initLore(dir, false, "2026-08");
    writeAnchoredPage(dir, sh(dir, ["rev-parse", "--short", "HEAD"]));
    writeFileSync(join(dir, "src/a.ts"), "export const a = 2;\n");
    sh(dir, ["commit", "-am", "change"]);
    writeFileSync(join(dir, "src/a.ts"), "export const a = 1;\n");
    sh(dir, ["commit", "-am", "revert"]);
    expect(driftLore(loadLore(join(dir, "lore")), dir).findings).toEqual([]);
  });

  it("a mode flip with identical content IS a change — entries, not blob ids", () => {
    const dir = makeRepo();
    initLore(dir, false, "2026-08");
    writeAnchoredPage(dir, sh(dir, ["rev-parse", "--short", "HEAD"]));
    chmodSync(join(dir, "src/a.ts"), 0o755);
    sh(dir, ["commit", "-am", "make executable"]);
    const findings = driftLore(loadLore(join(dir, "lore")), dir).findings;
    expect(findings.map((f) => f.code)).toEqual(["SRC_STALE"]);
  });
});

describe("section anchors (SPEC §9, schema 2)", () => {
  it("an edit to a different section is silent; to the cited one, SRC_STALE naming it", () => {
    const dir = makeDocRepo();
    writeSectionPage(dir, sh(dir, ["rev-parse", "--short", "HEAD"]), "## Alpha");
    writeFileSync(join(dir, "docs/guide.md"), DOC.replace("beta body", "new beta"));
    sh(dir, ["commit", "-am", "edit beta"]);
    expect(driftLore(loadLore(join(dir, "lore")), dir).findings).toEqual([]);

    writeFileSync(join(dir, "docs/guide.md"), DOC.replace("alpha body", "new alpha"));
    sh(dir, ["commit", "-am", "edit alpha"]);
    const findings = driftLore(loadLore(join(dir, "lore")), dir).findings;
    expect(findings.map((f) => `${f.level} ${f.code}`)).toEqual(["warn SRC_STALE"]);
    expect(findings[0]?.message).toContain('section "## Alpha"');
  });

  it("warns SRC_SECTION when the heading disappears at HEAD", () => {
    const dir = makeDocRepo();
    writeSectionPage(dir, sh(dir, ["rev-parse", "--short", "HEAD"]), "## Alpha");
    writeFileSync(join(dir, "docs/guide.md"), DOC.replace("## Alpha", "## Renamed"));
    sh(dir, ["commit", "-am", "rename heading"]);
    const findings = driftLore(loadLore(join(dir, "lore")), dir).findings;
    expect(findings.map((f) => `${f.level} ${f.code}`)).toEqual(["warn SRC_SECTION"]);
    expect(findings[0]?.message).toContain("renamed or removed");
  });

  it("errors SRC_SECTION on a heading never present at the anchored sha — even with the file unchanged", () => {
    const dir = makeDocRepo();
    writeSectionPage(dir, sh(dir, ["rev-parse", "--short", "HEAD"]), "## Gamma");
    const findings = driftLore(loadLore(join(dir, "lore")), dir).findings;
    expect(findings.map((f) => `${f.level} ${f.code}`)).toEqual(["error SRC_SECTION"]);
    expect(findings[0]?.message).toContain("never present");
  });

  it("flags a duplicated heading as ambiguous", () => {
    const dir = makeDocRepo(`${DOC}\n## Alpha\nsecond alpha\n`);
    writeSectionPage(dir, sh(dir, ["rev-parse", "--short", "HEAD"]), "## Alpha");
    const findings = driftLore(loadLore(join(dir, "lore")), dir).findings;
    expect(findings.map((f) => `${f.level} ${f.code}`)).toEqual(["warn SRC_SECTION"]);
    expect(findings[0]?.message).toContain("2 times");
  });

  it("matches CRLF headings; an untouched CRLF file stays clean", () => {
    const dir = makeDocRepo("## Alpha\r\nalpha\r\n## Beta\r\nbeta\r\n");
    writeSectionPage(dir, sh(dir, ["rev-parse", "--short", "HEAD"]), "## Alpha");
    expect(driftLore(loadLore(join(dir, "lore")), dir).findings).toEqual([]);
  });

  it("verifies section anchors inside sibling checkouts", () => {
    const dir = makeDocRepo();
    const sib = join(dir, "sib");
    mkdirSync(join(sib, "docs"), { recursive: true });
    sh(sib, ["init", "-b", "main"]);
    sh(sib, ["config", "user.email", "test@example.com"]);
    sh(sib, ["config", "user.name", "Test"]);
    writeFileSync(join(sib, "docs/guide.md"), DOC);
    sh(sib, ["add", "-A"]);
    sh(sib, ["commit", "-m", "sib docs"]);
    writeFileSync(join(dir, "lore/config.yaml"), `${SCHEMA2_CONFIG}repos:\n  sib: ./sib\n`);
    writeSectionPage(dir, sh(sib, ["rev-parse", "--short", "HEAD"]), "## Alpha", "sib");
    expect(driftLore(loadLore(join(dir, "lore")), dir).findings).toEqual([]);

    writeFileSync(join(sib, "docs/guide.md"), DOC.replace("alpha body", "changed"));
    sh(sib, ["commit", "-am", "edit alpha in sib"]);
    const findings = driftLore(loadLore(join(dir, "lore")), dir).findings;
    expect(findings.map((f) => f.code)).toEqual(["SRC_STALE"]);
    expect(findings[0]?.message).toContain("sib:docs/guide.md");
  });
});
