import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { initLore } from "../src/init.js";
import { loadLore } from "../src/load.js";
import { tracePage } from "../src/trace.js";

function sh(cwd: string, args: string[]): string {
  return execFileSync("git", ["-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
  }).trim();
}

const DOC = "# Guide\n\n## Alpha\nalpha body\n\n## Beta\nbeta body\n";

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "loredown-trace-"));
  sh(dir, ["init", "-b", "main"]);
  sh(dir, ["config", "user.email", "test@example.com"]);
  sh(dir, ["config", "user.name", "Test"]);
  mkdirSync(join(dir, "docs"), { recursive: true });
  writeFileSync(join(dir, "docs/guide.md"), DOC);
  sh(dir, ["add", "-A"]);
  sh(dir, ["commit", "-m", "initial"]);
  initLore(dir, false, "2026-08");
  writeFileSync(
    join(dir, "lore/config.yaml"),
    "schema_version: 2\nbudgets:\n  page_body_lines: 40\n  pages_per_task: 3\nscan:\n  instructions: warn\n  secrets: error\nkinds: []\n",
  );
  return dir;
}

function writePage(dir: string, sourceLines: string[]): void {
  const file = join(dir, "lore/pages/gotcha/traced.md");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    [
      "---",
      "id: gotcha/traced",
      "title: A traced fact",
      "kind: gotcha",
      "status: active",
      "created: 2026-08-01",
      "updated: 2026-08-01",
      "provenance:",
      "  agent: claude-code",
      "  actor: test",
      "  task: T-1",
      "sources:",
      ...sourceLines,
      "---",
      "",
      "Body.",
      "",
    ].join("\n"),
  );
}

describe("tracePage drift status — same verdicts as drift, by construction", () => {
  it("shows the section in the source line and 'section unchanged' after unrelated edits", () => {
    const dir = makeRepo();
    const sha = sh(dir, ["rev-parse", "--short", "HEAD"]);
    writePage(dir, ["  - path: docs/guide.md", `    sha: ${sha}`, '    section: "## Alpha"']);
    writeFileSync(join(dir, "docs/guide.md"), DOC.replace("beta body", "new beta"));
    sh(dir, ["commit", "-am", "edit beta"]);
    const report = tracePage(loadLore(join(dir, "lore")), "gotcha/traced", dir);
    expect(report).toContain('docs/guide.md § "## Alpha"');
    expect(report).toContain("section unchanged since verification (1 commit touched the file)");
  });

  it("reports content-unchanged through a revert cycle, as drift does", () => {
    const dir = makeRepo();
    const sha = sh(dir, ["rev-parse", "--short", "HEAD"]);
    writePage(dir, ["  - path: docs/guide.md", `    sha: ${sha}`]);
    writeFileSync(join(dir, "docs/guide.md"), "changed\n");
    sh(dir, ["commit", "-am", "change"]);
    writeFileSync(join(dir, "docs/guide.md"), DOC);
    sh(dir, ["commit", "-am", "revert"]);
    const report = tracePage(loadLore(join(dir, "lore")), "gotcha/traced", dir);
    expect(report).toContain("content unchanged since verification (2 commits touched the file)");
  });
});
