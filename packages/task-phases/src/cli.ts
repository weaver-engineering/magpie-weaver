#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { commandRegistry } from "./registry.js";
import { RealGitTool } from "./deps/git.js";
import { RealGitHubTool } from "./deps/gh.js";
import { RealFileSystemTool } from "./deps/fs.js";
import { RealGateChecksTool } from "./deps/gate-check.js";
import type { Command, ExternalTools, TaskPhasingCommandResult } from "./types.js";

const TASK_REF_PATTERN = /^[A-Z]+-[0-9]+$/;

/** The literal first-token names dispatched as ordinary commands — `ref`
 * is a `Command`, but never a literal token; a `TASK_REF_PATTERN` match on
 * the first token routes there instead (§3.13). */
const CLI_COMMAND_NAMES: readonly Exclude<Command, "ref">[] = [
  "init",
  "status",
  "list",
  "promote",
  "wip",
];

function isCliCommand(value: string): value is Exclude<Command, "ref"> {
  return (CLI_COMMAND_NAMES as readonly string[]).includes(value);
}

type FlagValue = boolean | number | string | string[];

/** Collects consecutive non-flag tokens following each `--flag`/`-f` into
 * that flag's value: none -> `true`, one -> the bare string, more -> an
 * array. Command-specific arity (e.g. `--wip`'s "at most two, both
 * strings" rule) is validated by the owning command, not here. */
function parseFlags(tokens: string[]): Record<string, FlagValue> {
  const result: Record<string, FlagValue> = {};
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (!token.startsWith("-")) {
      i++;
      continue;
    }
    const key = token.replace(/^-+/, "");
    i++;
    const values: string[] = [];
    while (i < tokens.length && !tokens[i].startsWith("-")) {
      values.push(tokens[i]);
      i++;
    }
    if (values.length === 0) {
      result[key] = true;
    } else if (values.length === 1) {
      result[key] = values[0];
    } else {
      result[key] = values;
    }
  }
  return result;
}

function writeLine(text: string): void {
  process.stdout.write(text + "\n");
}

function writeUsageError(message: string): void {
  writeLine(`Error: ${message}`);
}

function writeCommandResult(
  command: string,
  args: Record<string, FlagValue>,
  result: TaskPhasingCommandResult,
  json: boolean,
): void {
  if (json) {
    // The structured result mirrors the exit-code contract (§4.1): success
    // is reported at the top level so a caller that only reads JSON agrees
    // with a caller that only reads the exit code.
    writeLine(JSON.stringify({ command, args, result, success: result.success }));
    return;
  }
  for (const message of result.messages) {
    writeLine(message);
  }
  if (result.violation) {
    writeLine(`Violation: ${result.violation}`);
  }
  for (const action of result.suggestedActions ?? []) {
    writeLine(`  - ${action}`);
  }
  writeLine(`${command}: ${result.success ? "OK" : "FAILED"}`);
}

function writeCommandError(
  command: string,
  args: Record<string, FlagValue>,
  message: string,
  json: boolean,
): void {
  const result: TaskPhasingCommandResult = { success: false, messages: [], violation: message };
  if (json) {
    writeLine(JSON.stringify({ command, args, result }));
    return;
  }
  writeLine(`${command}: FAILED - ${message}`);
}

async function dispatch(
  command: Command,
  args: Record<string, FlagValue>,
  tools: ExternalTools,
): Promise<number> {
  const json = args.json === true;
  const handler = commandRegistry[command];
  try {
    const result = await handler(tools, args);
    writeCommandResult(command, args, result, json);
    return result.success ? 0 : 1;
  } catch (error) {
    writeCommandError(command, args, error instanceof Error ? error.message : String(error), json);
    return 1;
  }
}

// --- `--dev-testing` support (task-MAG-46-dev-testing-cli-design.md) ---

/** Maps a `--dev-testing` `<tool>` token to its `ExternalTools` key and the
 * ordered parameter names of each of its methods — the JSON args object's
 * keys are matched against this order to build the positional call. */
const DEV_TESTING_TOOLS: Record<
  string,
  { key: keyof ExternalTools; params: Record<string, string[]> }
> = {
  git: {
    key: "git",
    params: {
      fetch: [],
      currentBranch: [],
      branchExists: ["branch", "opts"],
      headSha: ["branch"],
      mergeBase: ["refA", "refB"],
      hasCommitsBeyond: ["branch", "parentBranch"],
      headCommitTitle: ["branch"],
      isDirty: [],
      isAncestor: ["ancestor", "descendant"],
      createBranch: ["newBranch", "fromRef"],
      checkout: ["branch"],
      commitAll: ["title", "message"],
      push: ["branch", "opts"],
      pullFastForward: ["branch"],
      rebase: ["branch", "ontoRef"],
      deleteBranch: ["branch"],
    },
  },
  gh: {
    key: "github",
    params: {
      createPR: ["base", "head", "opts"],
      findMergedPRs: ["base", "head"],
      findMergedPR: ["base", "head"],
      findOpenPR: ["base", "head"],
    },
  },
  fs: {
    key: "fileSystem",
    params: {
      loadConfig: [],
      exists: ["path"],
      readFile: ["path"],
      writeFile: ["path", "content"],
      copyFile: ["src", "dest"],
      mkdir: ["path"],
      readDir: ["path"],
    },
  },
  "gate-check": {
    key: "gateChecks",
    params: {
      run: ["phase", "args"],
      gateFor: ["phase"],
    },
  },
};

type ArgsSource = { kind: "args-file"; path: string } | { kind: "stdin" } | { kind: "none" };

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

function writeDevTestingResult(
  payload: { tool: string; method: string; args: Record<string, unknown>; success: boolean; value?: unknown; error?: string },
  json: boolean,
): void {
  if (json) {
    writeLine(JSON.stringify(payload));
    return;
  }
  const status = payload.success ? "OK" : "FAILED";
  writeLine(`--dev-testing ${payload.tool} ${payload.method}: ${status}`);
  if (payload.success) {
    writeLine(JSON.stringify(payload.value));
  } else {
    writeLine(`  ${payload.error}`);
  }
}

async function runDevTesting(
  tool: string,
  method: string,
  argsSource: ArgsSource,
  json: boolean,
  tools: ExternalTools,
): Promise<number> {
  const toolEntry = DEV_TESTING_TOOLS[tool];
  if (!toolEntry) {
    writeUsageError(`Unknown --dev-testing tool "${tool}" (expected git | gh | fs | gate-check)`);
    return 2;
  }

  const paramNames = toolEntry.params[method];
  if (!paramNames) {
    writeUsageError(`Unknown method "${method}" for --dev-testing tool "${tool}"`);
    return 2;
  }

  let argsObj: Record<string, unknown> = {};
  if (argsSource.kind === "args-file") {
    let raw: string;
    try {
      raw = await readFile(argsSource.path, "utf8");
    } catch (error) {
      writeUsageError(
        `Could not read --args-file "${argsSource.path}": ${error instanceof Error ? error.message : String(error)}`,
      );
      return 2;
    }
    try {
      argsObj = JSON.parse(raw);
    } catch {
      writeUsageError(`Malformed JSON in --args-file "${argsSource.path}"`);
      return 2;
    }
  } else if (argsSource.kind === "stdin") {
    const raw = await readStdin();
    try {
      argsObj = JSON.parse(raw);
    } catch {
      writeUsageError("Malformed JSON on stdin");
      return 2;
    }
  }

  const target = tools[toolEntry.key] as unknown as Record<string, (...args: unknown[]) => unknown>;
  const fn = target[method];
  if (typeof fn !== "function") {
    writeUsageError(`Method "${method}" not found on --dev-testing tool "${tool}"`);
    return 2;
  }

  const positional = paramNames.map((name) => argsObj[name]);
  try {
    const value = await fn.apply(target, positional);
    writeDevTestingResult({ tool, method, args: argsObj, success: true, value }, json);
    return 0;
  } catch (error) {
    writeDevTestingResult(
      { tool, method, args: argsObj, success: false, error: error instanceof Error ? error.message : String(error) },
      json,
    );
    return 1;
  }
}

async function runDevTestingFromArgv(tokens: string[], tools: ExternalTools): Promise<number> {
  const tool = tokens[0];
  const method = tokens[1];
  if (!tool || !method) {
    writeUsageError("--dev-testing requires <tool> <method>");
    return 2;
  }

  let json = false;
  let argsSource: ArgsSource = { kind: "none" };
  let i = 2;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token === "--json") {
      json = true;
      i++;
      continue;
    }
    if (token === "-i") {
      argsSource = { kind: "stdin" };
      i++;
      continue;
    }
    if (token === "--args-file") {
      const path = tokens[i + 1];
      if (!path) {
        writeUsageError("--args-file requires a path");
        return 2;
      }
      argsSource = { kind: "args-file", path };
      i += 2;
      continue;
    }
    writeUsageError(`Unrecognised --dev-testing argument "${token}"`);
    return 2;
  }

  return runDevTesting(tool, method, argsSource, json, tools);
}

// --- entry points ---

/**
 * All real argv-parsing, dispatch, and exit-code logic — the seam every
 * command-level spec depends on. The `bin` script below calls this with
 * `buildRealTools()`; system tests call it directly with mocked
 * `ExternalTools`, in-process, exercising the same parsing/dispatch path.
 */
export async function run(argv: string[], tools: ExternalTools): Promise<number> {
  const args = argv.slice(2);

  if (args[0] === "--dev-testing") {
    return runDevTestingFromArgv(args.slice(1), tools);
  }

  const [command, ...rest] = args;
  if (command === undefined) {
    writeUsageError("No command given");
    return 2;
  }

  const flags = parseFlags(rest);

  if (isCliCommand(command)) {
    return dispatch(command, flags, tools);
  }
  if (TASK_REF_PATTERN.test(command)) {
    return dispatch("ref", { ...flags, ref: command }, tools);
  }

  writeUsageError(`Unknown command "${command}"`);
  return 2;
}

function buildRealTools(): ExternalTools {
  return {
    git: new RealGitTool(),
    github: new RealGitHubTool(),
    gateChecks: new RealGateChecksTool(),
    fileSystem: new RealFileSystemTool(),
  };
}

/** `import.meta.url` resolves through symlinks (e.g. pnpm's `.bin` shims,
 * or the workspace-linked `node_modules/@magpieweaver/task-phases` ->
 * `packages/task-phases`) but `process.argv[1]` does not — comparing
 * them raw would silently fail to detect "run as the real bin" whenever
 * invoked through either of those, which is the common case. */
function isRunAsScript(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  try {
    return import.meta.url === `file://${realpathSync(entry)}`;
  } catch {
    return false;
  }
}

if (isRunAsScript()) {
  run(process.argv, buildRealTools()).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
