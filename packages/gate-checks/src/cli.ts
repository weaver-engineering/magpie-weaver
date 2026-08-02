#!/usr/bin/env node

import { runCheck } from "./run-check.js";
import type { GateCheckResult } from "./types.js";

function parseArgs(
  argv: string[],
): {
  checkName: string;
  json: boolean;
  args: Record<string, boolean | number | string | string[]>;
} {
  const args = argv.slice(2);
  let checkName = "";
  const parsed: Record<string, boolean | number | string | string[]> = {};
  let json = false;
  let i = 0;

  if (args.length > 0 && !args[0].startsWith("--")) {
    checkName = args[0];
    i = 1;
  }

  while (i < args.length) {
    const arg = args[i];
    if (arg === "--json") {
      json = true;
      i++;
      continue;
    }
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      i++;
      const values: string[] = [];
      while (i < args.length && !args[i].startsWith("--") && args[i] !== "--json") {
        values.push(args[i]);
        i++;
      }
      if (values.length === 0) {
        parsed[key] = true;
      } else if (values.length === 1) {
        const num = Number(values[0]);
        parsed[key] = Number.isFinite(num) ? num : values[0];
      } else {
        parsed[key] = values;
      }
    } else {
      i++;
    }
  }

  return { checkName, json, args: parsed };
}



function writeJson(result: GateCheckResult): void {
  process.stdout.write(JSON.stringify(result) + "\n");
}

function writeHuman(result: GateCheckResult): void {
  const status = result.passed ? "PASS" : "FAIL";
  process.stdout.write(`[gate-check] ${result.check}: ${status}\n`);
  for (const msg of result.messages) {
    process.stdout.write(`  [info] ${msg}\n`);
  }
  for (const v of result.violations) {
    process.stdout.write(`  [violation] ${v}\n`);
  }
  const valueKeys = Object.keys(result.values);
  if (valueKeys.length > 0) {
    for (const key of valueKeys) {
      const val = result.values[key];
      const display = Array.isArray(val) ? val.join(", ") : String(val);
      process.stdout.write(`  [export] ${key}: ${display}\n`);
    }
  }
  process.stdout.write(`  summary: ${result.summary}\n`);
}

function exitInvalid(checkName: string, message: string, json: boolean): void {
  const result: GateCheckResult = {
    check: checkName || "unknown",
    args: {},
    passed: false,
    messages: [],
    violations: [message],
    summary: "Invalid arguments",
    values: {},
  };
  if (json) {
    writeJson(result);
  } else {
    writeHuman(result);
  }
  process.exitCode = 2;
}

async function main(): Promise<void> {
  const { checkName, json, args } = parseArgs(process.argv);

  if (!checkName) {
    exitInvalid(checkName, "No check name provided", json);
    return;
  }

  let result: GateCheckResult;
  try {
    // Interactive (non-`--json`) mode wants the coverage inspector's raw
    // vitest output to show through, same as before this was extracted
    // into `runCheck` — only `--json` mode wants it suppressed.
    result = await runCheck(checkName, args, { quiet: json });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    exitInvalid(checkName, msg, json);
    return;
  }

  if (json) {
    writeJson(result);
  } else {
    writeHuman(result);
  }

  process.exitCode = result.passed ? 0 : 1;
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exitCode = 2;
});