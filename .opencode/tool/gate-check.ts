import { tool } from "@opencode-ai/plugin";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export default tool({
  description:
    "Runs a named gate-check (test-gate, build-gate, main-gate) against the current working tree",
  args: {
    checkName: tool.schema.string().describe("e.g. test-gate, build-gate, main-gate"),
    ref: tool.schema.string().describe("Task ref, e.g. AAA-001"),
  },
  async execute(args) {
    let stdout: string;
    try {
      ({ stdout } = await run("pnpm", [
        "gate-check",
        args.checkName,
        "--json",
        "--ref",
        args.ref,
      ]));
    } catch (e) {
      // pnpm gate-check exits 1 (with valid JSON already on stdout) when the
      // check ran and failed — that's an ordinary violating result, not a
      // tool error. Anything else (bad args, missing pnpm, ...) rethrows.
      const err = e as { code?: number; stdout?: string; stderr?: string; message?: string };
      if (err.code === 1 && typeof err.stdout === "string" && err.stdout.length > 0) {
        stdout = err.stdout;
      } else {
        throw new Error(err.stderr || err.message || String(e));
      }
    }
    // The gate-checks CLI writes exactly one JSON line; on a failing check
    // pnpm appends its own "[ELIFECYCLE] Command failed..." banner to
    // stdout afterwards, so only the first line is ever JSON.
    const jsonLine = stdout.split("\n", 1)[0];
    const result = JSON.parse(jsonLine); // GateCheckResult
    return {
      title: `${result.check}: ${result.passed ? "passed" : "failed"}`,
      output: JSON.stringify(result, null, 2),
      metadata: result,
    };
  },
});
