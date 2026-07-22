import { type GateCheckResult, type GateCheckFn } from "../types.js";

export const requiredArgs: [string, ...string[]] = ["pr-base-sha", "pr-head-sha"];

export const fn: GateCheckFn = async (inspectors, args): Promise<GateCheckResult> => {
  const violations: string[] = [];
  const messages: string[] = [];

  try {
    await inspectors.coverage.getCoverage();
  } catch {
    return {
      check: "new-tests-fail",
      args,
      passed: false,
      messages,
      violations: ["Coverage must be run first"],
      summary: "Coverage not run",
      values: { numTests: 0, numTestFailures: 0, newTests: [], newTestFailures: [] },
    };
  }

  let testsFailed = false;
  try {
    inspectors.coverage.runTestsWithCoverage();
  } catch {
    testsFailed = true;
  }

  if (!testsFailed) {
    return {
      check: "new-tests-fail",
      args,
      passed: false,
      messages: ["All tests passed"],
      violations: ["Tests were expected to fail but all passed"],
      summary: "No test failures detected",
      values: { numTests: 0, numTestFailures: 0, newTests: [], newTestFailures: [] },
    };
  }

  return {
    check: "new-tests-fail",
    args,
    passed: true,
    messages: ["At least one new test fails"],
    violations,
    summary: "New test failures detected",
    values: { numTests: 0, numTestFailures: 0, newTests: [], newTestFailures: [] },
  };
};
