import { type GateCheckResult, type GateCheckFn } from "../types.js";

export const requiredArgs: string[] = [];

export const fn: GateCheckFn = async (inspectors, args): Promise<GateCheckResult> => {
  const violations: string[] = [];
  const messages: string[] = [];
  const rawNewTests = args["newTests"];
  const newTestList: string[] = Array.isArray(rawNewTests)
    ? (rawNewTests as string[])
    : (rawNewTests ? [String(rawNewTests)] : []);

  let coverageExists = false;
  try {
    await inspectors.coverage.getCoverage();
    coverageExists = true;
  } catch {
    // coverage not run
  }

  if (!coverageExists) {
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
  messages.push("Coverage data exists");

  const uncommitted = await inspectors.git.workingTreeChanges("test/");
  if (uncommitted.length > 0) {
    violations.push(`Uncommitted changes to tests: ${uncommitted.join(", ")}`);
    return {
      check: "existing-tests-pass",
      args,
      passed: false,
      messages,
      violations,
      summary: violations.join("; "),
      values: { numTests: 0, numTestFailures: 0, failingTests: [] },
    };
  }
  messages.push("No uncommitted test changes");

  let testsFailed = false;
  try {
    inspectors.coverage.runTestsWithCoverage();
    messages.push("Tests run with coverage");
  } catch {
    testsFailed = true;
    messages.push("Tests run with coverage");
  }

  if (!testsFailed) {
    return {
      check: "existing-tests-pass",
      args,
      passed: true,
      messages,
      violations,
      summary: "All tests pass",
      values: { numTests: 0, numTestFailures: 0, failingTests: [] },
    };
  }

  if (newTestList.length > 0) {
    messages.push(`${newTestList.length} new test(s) identified`);
    return {
      check: "existing-tests-pass",
      args,
      passed: true,
      messages,
      violations,
      summary: "Only new tests fail",
      values: { numTests: 0, numTestFailures: 0, failingTests: newTestList },
    };
  }

  violations.push("Some existing tests fail");
  return {
    check: "existing-tests-pass",
    args,
    passed: false,
    messages,
    violations,
    summary: "Some existing tests fail",
    values: { numTests: 0, numTestFailures: 0, failingTests: [] },
  };
};
