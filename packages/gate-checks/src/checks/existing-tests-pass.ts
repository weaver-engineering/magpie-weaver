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

  let result: GateCheckResult;
  try {
    const testResults = await inspectors.coverage.getTestResults();
    messages.push(`Tests: ${testResults.numTotalTests} total, ${testResults.numFailedTests} failed`);

    const unknownFailures = testResults.failingTestFiles.filter(
      (f) => !newTestList.some((n) => f.endsWith(n)),
    );

    if (unknownFailures.length === 0) {
      result = {
        check: "existing-tests-pass",
        args,
        passed: true,
        messages,
        violations,
        summary: testResults.numFailedTests === 0
          ? "All tests pass"
          : "Only new tests fail",
        values: {
          numTests: testResults.numTotalTests,
          numTestFailures: testResults.numFailedTests,
          failingTests: testResults.failingTestFiles,
        },
      };
    } else {
      for (const f of unknownFailures) {
        violations.push(`Existing test fails: ${f}`);
      }
      result = {
        check: "existing-tests-pass",
        args,
        passed: false,
        messages,
        violations,
        summary: "Some existing tests fail",
        values: {
          numTests: testResults.numTotalTests,
          numTestFailures: testResults.numFailedTests,
          failingTests: testResults.failingTestFiles,
        },
      };
    }
  } catch {
    violations.push("Could not read test results");
    result = {
      check: "existing-tests-pass",
      args,
      passed: false,
      messages,
      violations,
      summary: "Could not read test results",
      values: { numTests: 0, numTestFailures: 0, failingTests: [] },
    };
  }

  return result;
};
