export type Level = "error" | "warn";

export interface Finding {
  level: Level;
  code: string;
  /** File the finding is about, relative to the repo/lore root shown to the user. */
  file: string;
  message: string;
}

export interface Summary {
  errors: number;
  warnings: number;
}

export function summarize(findings: readonly Finding[]): Summary {
  let errors = 0;
  let warnings = 0;
  for (const f of findings) {
    if (f.level === "error") errors++;
    else warnings++;
  }
  return { errors, warnings };
}

/** Locale-independent byte-order comparison — findings order is part of the determinism contract. */
export function byteCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Deterministic ordering: by file, then level (errors first), then code, then message. */
export function sortFindings(findings: Finding[]): Finding[] {
  return findings.sort(
    (a, b) =>
      byteCompare(a.file, b.file) ||
      (a.level === b.level ? 0 : a.level === "error" ? -1 : 1) ||
      byteCompare(a.code, b.code) ||
      byteCompare(a.message, b.message),
  );
}

export function formatHuman(findings: readonly Finding[]): string {
  if (findings.length === 0) return "No findings.";
  const out: string[] = [];
  let currentFile = "";
  for (const f of findings) {
    if (f.file !== currentFile) {
      if (currentFile !== "") out.push("");
      out.push(f.file);
      currentFile = f.file;
    }
    out.push(`  ${f.level === "error" ? "error" : "warn "}  ${f.code}  ${f.message}`);
  }
  const s = summarize(findings);
  out.push("");
  out.push(
    `${findings.length} finding${findings.length === 1 ? "" : "s"}: ${s.errors} error${
      s.errors === 1 ? "" : "s"
    }, ${s.warnings} warning${s.warnings === 1 ? "" : "s"}`,
  );
  return out.join("\n");
}

export function formatJson(findings: readonly Finding[]): string {
  return JSON.stringify({ version: 1, findings, summary: summarize(findings) }, null, 2);
}
