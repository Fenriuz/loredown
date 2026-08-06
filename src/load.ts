import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { byteCompare, type Finding } from "./findings.js";
import {
  ParseError,
  parseYamlSubset,
  splitFrontmatter,
  type YamlMap,
  type YamlValue,
} from "./fm.js";
import {
  type Config,
  DEFAULT_CONFIG,
  ISO_DATE,
  SECTION_HEADING,
  KNOWN_SCHEMA_VERSION,
  type Page,
  type PathSource,
  SHORT_SHA,
  SLUG,
  type Source,
  STATUSES,
  type Status,
} from "./model.js";

export interface RawFile {
  /** Path relative to the lore dir, e.g. "pages/gotcha/foo.md". */
  file: string;
  /** Display path shown in findings, e.g. "lore/pages/gotcha/foo.md". */
  display: string;
  text: string;
}

export interface LoadResult {
  loreDir: string;
  config: Config;
  /** Structurally valid pages. */
  pages: Page[];
  /** Every page file as raw text (valid or not) — used by content scans. */
  rawPages: RawFile[];
  /** Config + structural findings collected during loading. */
  findings: Finding[];
  /** True when config declares a schema newer than this CLI knows (SPEC §17). */
  schemaTooNew: boolean;
}

/** Locate the lore dir: explicit --lore path, or walk up from cwd looking for lore/config.yaml. */
export function findLoreDir(cwd: string, explicit?: string): string | null {
  if (explicit !== undefined) {
    const dir = resolve(cwd, explicit);
    return existsSync(join(dir, "config.yaml")) ? dir : null;
  }
  let dir = resolve(cwd);
  for (;;) {
    const candidate = join(dir, "lore");
    if (existsSync(join(candidate, "config.yaml"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function display(loreDir: string, rel: string): string {
  return `${basename(loreDir)}/${rel.split("\\").join("/")}`;
}

function isMap(value: YamlValue | undefined): value is YamlMap {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface FieldContext {
  findings: Finding[];
  file: string;
}

function err(ctx: FieldContext, code: string, message: string): void {
  ctx.findings.push({ level: "error", code, file: ctx.file, message });
}

function takeString(
  ctx: FieldContext,
  code: string,
  map: YamlMap,
  key: string,
  where: string,
): string | null {
  const value = map[key];
  if (value === undefined) {
    err(ctx, code, `${where}${key}: required field is missing`);
    return null;
  }
  if (typeof value !== "string" || value === "") {
    err(ctx, code, `${where}${key}: expected a non-empty string`);
    return null;
  }
  return value;
}

function checkUnknownKeys(
  ctx: FieldContext,
  code: string,
  map: YamlMap,
  allowed: readonly string[],
  where: string,
): void {
  for (const key of Object.keys(map)) {
    if (!allowed.includes(key)) err(ctx, code, `${where}${key}: unknown field`);
  }
}

const CONFIG_KEYS = ["schema_version", "budgets", "scan", "kinds", "repos"] as const;

export function loadConfig(loreDir: string): {
  config: Config;
  findings: Finding[];
  schemaTooNew: boolean;
} {
  const findings: Finding[] = [];
  const ctx: FieldContext = { findings, file: display(loreDir, "config.yaml") };
  const config: Config = structuredClone(DEFAULT_CONFIG);
  let schemaTooNew = false;

  let map: YamlMap;
  try {
    map = parseYamlSubset(readFileSync(join(loreDir, "config.yaml"), "utf8"));
  } catch (e) {
    const message = e instanceof ParseError ? e.message : String(e);
    err(ctx, "CONFIG_PARSE", message);
    return { config, findings, schemaTooNew };
  }

  checkUnknownKeys(ctx, "CONFIG_FIELD", map, CONFIG_KEYS, "");

  const version = map.schema_version;
  if (typeof version !== "string" || !/^\d+$/.test(version)) {
    err(ctx, "CONFIG_FIELD", "schema_version: expected an integer");
  } else {
    config.schemaVersion = Number(version);
    if (config.schemaVersion > KNOWN_SCHEMA_VERSION) {
      schemaTooNew = true;
      err(
        ctx,
        "SCHEMA_VERSION",
        `schema_version ${config.schemaVersion} is newer than this CLI understands (${KNOWN_SCHEMA_VERSION}) — refusing to operate; upgrade loredown`,
      );
    }
  }

  const budgets = map.budgets;
  if (budgets !== undefined) {
    if (!isMap(budgets)) {
      err(ctx, "CONFIG_FIELD", "budgets: expected a map");
    } else {
      checkUnknownKeys(
        ctx,
        "CONFIG_FIELD",
        budgets,
        ["page_body_lines", "pages_per_task", "url_accessed_max_age_days"],
        "budgets.",
      );
      for (const [key, target] of [
        ["page_body_lines", "pageBodyLines"],
        ["pages_per_task", "pagesPerTask"],
      ] as const) {
        const value = budgets[key];
        if (value === undefined) continue;
        if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
          err(ctx, "CONFIG_FIELD", `budgets.${key}: expected a positive integer`);
        } else {
          config.budgets[target] = Number(value);
        }
      }
      const urlAge = budgets.url_accessed_max_age_days;
      if (urlAge !== undefined) {
        if (typeof urlAge !== "string" || !/^\d+$/.test(urlAge)) {
          err(ctx, "CONFIG_FIELD", "budgets.url_accessed_max_age_days: expected an integer ≥ 0");
        } else {
          config.budgets.urlAccessedMaxAgeDays = Number(urlAge);
        }
      }
    }
  }

  const scan = map.scan;
  if (scan !== undefined) {
    if (!isMap(scan)) {
      err(ctx, "CONFIG_FIELD", "scan: expected a map");
    } else {
      checkUnknownKeys(ctx, "CONFIG_FIELD", scan, ["instructions", "secrets"], "scan.");
      const instructions = scan.instructions;
      if (instructions !== undefined) {
        if (instructions === "off" || instructions === "warn" || instructions === "error") {
          config.scan.instructions = instructions;
        } else {
          err(ctx, "CONFIG_FIELD", "scan.instructions: expected off | warn | error");
        }
      }
      const secrets = scan.secrets;
      if (secrets !== undefined) {
        if (secrets === "warn" || secrets === "error") {
          config.scan.secrets = secrets;
        } else {
          err(ctx, "CONFIG_FIELD", "scan.secrets: expected warn | error (it cannot be disabled)");
        }
      }
    }
  }

  const repos = map.repos;
  if (repos !== undefined) {
    if (!isMap(repos)) {
      err(ctx, "CONFIG_FIELD", "repos: expected a map of repo name → relative path");
    } else {
      for (const [name, value] of Object.entries(repos)) {
        if (typeof value !== "string" || value === "") {
          err(ctx, "CONFIG_FIELD", `repos.${name}: expected a relative path`);
        } else if (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)) {
          err(
            ctx,
            "CONFIG_FIELD",
            `repos.${name}: absolute paths are machine-specific — use a path relative to the lore's parent directory`,
          );
        } else {
          config.repos[name] = value;
        }
      }
    }
  }

  const kinds = map.kinds;
  if (kinds !== undefined) {
    if (!Array.isArray(kinds) || kinds.some((k) => typeof k !== "string")) {
      err(ctx, "CONFIG_FIELD", "kinds: expected a list of kind names");
    } else {
      for (const kind of kinds as string[]) {
        if (!SLUG.test(kind)) err(ctx, "CONFIG_FIELD", `kinds: "${kind}" is not a valid kind name`);
      }
      config.kinds = kinds as string[];
    }
  }

  return { config, findings, schemaTooNew };
}

const PAGE_KEYS = [
  "id",
  "title",
  "kind",
  "status",
  "created",
  "updated",
  "provenance",
  "sources",
  "supersedes",
  "imported",
] as const;

function validateSources(
  ctx: FieldContext,
  value: YamlValue | undefined,
  schemaVersion: number,
): Source[] | null {
  if (value === undefined) {
    err(ctx, "FM_FIELD", "sources: required field is missing (every page needs ≥ 1 source)");
    return null;
  }
  if (!Array.isArray(value) || value.length === 0) {
    err(ctx, "FM_FIELD", "sources: expected a non-empty list");
    return null;
  }
  const sources: Source[] = [];
  let ok = true;
  value.forEach((item, i) => {
    const where = `sources[${i}].`;
    if (!isMap(item)) {
      err(ctx, "FM_FIELD", `sources[${i}]: expected a map with path+sha or url+accessed`);
      ok = false;
      return;
    }
    if (item.path !== undefined) {
      checkUnknownKeys(ctx, "FM_FIELD", item, ["path", "sha", "note", "repo", "section"], where);
      const path = takeString(ctx, "FM_FIELD", item, "path", where);
      const sha = takeString(ctx, "FM_FIELD", item, "sha", where);
      if (path === null || sha === null) {
        ok = false;
        return;
      }
      if (!SHORT_SHA.test(sha)) {
        err(ctx, "FM_FIELD", `${where}sha: expected 7-40 hex chars, got "${sha}"`);
        ok = false;
        return;
      }
      const note = item.note;
      if (note !== undefined && typeof note !== "string") {
        err(ctx, "FM_FIELD", `${where}note: expected a string`);
        ok = false;
        return;
      }
      const repo = item.repo;
      if (repo !== undefined && (typeof repo !== "string" || repo === "")) {
        err(ctx, "FM_FIELD", `${where}repo: expected a repo name declared in config.repos`);
        ok = false;
        return;
      }
      const section = item.section;
      if (section !== undefined) {
        if (typeof section !== "string" || !SECTION_HEADING.test(section)) {
          err(
            ctx,
            "FM_FIELD",
            `${where}section: expected the quoted heading line the claim cites, e.g. section: "## Billing"`,
          );
          ok = false;
          return;
        }
        if (schemaVersion < 2) {
          err(
            ctx,
            "FM_FIELD",
            `${where}section: requires schema_version: 2 — set it in lore/config.yaml once every consumer (CI, adapters) runs loredown >= 0.6`,
          );
          ok = false;
          return;
        }
      }
      const source: PathSource = { path, sha };
      if (note !== undefined) source.note = note as string;
      if (repo !== undefined) source.repo = repo as string;
      if (section !== undefined) source.section = section as string;
      sources.push(source);
      return;
    }
    if (item.url !== undefined) {
      checkUnknownKeys(ctx, "FM_FIELD", item, ["url", "accessed"], where);
      const url = takeString(ctx, "FM_FIELD", item, "url", where);
      const accessed = takeString(ctx, "FM_FIELD", item, "accessed", where);
      if (url === null || accessed === null) {
        ok = false;
        return;
      }
      if (!ISO_DATE.test(accessed)) {
        err(ctx, "FM_FIELD", `${where}accessed: expected an ISO date (YYYY-MM-DD)`);
        ok = false;
        return;
      }
      sources.push({ url, accessed });
      return;
    }
    err(ctx, "FM_FIELD", `sources[${i}]: must have either path+sha or url+accessed`);
    ok = false;
  });
  return ok ? sources : null;
}

function validatePage(
  relFile: string,
  displayFile: string,
  text: string,
  schemaVersion: number,
): {
  page: Page | null;
  findings: Finding[];
} {
  const findings: Finding[] = [];
  const ctx: FieldContext = { findings, file: displayFile };

  let fm: YamlMap;
  let body: string;
  try {
    const doc = splitFrontmatter(text);
    fm = doc.frontmatter;
    body = doc.body;
  } catch (e) {
    const message = e instanceof ParseError ? e.message : String(e);
    err(ctx, "FM_PARSE", message);
    return { page: null, findings };
  }

  checkUnknownKeys(ctx, "FM_FIELD", fm, PAGE_KEYS, "");

  const id = takeString(ctx, "FM_FIELD", fm, "id", "");
  const title = takeString(ctx, "FM_FIELD", fm, "title", "");
  const kind = takeString(ctx, "FM_FIELD", fm, "kind", "");
  const status = takeString(ctx, "FM_FIELD", fm, "status", "");
  const created = takeString(ctx, "FM_FIELD", fm, "created", "");
  const updated = takeString(ctx, "FM_FIELD", fm, "updated", "");

  let validStatus: Status | null = null;
  if (status !== null) {
    if ((STATUSES as readonly string[]).includes(status)) validStatus = status as Status;
    else err(ctx, "FM_FIELD", `status: expected active | superseded | archived, got "${status}"`);
  }
  for (const [name, value] of [
    ["created", created],
    ["updated", updated],
  ] as const) {
    if (value !== null && !ISO_DATE.test(value)) {
      err(ctx, "FM_FIELD", `${name}: expected an ISO date (YYYY-MM-DD)`);
    }
  }

  let provenance: Page["provenance"] | null = null;
  const provValue = fm.provenance;
  if (provValue === undefined) {
    err(ctx, "FM_FIELD", "provenance: required field is missing");
  } else if (!isMap(provValue)) {
    err(ctx, "FM_FIELD", "provenance: expected a map with agent, actor, task");
  } else {
    checkUnknownKeys(ctx, "FM_FIELD", provValue, ["agent", "actor", "task"], "provenance.");
    const agent = takeString(ctx, "FM_FIELD", provValue, "agent", "provenance.");
    const actor = takeString(ctx, "FM_FIELD", provValue, "actor", "provenance.");
    const task = takeString(ctx, "FM_FIELD", provValue, "task", "provenance.");
    if (agent !== null && actor !== null && task !== null) provenance = { agent, actor, task };
  }

  const sources = validateSources(ctx, fm.sources, schemaVersion);

  let supersedes: string | undefined;
  const supValue = fm.supersedes;
  if (supValue !== undefined) {
    if (typeof supValue !== "string" || supValue === "") {
      err(ctx, "FM_FIELD", "supersedes: expected a page id");
    } else {
      supersedes = supValue;
    }
  }

  let imported = false;
  const impValue = fm.imported;
  if (impValue !== undefined) {
    if (impValue !== "true") {
      err(ctx, "FM_FIELD", "imported: expected true (or omit the field entirely)");
    } else {
      imported = true;
    }
  }

  if (
    id === null ||
    title === null ||
    kind === null ||
    validStatus === null ||
    created === null ||
    updated === null ||
    !ISO_DATE.test(created) ||
    !ISO_DATE.test(updated) ||
    provenance === null ||
    sources === null ||
    findings.some((f) => f.level === "error")
  ) {
    return { page: null, findings };
  }

  const page: Page = {
    id,
    title,
    kind,
    status: validStatus,
    created,
    updated,
    provenance,
    sources,
    body,
    file: relFile,
  };
  if (supersedes !== undefined) page.supersedes = supersedes;
  if (imported) page.imported = true;
  return { page, findings };
}

function walkMarkdown(dir: string, prefix: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const entries = readdirSync(dir).sort(byteCompare);
  for (const entry of entries) {
    const full = join(dir, entry);
    const rel = prefix === "" ? entry : `${prefix}/${entry}`;
    if (statSync(full).isDirectory()) out.push(...walkMarkdown(full, rel));
    else if (entry.endsWith(".md")) out.push(rel);
  }
  return out;
}

export function loadLore(loreDir: string): LoadResult {
  const { config, findings, schemaTooNew } = loadConfig(loreDir);
  const pages: Page[] = [];
  const rawPages: RawFile[] = [];

  const pagesDir = join(loreDir, "pages");
  for (const rel of walkMarkdown(pagesDir, "")) {
    const relFile = `pages/${rel}`;
    const displayFile = display(loreDir, relFile);
    const text = readFileSync(join(pagesDir, rel), "utf8");
    rawPages.push({ file: relFile, display: displayFile, text });
    const result = validatePage(relFile, displayFile, text, config.schemaVersion);
    findings.push(...result.findings);
    if (result.page !== null) pages.push(result.page);
  }

  return { loreDir, config, pages, rawPages, findings, schemaTooNew };
}
