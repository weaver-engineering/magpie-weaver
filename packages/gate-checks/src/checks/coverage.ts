import { type GateCheckResult, type GateCheckFn } from "../types.js";

export const requiredArgs: [string, ...string[]] = ["expect-failure"];

export const fn: GateCheckFn = async (inspectors, args): Promise<GateCheckResult> => {
  const violations: string[] = [];
  const messages: string[] = [];
  const expectFailure = args["expect-failure"] === true || args["expect-failure"] === "true";

  let coverageExists = false;
  try {
    await inspectors.coverage.getCoverage();
    coverageExists = true;
  } catch {
    // coverage not run
  }

  if (!coverageExists) {
    return {
      check: "coverage",
      args,
      passed: false,
      messages,
      violations: ["Coverage must be run first"],
      summary: "Coverage not run",
      values: { lineCoverage: 0, newLineCoverage: 0 },
    };
  }
  messages.push("Coverage data loaded");

  if (expectFailure) {
    let testsFailed = false;
    try {
      inspectors.coverage.runTestsWithCoverage();
    } catch {
      testsFailed = true;
    }

    if (!testsFailed) {
      return {
        check: "coverage",
        args,
        passed: false,
        messages,
        violations: ["Tests were expected to fail but all passed"],
        summary: "Expected failure but tests passed",
        values: { lineCoverage: 0, newLineCoverage: 0 },
      };
    }

    messages.push("Tests failed as expected");
    return {
      check: "coverage",
      args,
      passed: true,
      messages,
      violations,
      summary: "Expected test failures confirmed",
      values: { lineCoverage: 0, newLineCoverage: 0 },
    };
  }

  inspectors.coverage.runTestsWithCoverage();
  messages.push("Tests run with coverage");

  let lineCoverage = 0;
  let newLineCoverage = 0;

  try {
    lineCoverage = await inspectors.coverage.getCoverage();
    messages.push(`Line coverage: ${lineCoverage}%`);
  } catch {
    violations.push("Could not read coverage data");
  }

  try {
    newLineCoverage = await inspectors.coverage.getNewLineCoverage();
    messages.push(`New line coverage: ${newLineCoverage}%`);
  } catch {
    violations.push("Could not read new line coverage data");
  }

  if (newLineCoverage <= 90) {
    violations.push(`New line coverage ${newLineCoverage}% is below threshold of 90%`);
  }

  if (lineCoverage <= 80) {
    violations.push(`Line coverage ${lineCoverage}% is below threshold of 80%`);
  }

  return {
    check: "coverage",
    args,
    passed: violations.length === 0,
    messages,
    violations,
    summary: violations.length === 0
      ? `Coverage thresholds met: ${lineCoverage}% line, ${newLineCoverage}% new line`
      : violations.join("; "),
    values: { lineCoverage, newLineCoverage },
  };
};
