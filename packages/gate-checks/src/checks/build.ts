import { type GateCheckResult, type GateCheckFn } from "../types.js";

/** Verifies the monorepo actually compiles (`pnpm -r build`) — the only
 * check in the catalog that runs `tsc` for real rather than vitest's
 * transpile-only esbuild path. Exposed standalone (not just folded into
 * `build-gate`/`main-gate`) so an agent debugging a type error can get a
 * fast, narrow answer without paying for a full test+coverage run on
 * every attempt. */
export const requiredArgs: string[] = [];

export const fn: GateCheckFn = async (inspectors, args): Promise<GateCheckResult> => {
  const result = inspectors.coverage.runBuild();

  if (!result.success) {
    return {
      check: "build",
      args,
      passed: false,
      messages: [],
      violations: ["Build failed"],
      summary: "Build failed",
      values: { output: result.output },
    };
  }

  return {
    check: "build",
    args,
    passed: true,
    messages: ["Build succeeded"],
    violations: [],
    summary: "Build succeeded",
    values: { output: result.output },
  };
};
