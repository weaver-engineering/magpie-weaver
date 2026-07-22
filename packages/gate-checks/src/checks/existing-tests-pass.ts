import { type GateCheckResult, type GateCheckFn } from "../types.js";

export const requiredArgs: [string, ...string[]] = ["pr-base-sha", "pr-head-sha"];

export const fn: GateCheckFn = async (inspectors, args): Promise<GateCheckResult> => {
  const violations: string[] = [];
  const messages: string[] = [];

  try {
    await inspectors.coverage.getCoverage();
  } catch {
    return {
      check: "existing-tests-pass",
      args,
      passed: false,
      messages,
      violations: ["Coverage must be run first"],
      summary: "Coverage not run",
      values: { numTests: 0, numTestFailures: 0, failingTests: [] },
    };
  }

  try {
    inspectors.coverage.runTestsWithCoverage();
  } catch {
    return {
      check: "existing-tests-pass",
      args,
      passed: false,
      messages,
      violations: ["Some existing tests fail"],
      summary: "Some existing tests fail",
      values: { numTests: 0, numTestFailures: 0, failingTests: [] },
    };
  }

  return {
    check: "existing-tests-pass",
    args,
    passed: true,
    messages: ["All existing tests pass"],
    violations,
    summary: "All existing tests pass",
    values: { numTests: 0, numTestFailures: 0, failingTests: [] },
  };
};
