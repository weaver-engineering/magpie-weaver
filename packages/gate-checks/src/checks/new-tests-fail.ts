import { type GateCheckResult, type GateCheckFn } from "../types.js";

export const requiredArgs: string[] = [];

export const fn: GateCheckFn = async (inspectors, args): Promise<GateCheckResult> => {
  const violations: string[] = [];
  const messages: string[] = [];

  const rawNewTests = args["newTests"];
  const newTestList: string[] = Array.isArray(rawNewTests)
    ? (rawNewTests as string[])
    : (rawNewTests ? [String(rawNewTests)] : []);

  if (newTestList.length === 0) {
    return {
      check: "new-tests-fail",
      args,
      passed: false,
      messages,
      violations: ["At least one new test must be defined"],
      summary: "No new tests defined",
      values: { numTests: 0, numTestFailures: 0, newTests: [], newTestFailures: [] },
    };
  }

  let coverageExists = false;
  try {
    await inspectors.coverage.getCoverage();
    coverageExists = true;
  } catch {
    // coverage not run
  }

  if (!coverageExists) {
    return {
      check: "new-tests-fail",
      args,
      passed: false,
      messages,
      violations: ["Coverage must be run first"],
      summary: "Coverage not run",
      values: { numTests: 0, numTestFailures: 0, newTests: newTestList, newTestFailures: [] },
    };
  }
  messages.push("Coverage data exists");

  const uncommitted = await inspectors.git.workingTreeChanges("test/");
  if (uncommitted.length > 0) {
    violations.push(`Uncommitted changes to tests: ${uncommitted.join(", ")}`);
    return {
      check: "new-tests-fail",
      args,
      passed: false,
      messages,
      violations,
      summary: violations.join("; "),
      values: { numTests: 0, numTestFailures: 0, newTests: newTestList, newTestFailures: [] },
    };
  }
  messages.push("No uncommitted test changes");

  let testResults: { numTotalTests: number; numFailedTests: number; failingTestFiles: string[] };
  try {
    testResults = await inspectors.coverage.getTestResults();
  } catch {
    violations.push("Could not read test results");
    return {
      check: "new-tests-fail",
      args,
      passed: false,
      messages,
      violations,
      summary: "Could not read test results",
      values: { numTests: 0, numTestFailures: 0, newTests: newTestList, newTestFailures: [] },
    };
  }

  messages.push(`Tests: ${testResults.numTotalTests} total, ${testResults.numFailedTests} failed`);

  const newTestFailures = testResults.failingTestFiles.filter(
    (f) => newTestList.some((n) => f.endsWith(n)),
  );

  if (newTestFailures.length === 0) {
    violations.push("No new tests fail");
    return {
      check: "new-tests-fail",
      args,
      passed: false,
      messages,
      violations,
      summary: "No new test failures detected",
      values: {
        numTests: testResults.numTotalTests,
        numTestFailures: testResults.numFailedTests,
        newTests: newTestList,
        newTestFailures: [],
      },
    };
  }

  return {
    check: "new-tests-fail",
    args,
    passed: true,
    messages: [`${newTestFailures.length} new test(s) fail`],
    violations,
    summary: "New test failures detected",
    values: {
      numTests: testResults.numTotalTests,
      numTestFailures: testResults.numFailedTests,
      newTests: newTestList,
      newTestFailures,
    },
  };
};
