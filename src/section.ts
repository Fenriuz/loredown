/**
 * Markdown section extraction for section anchors (SPEC §9). Pure text — no
 * git, no I/O — so drift's region comparison is unit-testable exhaustively.
 *
 * Matching is line-based (the split-seam limitation, documented): the heading
 * is a line whose normalized form — one trailing `\r` stripped, then
 * right-trimmed — equals the anchor value. The region runs through the line
 * before the next heading whose `#`-count is ≤ the anchor's, or EOF. Region
 * content keeps trailing whitespace (a markdown hard break is content); only
 * `\r` is stripped per line, so a pure CRLF↔LF change compares as different —
 * the safe direction (SRC_STALE, never a section error).
 */

export type SectionResult =
  | { found: "one"; content: string }
  | { found: "none" }
  | { found: "many"; count: number };

function norm(line: string): string {
  return (line.endsWith("\r") ? line.slice(0, -1) : line).trimEnd();
}

function stripCr(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

function hashCount(line: string): number {
  let n = 0;
  while (n < line.length && line[n] === "#") n++;
  return n;
}

const HEADING = /^#{1,6} /;

export function extractSection(text: string, heading: string): SectionResult {
  const lines = text.split("\n");
  const level = hashCount(heading);
  const matches: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (norm(lines[i] as string) === heading) matches.push(i);
  }
  if (matches.length === 0) return { found: "none" };
  if (matches.length > 1) return { found: "many", count: matches.length };
  const start = matches[0] as number;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const n = norm(lines[i] as string);
    if (HEADING.test(n) && hashCount(n) <= level) {
      end = i;
      break;
    }
  }
  return { found: "one", content: lines.slice(start, end).map(stripCr).join("\n") };
}
