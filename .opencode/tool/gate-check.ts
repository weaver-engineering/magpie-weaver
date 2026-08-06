import { tool } from "@opencode-ai/plugin";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export default tool({
  description:
    "Runs a named gate-check against the current working tree, or lists every available check with its description and required arguments. Covers the full catalog — test-gate/build-gate/main-gate plus 11 finer-grained checks (branch-ref, pr-title, coverage, existing-tests-pass, and more), not just the three top-level gates. Omit checkName (or pass \"list\") to discover what's available and how to call it before picking one.",
  args: {
    checkName: tool.schema
      .string()
      .optional()
      .describe("The check to run, e.g. \"test-gate\", \"pr-title\", \"coverage\". Omit (or pass \"list\") to list every available check instead of running one."),
    args: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Raw --flag value pairs the check needs, e.g. [\"--ref\", \"AAA-001\", \"--pr-title\", \"AAA-001: fix thing\"]. See the check's own argDescriptions from the list output to know what each check requires."),
  },
  async execute(args, context) {
    const cliArgs =
      args.checkName === undefined || args.checkName === "list"
        ? ["--list", "--json"]
        : [args.checkName, ...(args.args ?? []), "--json"];

    let stdout: string;
    try {
      ({ stdout } = await run("pnpm", ["gate-check", ...cliArgs], { cwd: context.directory }));
    } catch (e) {
      // gate-checks' CLI writes valid JSON on --json regardless of exit
      // code (0/1/2 alike) — a failing or invalid-argument result is
      // still an ordinary result, not a tool error. Only a genuinely
      // empty/missing stdout (bad args to `pnpm` itself, missing pnpm,
      // ...) rethrows.
      const err = e as { stdout?: string; stderr?: string; message?: string };
      if (typeof err.stdout === "string" && err.stdout.length > 0) {
        stdout = err.stdout;
      } else {
        throw new Error(err.stderr || err.message || String(e), { cause: e });
      }
    }
    // pnpm can prepend its own noise ahead of the JSON line (e.g. a
    // one-time lockfile/bin-relink banner right after a workspace
    // change) - search by content instead of assuming a fixed position.
    const jsonLine = stdout.split("\n").find((line) => line.startsWith("{") || line.startsWith("["));
    if (jsonLine === undefined) {
      throw new Error(`No JSON result line found in output:\n${stdout}`);
    }
    const parsed = JSON.parse(jsonLine);

    if (Array.isArray(parsed)) {
      // --list: an array of CheckDescriptor.
      return {
        title: `${parsed.length} checks available`,
        output: JSON.stringify(parsed, null, 2),
        metadata: { checks: parsed },
      };
    }
    // A single GateCheckResult.
    return {
      title: `${parsed.check}: ${parsed.passed ? "passed" : "failed"}`,
      output: JSON.stringify(parsed, null, 2),
      metadata: parsed,
    };
  },
});
