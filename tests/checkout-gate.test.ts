import { execFileSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { git, isCheckout } from "../src/git.js";
import { initLore } from "../src/init.js";
import { loadLore } from "../src/load.js";
import { run } from "../src/main.js";

/**
 * SPEC §16: git runs only where a developer put a repository. Ordinary tracked
 * files can be laid out like a bare repository, and git run inside such a
 * directory obeys the `config` among them — including keys that name programs
 * to execute. These tests plant exactly that and prove no command reaches it.
 */

function sh(cwd: string, args: string[], input?: string): string {
  return execFileSync("git", ["-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
    input,
  }).trim();
}

function makeRepo(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `loredown-${label}-`));
  sh(dir, ["init", "-b", "main"]);
  sh(dir, ["config", "user.email", "test@example.com"]);
  sh(dir, ["config", "user.name", "Test"]);
  return dir;
}

function commitAll(dir: string, message: string): string {
  sh(dir, ["add", "-A"]);
  sh(dir, ["commit", "-m", message]);
  return sh(dir, ["rev-parse", "--short", "HEAD"]);
}

const CONFIG =
  "schema_version: 1\nbudgets:\n  page_body_lines: 40\n  pages_per_task: 3\nscan:\n  instructions: warn\n  secrets: error\nkinds: []\n";

function writePage(root: string, sourceLines: string[]): void {
  const path = join(root, "lore/pages/constraint/cross.md");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    [
      "---",
      "id: constraint/cross",
      "title: A fact anchored across repos",
      "kind: constraint",
      "status: active",
      "created: 2026-11-01",
      "updated: 2026-11-01",
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

const MARKER = "RAN-BY-GIT";

/**
 * Plant ordinary files laid out like a bare repository at `dir`. Its `config`
 * names a program git runs whenever it shows the (signed) tip commit; the
 * program does nothing but create MARKER beside itself.
 */
function plantBareLayout(dir: string): { anchoredSha: string; marker: string } {
  const seed = makeRepo("seed");
  writeFileSync(join(seed, "guide.md"), "# Guide\nv1\n");
  commitAll(seed, "c1");
  const c1 = sh(seed, ["rev-parse", "HEAD"]);
  writeFileSync(join(seed, "guide.md"), "# Guide\nv2\n");
  sh(seed, ["add", "-A"]);
  const tree = sh(seed, ["write-tree"]);
  const who = "Test <test@example.com> 1700000000 +0000";
  const signedCommit = [
    `tree ${tree}`,
    `parent ${c1}`,
    `author ${who}`,
    `committer ${who}`,
    "gpgsig -----BEGIN PGP SIGNATURE-----",
    " ",
    " AAAA",
    " -----END PGP SIGNATURE-----",
    "",
    "c2",
    "",
  ].join("\n");
  const c2 = sh(seed, ["hash-object", "-t", "commit", "-w", "--stdin"], signedCommit);

  mkdirSync(join(dir, "refs/heads"), { recursive: true });
  cpSync(join(seed, ".git/objects"), join(dir, "objects"), { recursive: true });
  writeFileSync(join(dir, "HEAD"), "ref: refs/heads/main\n");
  writeFileSync(join(dir, "refs/heads/main"), `${c2}\n`);
  writeFileSync(
    join(dir, "config"),
    "[core]\n\trepositoryformatversion = 0\n\tbare = true\n[log]\n\tshowSignature = true\n[gpg]\n\tprogram = ./payload.sh\n",
  );
  writeFileSync(join(dir, "payload.sh"), `#!/bin/sh\ntouch ${MARKER}\nexit 1\n`);
  chmodSync(join(dir, "payload.sh"), 0o755);
  return { anchoredSha: c1.slice(0, 7), marker: join(dir, MARKER) };
}

/** A repo whose lore maps `docs` to a planted bare layout made of its own tracked files. */
function makeVictim(): { root: string; planted: string; marker: string } {
  const root = makeRepo("victim");
  writeFileSync(join(root, "README.md"), "readme\n");
  mkdirSync(join(root, "kb"), { recursive: true });
  writeFileSync(
    join(root, "kb/page.md"),
    "---\nsources: [docs/guide.md]\n---\n\n# Page\n\nBody.\n",
  );
  initLore(root, false, "2026-11");
  writeFileSync(join(root, "lore/config.yaml"), `${CONFIG}repos:\n  docs: vendor/docs\n`);
  const planted = join(root, "vendor/docs");
  const { anchoredSha, marker } = plantBareLayout(planted);
  writePage(root, ["  - path: guide.md", `    sha: "${anchoredSha}"`, "    repo: docs"]);
  expect(run(["index"], root).code).toBe(0);
  commitAll(root, "a change that vendors docs and cites them");
  // Every planted file is ordinary tracked content — nothing here is a `.git`.
  expect(sh(root, ["ls-files", "vendor/docs/config", "vendor/docs/HEAD"]).split("\n")).toEqual([
    "vendor/docs/HEAD",
    "vendor/docs/config",
  ]);
  return { root, planted, marker };
}

/**
 * The control: raw git — with bare-repository discovery explicitly allowed, so a
 * developer's own global config cannot mask it — obeys the planted config. If
 * this stops holding, the tests below prove nothing.
 */
function expectFixtureIsLive(planted: string, marker: string): void {
  try {
    execFileSync("git", ["-c", "safe.bareRepository=all", "log", "--format=%h", "-1"], {
      cwd: planted,
      stdio: "ignore",
    });
  } catch {
    // The planted program exits non-zero; only the marker matters.
  }
  expect(existsSync(marker), "fixture no longer makes git run the planted program").toBe(true);
  rmSync(marker);
}

function gitAtLeast(major: number, minor: number): boolean {
  const match = /(\d+)\.(\d+)/.exec(execFileSync("git", ["--version"], { encoding: "utf8" }));
  if (match === null) return false;
  const [maj, min] = [Number(match[1]), Number(match[2])];
  return maj > major || (maj === major && min >= minor);
}

// The planted program is a POSIX shell script.
describe.skipIf(process.platform === "win32")(
  "a repos: directory that only looks like a repository",
  () => {
    it("drift refuses it with SRC_REPO and never runs git inside it", () => {
      const { root, planted, marker } = makeVictim();
      expectFixtureIsLive(planted, marker);

      const result = run(["drift", "--json"], root);
      const report = JSON.parse(result.stdout) as {
        findings: { level: string; code: string; message: string }[];
      };
      expect(report.findings.map((f) => `${f.level} ${f.code}`)).toEqual(["error SRC_REPO"]);
      expect(report.findings[0]?.message).toContain("is not a git checkout");
      expect(result.code).toBe(1);
      expect(existsSync(marker)).toBe(false);
    });

    it("trace reports the source as unverifiable and never runs git inside it", () => {
      const { root, planted, marker } = makeVictim();
      expectFixtureIsLive(planted, marker);

      const result = run(["trace", "constraint/cross"], root);
      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout).toContain("path docs:guide.md");
      expect(result.stdout).toContain("is not a git checkout");
      expect(existsSync(marker)).toBe(false);
    });

    it("import harvests no anchor from it and never runs git inside it", () => {
      const { root, planted, marker } = makeVictim();
      expectFixtureIsLive(planted, marker);

      const result = run(["import", "kb", "--kind", "map"], root);
      expect(result.code, result.stderr).toBe(0);
      const page = loadLore(join(root, "lore")).pages.find((p) => p.id === "map/page");
      const sources = page?.sources ?? [];
      expect(sources.some((s) => "repo" in s && s.repo === "docs")).toBe(false);
      const provenance = sources[0];
      expect(provenance && "note" in provenance ? provenance.note : "").toContain(
        "unresolved sources: docs/guide.md",
      );
      expect(existsSync(marker)).toBe(false);
    });
  },
);

describe("isCheckout — the gate before git runs in a mapped directory", () => {
  it("accepts a clone and a linked worktree, whose .git is a file", () => {
    const repo = makeRepo("clone");
    writeFileSync(join(repo, "a.txt"), "a\n");
    commitAll(repo, "initial");
    expect(isCheckout(repo)).toBe(true);

    const worktree = `${repo}-wt`;
    sh(repo, ["worktree", "add", "-b", "side", worktree]);
    expect(isCheckout(worktree)).toBe(true);
  });

  it("rejects a plain directory inside another repository — git would walk up, the gate does not", () => {
    const repo = makeRepo("outer");
    mkdirSync(join(repo, "nested"), { recursive: true });
    writeFileSync(join(repo, "nested/a.txt"), "a\n");
    commitAll(repo, "initial");
    // Raw git happily resolves a repository from here; that is not enough.
    expect(sh(join(repo, "nested"), ["rev-parse", "--git-dir"])).not.toBe("");
    expect(isCheckout(join(repo, "nested"))).toBe(false);
  });

  it("rejects a bare repository and a missing directory", () => {
    const bare = mkdtempSync(join(tmpdir(), "loredown-bare-"));
    sh(bare, ["init", "--bare", "-b", "main"]);
    expect(isCheckout(bare)).toBe(false);
    expect(isCheckout(join(bare, "does-not-exist"))).toBe(false);
  });

  it.skipIf(!gitAtLeast(2, 38))(
    "every git invocation refuses to adopt a bare repository from the working directory",
    () => {
      const bare = mkdtempSync(join(tmpdir(), "loredown-bare-"));
      sh(bare, ["init", "--bare", "-b", "main"]);
      // Raw git accepts it when discovery is allowed…
      expect(sh(bare, ["-c", "safe.bareRepository=all", "rev-parse", "--git-dir"])).toBe(".");
      // …loredown's wrapper never does.
      expect(git(bare, ["rev-parse", "--git-dir"]).ok).toBe(false);
    },
  );
});

describe("legitimate sibling checkouts still verify", () => {
  it("drift verifies a repo: source inside a linked worktree", () => {
    const module = makeRepo("module");
    writeFileSync(join(module, "lib.ts"), "export const LIMIT = 3;\n");
    const moduleSha = commitAll(module, "module: initial");
    const worktree = `${module}-wt`;
    sh(module, ["worktree", "add", "-b", "side", worktree]);

    const umbrella = makeRepo("umbrella");
    initLore(umbrella, false, "2026-11");
    writeFileSync(
      join(umbrella, "lore/config.yaml"),
      `${CONFIG}repos:\n  mod: ../${basename(worktree)}\n`,
    );
    writePage(umbrella, ["  - path: lib.ts", `    sha: "${moduleSha}"`, "    repo: mod"]);
    expect(run(["index"], umbrella).code).toBe(0);
    commitAll(umbrella, "umbrella: lore");

    const result = run(["drift"], umbrella);
    expect(result.stdout).toContain("No findings.");
    expect(result.code).toBe(0);
  });
});
