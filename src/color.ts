/**
 * ANSI severity coloring (SPEC §14). The decision to color is made ONCE at the
 * process edge (cli.ts) and travels inward as data — nothing below the entry
 * point may read TTY or environment state, or library/test output would vary
 * with where it runs. Non-TTY streams stay byte-identical by contract.
 */

const RED = "\u001b[31m";
const YELLOW = "\u001b[33m";
const RESET = "\u001b[0m";

/** The gate: TTY, NO_COLOR unset or empty (no-color.org), TERM not "dumb". */
export function colorEnabled(env: NodeJS.ProcessEnv, isTTY: boolean | undefined): boolean {
  if (isTTY !== true) return false;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  if (env.TERM === "dumb") return false;
  return true;
}

export function red(text: string, on: boolean): string {
  return on ? `${RED}${text}${RESET}` : text;
}

export function yellow(text: string, on: boolean): string {
  return on ? `${YELLOW}${text}${RESET}` : text;
}
