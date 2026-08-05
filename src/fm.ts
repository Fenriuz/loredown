/**
 * Zero-dependency parser for loredown's strict YAML subset (SPEC §3).
 *
 * Supported: `key: value` scalars, nested maps via 2-space indentation,
 * `- ` lists of scalars or flat maps, `[a, b]` flow lists of plain scalars,
 * single/double-quoted strings, full-line and ` #` inline comments.
 * Anything else is a parse error with a line number — loredown frontmatter
 * is a documented format, not arbitrary YAML.
 */

export type YamlValue = string | YamlMap | YamlValue[];
export interface YamlMap {
  [key: string]: YamlValue;
}

export class ParseError extends Error {
  readonly line: number;
  constructor(line: number, message: string) {
    super(`line ${line}: ${message}`);
    this.line = line;
  }
}

interface Line {
  no: number;
  indent: number;
  text: string;
}

function stripComment(raw: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "#" && !inSingle && !inDouble && (i === 0 || raw[i - 1] === " ")) {
      return raw.slice(0, i).trimEnd();
    }
  }
  return raw.trimEnd();
}

function toLines(source: string): Line[] {
  const lines: Line[] = [];
  const rawLines = source.split("\n");
  for (let i = 0; i < rawLines.length; i++) {
    const stripped = stripComment(rawLines[i] as string);
    if (stripped.trim() === "") continue;
    const indent = stripped.length - stripped.trimStart().length;
    if (stripped.slice(0, indent).includes("\t")) {
      throw new ParseError(i + 1, "tabs are not allowed in indentation");
    }
    if (indent % 2 !== 0) {
      throw new ParseError(i + 1, `indentation must be a multiple of 2 (got ${indent})`);
    }
    lines.push({ no: i + 1, indent, text: stripped.trim() });
  }
  return lines;
}

function unquote(no: number, value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if (first === '"' && last === '"') {
      return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    if (first === "'" && last === "'") {
      return value.slice(1, -1).replace(/''/g, "'");
    }
    if (first === '"' || first === "'") {
      throw new ParseError(no, "unterminated quoted string");
    }
  }
  return value;
}

function parseFlowList(no: number, value: string): string[] {
  const inner = value.slice(1, -1).trim();
  if (inner === "") return [];
  return inner.split(",").map((part) => unquote(no, part.trim()));
}

/** Split "key: value" or "key:"; returns null when the line is not a key line. */
function splitKey(line: Line): { key: string; rest: string } | null {
  const text = line.text;
  const colon = text.indexOf(":");
  if (colon <= 0) return null;
  const key = text.slice(0, colon);
  // Hyphens and dots are legal in keys — repo names like `rfid-svc` appear as config.repos keys.
  if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key)) return null;
  const after = text.slice(colon + 1);
  if (after !== "" && !after.startsWith(" ")) return null;
  return { key, rest: after.trim() };
}

function parseScalar(no: number, rest: string): YamlValue {
  if (rest.startsWith("[")) {
    if (!rest.endsWith("]")) throw new ParseError(no, "unterminated flow list");
    return parseFlowList(no, rest);
  }
  return unquote(no, rest);
}

function parseBlock(
  lines: Line[],
  start: number,
  indent: number,
): { value: YamlValue; next: number } {
  const first = lines[start];
  if (first === undefined) throw new ParseError(0, "unexpected end of input");
  if (first.text.startsWith("- ") || first.text === "-") {
    return parseList(lines, start, indent);
  }
  return parseMap(lines, start, indent);
}

function parseMap(lines: Line[], start: number, indent: number): { value: YamlMap; next: number } {
  const map: YamlMap = {};
  let i = start;
  while (i < lines.length) {
    const line = lines[i] as Line;
    if (line.indent < indent) break;
    if (line.indent > indent) {
      throw new ParseError(line.no, `unexpected indentation (expected ${indent})`);
    }
    const kv = splitKey(line);
    if (kv === null) throw new ParseError(line.no, `expected "key: value", got "${line.text}"`);
    if (kv.key in map) throw new ParseError(line.no, `duplicate key "${kv.key}"`);
    if (kv.rest !== "") {
      map[kv.key] = parseScalar(line.no, kv.rest);
      i++;
      continue;
    }
    const child = lines[i + 1];
    if (child === undefined || child.indent <= indent) {
      throw new ParseError(line.no, `key "${kv.key}" has no value`);
    }
    const block = parseBlock(lines, i + 1, child.indent);
    map[kv.key] = block.value;
    i = block.next;
  }
  return { value: map, next: i };
}

function parseList(
  lines: Line[],
  start: number,
  indent: number,
): { value: YamlValue[]; next: number } {
  const list: YamlValue[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i] as Line;
    if (line.indent < indent) break;
    if (line.indent > indent) {
      throw new ParseError(line.no, `unexpected indentation (expected ${indent})`);
    }
    if (!line.text.startsWith("- ")) {
      throw new ParseError(line.no, `expected list item "- ...", got "${line.text}"`);
    }
    const itemText = line.text.slice(2).trim();
    const asKv = splitKey({ ...line, text: itemText });
    if (asKv === null) {
      // Scalar list item.
      list.push(parseScalar(line.no, itemText));
      i++;
      continue;
    }
    // Flat map item: "- key: value" plus continuation lines indented by 2 more.
    const item: YamlMap = {};
    if (asKv.rest === "") throw new ParseError(line.no, `list item key "${asKv.key}" has no value`);
    item[asKv.key] = parseScalar(line.no, asKv.rest);
    i++;
    const contIndent = indent + 2;
    while (i < lines.length) {
      const cont = lines[i] as Line;
      if (cont.indent !== contIndent || cont.text.startsWith("- ")) break;
      const kv = splitKey(cont);
      if (kv === null || kv.rest === "") {
        throw new ParseError(cont.no, 'list item fields must be flat "key: value" pairs');
      }
      if (kv.key in item) throw new ParseError(cont.no, `duplicate key "${kv.key}"`);
      item[kv.key] = parseScalar(cont.no, kv.rest);
      i++;
    }
    list.push(item);
  }
  return { value: list, next: i };
}

/** Parse a full document (config files). */
export function parseYamlSubset(source: string): YamlMap {
  const lines = toLines(source);
  if (lines.length === 0) return {};
  const { value, next } = parseMap(lines, 0, 0);
  const trailing = lines[next];
  if (trailing !== undefined) {
    throw new ParseError(trailing.no, "content after end of top-level map");
  }
  return value;
}

export interface SplitDocument {
  frontmatter: YamlMap;
  /** Body text after the closing fence, original line endings preserved. */
  body: string;
  /** 1-based line where the body starts in the original file. */
  bodyStartLine: number;
}

/** Split a page file into frontmatter and body (SPEC §3). */
export function splitFrontmatter(source: string): SplitDocument {
  const lines = source.split("\n");
  if (lines[0] !== "---") throw new ParseError(1, 'page must start with a "---" frontmatter fence');
  let closing = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      closing = i;
      break;
    }
  }
  if (closing === -1) throw new ParseError(1, 'missing closing "---" frontmatter fence');
  const fmSource = lines.slice(1, closing).join("\n");
  const frontmatter = parseYamlSubset(fmSource);
  const body = lines.slice(closing + 1).join("\n");
  return { frontmatter, body, bodyStartLine: closing + 2 };
}
