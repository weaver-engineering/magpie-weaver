import { tool } from "@opencode-ai/plugin";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export default tool({
  description:
    "Runs a pnpm task-phases command (init, status, list, promote, wip, or a bare task ref like AAA-001 for the ref-switch command) and returns its structured JSON result.",
  args: {
    command: tool.schema
      .string()
      .describe(
        "The task-phases command: \"init\", \"status\", \"list\", \"promote\", \"wip\", or a bare task ref (e.g. \"AAA-001\") to invoke the ref-switch command.",
      ),
    args: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe(
        "Raw CLI arguments after the command, e.g. [\"--ref\", \"AAA-001\", \"--check\"] for status, [\"AAA-001\", \"--title\", \"New task\"] for init, or [\"WIP fix\", \"message\"] for wip. Omit for commands that take none (e.g. plain \"list\").",
      ),
  },
  async execute(args, context) {
    let stdout: string;
    try {
      ({ stdout } = await run(
        "pnpm",
        ["task", args.command, ...(args.args ?? []), "--json"],
        { cwd: context.directory },
      ));
    } catch (e) {
      // Exit 1 (command ran and either threw or returned success: false)
      // still writes valid JSON to stdout with --json - an ordinary
      // unsuccessful result, not a tool error. Exit 2 (bad args, unknown
      // command) writes plain text instead, since cli.ts's
      // writeUsageError ignores --json - relay that as-is, unparsed.
      // Anything else (missing pnpm, ...) rethrows.
      const err = e as { code?: number; stdout?: string; stderr?: string; message?: string };
      if (err.code === 1 && typeof err.stdout === "string" && err.stdout.length > 0) {
        stdout = err.stdout;
      } else if (err.code === 2 && typeof err.stdout === "string" && err.stdout.length > 0) {
        const errorLine =
          err.stdout.split("\n").find((line) => line.startsWith("Error:")) ??
          err.stdout.trim();
        return {
          title: `${args.command}: usage error`,
          output: errorLine,
        };
      } else {
        throw new Error(err.stderr || err.message || String(e), { cause: e });
      }
    }
    // Every command's --json output is one line: {command, args, result,
    // success}. pnpm can prepend its own noise ahead of it (e.g. a
    // one-time lockfile/bin-relink banner right after a workspace
    // change) - search by content instead of assuming a fixed line
    // position.
    const jsonLine = stdout.split("\n").find((line) => line.startsWith("{\"command\":"));
    if (jsonLine === undefined) {
      throw new Error(`No JSON result line found in output:\n${stdout}`);
    }
    const parsed = JSON.parse(jsonLine) as { success: boolean };
    return {
      title: `${args.command}: ${parsed.success ? "OK" : "FAILED"}`,
      output: JSON.stringify(parsed, null, 2),
      metadata: parsed,
    };
  },
});
