import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { initLore } from "../src/init.js";
import { lintLore } from "../src/lint.js";
import { loadLore } from "../src/load.js";
import { run } from "../src/main.js";

function sh(cwd: string, args: string[]): string {
  return execFileSync("git", ["-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
  }).trim();
}

function makeWikiRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "loredown-import-"));
  sh(dir, ["init", "-b", "main"]);
  sh(dir, ["config", "user.email", "test@example.com"]);
  sh(dir, ["config", "user.name", "Test"]);
  mkdirSync(join(dir, "docs"), { recursive: true });
  const longBody = Array.from({ length: 85 }, (_, i) => `line ${i + 1} of the old wiki page`);
  writeFileSync(
    join(dir, "docs/API Reference.md"),
    `# Payment API Reference\n\n## Endpoints\n${longBody.join("\n")}\n\n## Auth\nmore text\n`,
  );
  writeFileSync(join(dir, "docs/notes.md"), "Short page without a heading.\n");
  initLore(dir, false, "2026-08");
  sh(dir, ["add", "-A"]);
  sh(dir, ["commit", "-m", "wiki + lore"]);
  return dir;
}

/** A git repo with lore initialized, arbitrary files, optional config extras and setup hook. */
function makeRepo(
  files: Record<string, string>,
  configExtra = "",
  setup?: (root: string) => void,
): string {
  const dir = mkdtempSync(join(tmpdir(), "loredown-import-"));
  sh(dir, ["init", "-b", "main"]);
  sh(dir, ["config", "user.email", "test@example.com"]);
  sh(dir, ["config", "user.name", "Test"]);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  initLore(dir, false, "2026-08");
  if (configExtra !== "") {
    writeFileSync(
      join(dir, "lore/config.yaml"),
      `schema_version: 1\nbudgets:\n  page_body_lines: 40\n  pages_per_task: 3\nscan:\n  instructions: warn\n  secrets: error\nkinds: []\n${configExtra}`,
    );
  }
  setup?.(dir);
  sh(dir, ["add", "-A"]);
  sh(dir, ["commit", "-m", "seed"]);
  return dir;
}

describe("loredown import", () => {
  it("scaffolds valid pages anchored to the original files, marked imported", () => {
    const dir = makeWikiRepo();
    const result = run(["import", "docs", "--kind", "map"], dir);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("2 pages imported");

    const load = loadLore(join(dir, "lore"));
    expect(load.findings).toEqual([]); // structurally valid by construction — no TODOs
    const api = load.pages.find((p) => p.id === "map/api-reference");
    expect(api).toBeDefined();
    expect(api?.title).toBe("Payment API Reference");
    expect(api?.imported).toBe(true);
    const source = api?.sources[0];
    expect(source !== undefined && "path" in source && source.path).toBe("docs/API Reference.md");
    expect(load.pages.some((p) => p.id === "map/notes")).toBe(true);
  });

  it("downgrades the hard budget error on imported pages and flags pending curation", () => {
    const dir = makeWikiRepo();
    run(["import", "docs", "--kind", "map"], dir);
    run(["index", "--lore", join(dir, "lore")], dir);
    const findings = lintLore(loadLore(join(dir, "lore")));
    expect(findings.filter((f) => f.level === "error")).toEqual([]);
    const hard = findings.find((f) => f.code === "BODY_OVER_HARD");
    expect(hard?.level).toBe("warn");
    expect(hard?.message).toContain("split seams: Endpoints · Auth");
    expect(findings.filter((f) => f.code === "IMPORTED")).toHaveLength(2);
  });

  it("keeps the hard budget as an error on non-imported pages", () => {
    const dir = makeWikiRepo();
    const body = Array.from({ length: 85 }, (_, i) => `line ${i + 1}`).join("\n");
    mkdirSync(join(dir, "lore/pages/map"), { recursive: true });
    writeFileSync(
      join(dir, "lore/pages/map/manual.md"),
      `---\nid: map/manual\ntitle: Manually written oversized page\nkind: map\nstatus: active\ncreated: 2026-08-01\nupdated: 2026-08-01\nprovenance:\n  agent: human\n  actor: test\n  task: T-1\nsources:\n  - url: https://example.com\n    accessed: 2026-08-01\n---\n\n${body}\n`,
    );
    run(["index", "--lore", join(dir, "lore")], dir);
    const findings = lintLore(loadLore(join(dir, "lore")));
    expect(findings.find((f) => f.code === "BODY_OVER_HARD")?.level).toBe("error");
  });

  it("skips slug collisions instead of overwriting", () => {
    const dir = makeWikiRepo();
    run(["import", "docs", "--kind", "map"], dir);
    const again = run(["import", "docs", "--kind", "map"], dir);
    expect(again.code).toBe(0);
    expect(again.stdout).toContain("0 pages imported");
    expect(again.stdout).toContain("already exists");
  });

  it("requires --kind and writes nothing on --dry-run", () => {
    const dir = makeWikiRepo();
    expect(run(["import", "docs"], dir).code).toBe(2);
    const dry = run(["import", "docs", "--kind", "map", "--dry-run"], dir);
    expect(dry.code).toBe(0);
    expect(existsSync(join(dir, "lore/pages/map/notes.md"))).toBe(false);
  });

  it("rewrites bare wiki-links to the id namespace, preserving rendered text", () => {
    const dir = makeRepo({
      "docs/alpha.md":
        "# Alpha\n\nSee [[beta]] and [[beta|the beta system]] and [[Beta Service]] and [[decision/beta]] and [[never-here]].\n",
      "docs/beta.md": "# Beta\n\nBack to [[alpha]].\n",
      "docs/Beta Service.md": "# Beta Service\n\nA service.\n",
    });
    const result = run(["import", "docs", "--kind", "decision"], dir);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("4 wiki-links rewritten, 1 left for review");
    const alpha = readFileSync(join(dir, "lore/pages/decision/alpha.md"), "utf8");
    expect(alpha).toContain("[[decision/beta|beta]]");
    expect(alpha).toContain("[[decision/beta|the beta system]]");
    expect(alpha).toContain("[[decision/beta-service|Beta Service]]");
    expect(alpha).toContain("and [[decision/beta]] and"); // already namespaced — untouched
    expect(alpha).toContain("[[never-here]]"); // unresolvable — left for lint
    run(["index", "--lore", join(dir, "lore")], dir);
    const broken = lintLore(loadLore(join(dir, "lore"))).filter((f) => f.code === "LINK_BROKEN");
    expect(broken).toHaveLength(1);
    expect(broken[0]?.message).toContain("[[never-here]]");
  });

  it("leaves ambiguous bare targets alone — several kinds share the slug", () => {
    const dir = makeRepo({
      "docs/alpha.md": "# Alpha\n\nSee [[beta]].\n",
      "docs/beta.md": "# Beta\n\nBack to [[alpha]].\n",
    });
    mkdirSync(join(dir, "lore/pages/glossary"), { recursive: true });
    writeFileSync(
      join(dir, "lore/pages/glossary/beta.md"),
      `---\nid: glossary/beta\ntitle: Beta the term\nkind: glossary\nstatus: active\ncreated: 2026-08-01\nupdated: 2026-08-01\nprovenance:\n  agent: human\n  actor: test\n  task: T-1\nsources:\n  - url: https://example.com\n    accessed: 2026-08-01\n---\n\nBody.\n`,
    );
    const result = run(["import", "docs", "--kind", "decision"], dir);
    expect(result.stdout).toContain("1 wiki-link rewritten, 1 left for review");
    const alpha = readFileSync(join(dir, "lore/pages/decision/alpha.md"), "utf8");
    expect(alpha).toContain("See [[beta]]."); // guessing would be worse than reporting
  });

  it("converges across multi-kind batches: later runs resolve earlier forward links", () => {
    const dir = makeRepo({
      "docs/g/cap.md": "# Cap\n\nUses [[term]].\n",
      "docs/t/term.md": "# Term\n\nDefined for [[cap]].\n",
    });
    const first = run(["import", "docs/g", "--kind", "gotcha"], dir);
    expect(first.stdout).toContain("0 wiki-links rewritten, 1 left for review");

    const dry = run(["import", "docs/t", "--kind", "glossary", "--dry-run"], dir);
    expect(dry.stdout).toContain("would rewrite links in 1 previously imported page");
    expect(dry.stdout).toContain("2 wiki-links rewritten, 0 left for review");
    expect(readFileSync(join(dir, "lore/pages/gotcha/cap.md"), "utf8")).toContain("[[term]]");

    const second = run(["import", "docs/t", "--kind", "glossary"], dir);
    expect(second.stdout).toContain("rewrote links in 1 previously imported page");
    expect(second.stdout).toContain("2 wiki-links rewritten, 0 left for review");
    expect(readFileSync(join(dir, "lore/pages/gotcha/cap.md"), "utf8")).toContain(
      "[[glossary/term|term]]",
    );
    expect(readFileSync(join(dir, "lore/pages/glossary/term.md"), "utf8")).toContain(
      "[[gotcha/cap|cap]]",
    );
  });

  it("strips pre-existing frontmatter, adopting title and valid dates, preserving the rest", () => {
    const dir = makeRepo({
      "README.md": "readme\n",
      "docs/gamma.md":
        "---\ntitle: Gamma service quirk\ncategory: operations\ncreated: 2026-04-20\nupdated: not-a-date\nsources: [services/gamma/handler.ts, README.md]\n---\n\n# Gamma service quirk\n\nGamma retries silently.\n",
    });
    const result = run(["import", "docs", "--kind", "gotcha"], dir);
    expect(result.code, result.stderr).toBe(0);
    const load = loadLore(join(dir, "lore"));
    expect(load.findings).toEqual([]);
    const gamma = load.pages.find((p) => p.id === "gotcha/gamma");
    expect(gamma?.title).toBe("Gamma service quirk");
    expect(gamma?.created).toBe("2026-04-20"); // the original KB's date, not git's
    expect(gamma?.body.trim()).toBe("Gamma retries silently."); // no leftover block, H1 stripped
    const anchor = gamma?.sources[0];
    expect(anchor !== undefined && "path" in anchor && anchor.note).toContain(
      "unresolved sources: services/gamma/handler.ts",
    );
    expect(anchor !== undefined && "path" in anchor && anchor.note).toContain(
      "unmapped: category=operations, updated=not-a-date",
    );
    const readme = gamma?.sources[1];
    expect(readme !== undefined && "path" in readme && readme.path).toBe("README.md");
  });

  it("keeps a divergent H1 in the body when frontmatter supplies the title", () => {
    const dir = makeRepo({
      "docs/delta.md": "---\ntitle: Custom Title\n---\n\n# Different Heading\n\nBody text.\n",
    });
    run(["import", "docs", "--kind", "map"], dir);
    const delta = loadLore(join(dir, "lore")).pages.find((p) => p.id === "map/delta");
    expect(delta?.title).toBe("Custom Title");
    expect(delta?.body).toContain("# Different Heading"); // divergent heading is content
  });

  it("reports unparseable original frontmatter and leaves it in the body untouched", () => {
    const dir = makeRepo({
      "docs/eps.md": "---\n:: not yaml at all ::\n---\n\n# Eps\n\nBody.\n",
    });
    const result = run(["import", "docs", "--kind", "map"], dir);
    expect(result.stdout).toContain(
      "note docs/eps.md: original frontmatter is not the strict subset",
    );
    const eps = loadLore(join(dir, "lore")).pages.find((p) => p.id === "map/eps");
    expect(eps?.title).toBe("Eps");
    expect(eps?.body).toContain(":: not yaml at all ::"); // visible, never guessed at
  });

  it("harvests sources: entries into repo:/path anchors that verify — never born SRC_GONE", () => {
    const dir = makeRepo(
      {
        "README.md": "readme\n",
        ".gitignore": "svc/\n",
        "docs/page.md":
          "---\nsources: [svc/src/main.ts, svc/functions/Config/, README.md, svc/missing.ts, ghost/x.ts, gone/lib.ts]\n---\n\n# Page\n\nBody.\n",
      },
      "repos:\n  svc: ./svc\n  gone: ./gone\n",
      (root) => {
        const svc = join(root, "svc");
        mkdirSync(join(svc, "src"), { recursive: true });
        mkdirSync(join(svc, "functions/Config"), { recursive: true });
        sh(svc, ["init", "-b", "main"]);
        sh(svc, ["config", "user.email", "test@example.com"]);
        sh(svc, ["config", "user.name", "Test"]);
        writeFileSync(join(svc, "src/main.ts"), "export {};\n");
        writeFileSync(join(svc, "functions/Config/index.ts"), "export {};\n");
        sh(svc, ["add", "-A"]);
        sh(svc, ["commit", "-m", "svc"]);
      },
    );
    const svcSha = sh(join(dir, "svc"), ["rev-parse", "--short", "HEAD"]);
    const result = run(["import", "docs", "--kind", "map"], dir);
    expect(result.code, result.stderr).toBe(0);
    const load = loadLore(join(dir, "lore"));
    expect(load.findings).toEqual([]);
    const page = load.pages.find((p) => p.id === "map/page");
    const anchors = (page?.sources ?? []).filter((s) => "path" in s);
    expect(anchors.map((a) => ("repo" in a ? `${a.repo}:${a.path}` : a.path))).toEqual([
      "docs/page.md", // the import anchor — always the provenance trail
      "svc:src/main.ts",
      "svc:functions/Config", // directory anchor, trailing slash normalized
      "README.md",
    ]);
    expect(anchors[1]?.sha).toBe(svcSha);
    expect(anchors[0]?.note).toContain(
      "unresolved sources: svc/missing.ts, ghost/x.ts, gone/lib.ts",
    );
  });

  it("resolves relative-path targets through the linking file's directory", () => {
    const dir = makeRepo({
      "docs/domain/beta.md": "# Beta\n\nBody.\n",
      "docs/ops/alpha.md": "# Alpha\n\nSee [[../domain/beta]] and [[beta]].\n",
    });
    const result = run(["import", "docs", "--kind", "decision"], dir);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("2 wiki-links rewritten, 0 left for review");
    const alpha = readFileSync(join(dir, "lore/pages/decision/alpha.md"), "utf8");
    expect(alpha).toContain("See [[decision/beta|../domain/beta]] and [[decision/beta|beta]].");
    run(["index", "--lore", join(dir, "lore")], dir);
    expect(lintLore(loadLore(join(dir, "lore"))).filter((f) => f.code === "LINK_BROKEN")).toEqual(
      [],
    );
  });

  it("passes heading anchors through: same-page ignored, cross-page rewritten intact", () => {
    const dir = makeRepo({
      "docs/pipeline.md":
        "# Pipeline\n\nSee [[#Savers]] below and [[intro#Setup|the setup]].\n\n## Savers\n\nText.\n",
      "docs/intro.md": "# Intro\n\n## Setup\n\nText.\n",
    });
    const result = run(["import", "docs", "--kind", "map"], dir);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("1 wiki-link rewritten, 0 left for review");
    const pipeline = readFileSync(join(dir, "lore/pages/map/pipeline.md"), "utf8");
    expect(pipeline).toContain("See [[#Savers]] below"); // same-page anchor — not a page link
    expect(pipeline).toContain("[[map/intro#Setup|the setup]]"); // heading and display carried
    run(["index", "--lore", join(dir, "lore")], dir);
    expect(lintLore(loadLore(join(dir, "lore"))).filter((f) => f.code === "LINK_BROKEN")).toEqual(
      [],
    );
  });

  it("never re-points a relative link whose file was skipped this run", () => {
    const dir = makeRepo({
      "docs/a/overview.md": "# Overview A\n\nBody.\n",
      "docs/b/overview.md": "# Overview B\n\nBody.\n",
      "docs/c/notes.md": "# Notes\n\nSee [[../b/overview]].\n",
    });
    const result = run(["import", "docs", "--kind", "map"], dir);
    // a/overview wins the slug, b/overview is skipped — resolving the link by
    // basename would point at the WRONG page; it must be left for review instead.
    expect(result.stdout).toContain("already exists");
    expect(result.stdout).toContain("0 wiki-links rewritten, 1 left for review");
    expect(readFileSync(join(dir, "lore/pages/map/notes.md"), "utf8")).toContain(
      "See [[../b/overview]].",
    );
  });

  it("left-for-review equals what lint will report (counter invariant)", () => {
    const dir = makeRepo({
      "docs/one.md": "# One\n\n[[two]] and [[missing]] and [[decision/ghost]] and [[#Anchor]].\n",
      "docs/two.md": "# Two\n\nBody.\n",
    });
    const result = run(["import", "docs", "--kind", "decision"], dir);
    const left = Number(result.stdout.match(/(\d+) left for review/)?.[1]);
    run(["index", "--lore", join(dir, "lore")], dir);
    const broken = lintLore(loadLore(join(dir, "lore"))).filter((f) => f.code === "LINK_BROKEN");
    expect(left).toBe(broken.length); // the summary predicts the lint
    expect(broken.length).toBe(2); // [[missing]] + [[decision/ghost]]; [[#Anchor]] is free
  });

  it("escaped alias separators: table cells parse, resolve, and never lose their escape", () => {
    const dir = makeRepo({
      "docs/target.md": "# Target\n\nBody.\n",
      "docs/intro.md": "# Intro\n\n## Setup\n\nText.\n",
      "docs/table.md":
        "# Table\n\n| Q | Detail |\n|---|---|\n| A1 | Ver [[map/target\\|target]] |\n| A2 | Ver [[target\\|alias]] |\n| A3 | Ver [[target]] |\n| A4 | Ver [[intro#Setup\\|the setup]] |\n\nOutside: [[target|plain]] here.\n",
    });
    const result = run(["import", "docs", "--kind", "map"], dir);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("4 wiki-links rewritten, 0 left for review");
    const table = readFileSync(join(dir, "lore/pages/map/table.md"), "utf8");
    expect(table).toContain("| A1 | Ver [[map/target\\|target]] |"); // id-form — untouched, still escaped
    expect(table).toContain("| A2 | Ver [[map/target\\|alias]] |"); // rewritten, escape preserved
    expect(table).toContain("| A3 | Ver [[map/target\\|target]] |"); // synthesized alias — escaped, cell intact
    expect(table).toContain("| A4 | Ver [[map/intro#Setup\\|the setup]] |"); // composes with heading
    expect(table).toContain("Outside: [[map/target|plain]] here."); // plain form outside tables
    run(["index", "--lore", join(dir, "lore")], dir);
    expect(lintLore(loadLore(join(dir, "lore"))).filter((f) => f.code === "LINK_BROKEN")).toEqual(
      [],
    );
  });

  it("lint validates only the target of aliased wiki-links", () => {
    const dir = makeWikiRepo();
    mkdirSync(join(dir, "lore/pages/decision"), { recursive: true });
    const page = (slug: string, body: string) =>
      writeFileSync(
        join(dir, `lore/pages/decision/${slug}.md`),
        `---\nid: decision/${slug}\ntitle: Page ${slug}\nkind: decision\nstatus: active\ncreated: 2026-08-01\nupdated: 2026-08-01\nprovenance:\n  agent: human\n  actor: test\n  task: T-1\nsources:\n  - url: https://example.com\n    accessed: 2026-08-01\n---\n\n${body}\n`,
      );
    page("target", "The target.");
    page("linker", "See [[decision/target|the target page]] and [[decision/ghost|nope]].");
    run(["index", "--lore", join(dir, "lore")], dir);
    const broken = lintLore(loadLore(join(dir, "lore"))).filter((f) => f.code === "LINK_BROKEN");
    expect(broken).toHaveLength(1);
    expect(broken[0]?.message).toContain("[[decision/ghost|nope]]");
  });

  it("lint errors SRC_REPO when a source names an undeclared repo", () => {
    const dir = makeWikiRepo();
    mkdirSync(join(dir, "lore/pages/constraint"), { recursive: true });
    writeFileSync(
      join(dir, "lore/pages/constraint/x.md"),
      `---\nid: constraint/x\ntitle: Cross-repo fact\nkind: constraint\nstatus: active\ncreated: 2026-08-01\nupdated: 2026-08-01\nprovenance:\n  agent: human\n  actor: test\n  task: T-1\nsources:\n  - repo: ghost\n    path: lib.ts\n    sha: abc1234\n---\n\nBody.\n`,
    );
    run(["index", "--lore", join(dir, "lore")], dir);
    const findings = lintLore(loadLore(join(dir, "lore")));
    expect(findings.some((f) => f.code === "SRC_REPO" && f.level === "error")).toBe(true);
  });
});
