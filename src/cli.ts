#!/usr/bin/env node
import { colorEnabled } from "./color.js";
import { run } from "./main.js";

// The ONLY place TTY/environment state is read (SPEC §14) — inward it travels as data.
const color = colorEnabled(process.env, process.stdout.isTTY);

const result = run(process.argv.slice(2), process.cwd(), { color });
if (result.stdout) process.stdout.write(`${result.stdout}\n`);
if (result.stderr) process.stderr.write(`${result.stderr}\n`);
process.exit(result.code);
