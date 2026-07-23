import { type GateCheckResult, type GateCheckFn } from "../types.js";

export const requiredArgs: [string, ...string[]] = ["expect-failure"];

export const fn: GateCheckFn = async (inspectors, args): Promise<GateCheckResult> => {
  const violations: string[] = [];
  const messages: string[] = [];
  const expectFailure = args["expect-failure"] === true || args["expect-failure"] === "true";

  let testsFailed = false;
  try {
    inspectors.coverage.runTestsWithCoverage();
    messages.push("Tests run with coverage");
  } catch {
    testsFailed = true;
    messages.push("Tests run with coverage");
  }

  if (testsFailed && expectFailure) {
    messages.push("Tests failed as expected");
  } else if (testsFailed && !expectFailure) {
    violations.push("Tests failed");
  } else if (!testsFailed && expectFailure) {
    violations.push("Tests were expected to fail but all passed");
  }

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
