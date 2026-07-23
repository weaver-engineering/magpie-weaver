import { type GateCheckResult, type GateCheckFn } from "../types.js";
import { fn as branchRef } from "./branch-ref.js";
import { fn as validateSpecCommit } from "./validate-spec-commit.js";
import { fn as validateTestCommit } from "./validate-test-commit.js";
import { fn as coverage } from "./coverage.js";
import { fn as existingTestsPass } from "./existing-tests-pass.js";
import { fn as newTestsFail } from "./new-tests-fail.js";

export const requiredArgs: string[] = [];

export const fn: GateCheckFn = async (inspectors, args): Promise<GateCheckResult> => {
  const destinationBranch = (args["destination-branch"] as string) || "main";
  const explicitRef = args["ref"] as string | undefined;
  const messages: string[] = [];
  const violations: string[] = [];

  if (explicitRef) {
    messages.push(`Using explicit --ref: "${explicitRef}"`);
  }

  const branchResult = await branchRef(inspectors, args);
  if (!branchResult.passed) {
    return {
      check: "build-gate",
      args,
      passed: false,
      messages,
      violations: branchResult.violations,
      summary: branchResult.summary,
      values: {},
    };
  }
  const ref = explicitRef ?? (branchResult.values.ref as string);
  messages.push(...branchResult.messages);
  messages.push("Branch validated via branch-ref");

  let mergeBase: string;
  try {
    mergeBase = await inspectors.git.mergeBase("HEAD", destinationBranch);
  } catch {
    throw new Error(`Invalid argument: --destination-branch="${destinationBranch}" could not be resolved`);
  }
  messages.push(`Merge base with "${destinationBranch}": ${mergeBase}`);

  let commits: string[];
  try {
    commits = await inspectors.git.revList(mergeBase, "HEAD");
  } catch {
    throw new Error(`Invalid argument: --destination-branch="${destinationBranch}" could not be resolved`);
  }

  if (commits.length !== 2) {
    violations.push(
      `Expected exactly 2 commits between HEAD and ${destinationBranch}, found ${commits.length}`,
    );
    return {
      check: "build-gate",
      args,
      passed: false,
      messages,
      violations,
      summary: violations.join("; "),
      values: { mergeBase, commits },
    };
  }
  messages.push(`2 commits between HEAD and ${destinationBranch}`);

  let destCommits: string[];
  try {
    destCommits = await inspectors.git.revList(mergeBase, destinationBranch);
  } catch {
    throw new Error(`Invalid argument: --destination-branch="${destinationBranch}" could not be resolved`);
  }

  if (destCommits.length > 0) {
    violations.push(`Destination branch "${destinationBranch}" has advanced past the merge base`);
    return {
      check: "build-gate",
      args,
      passed: false,
      messages,
      violations,
      summary: violations.join("; "),
      values: { mergeBase, commits },
    };
  }
  messages.push(`Destination branch "${destinationBranch}" has not advanced`);

  const specResult = await validateSpecCommit(inspectors, {
    "spec-commit-ref": commits[1],
    ref,
  });

  if (!specResult.passed) {
    return {
      check: "build-gate",
      args,
      passed: false,
      messages: [...messages, ...specResult.messages],
      violations: specResult.violations,
      summary: specResult.summary,
      values: { commit: commits[1], ...specResult.values },
    };
  }
  messages.push(...specResult.messages);

  const testResult = await validateTestCommit(inspectors, {
    "test-commit-ref": commits[0],
    ref,
  });

  if (!testResult.passed) {
    return {
      check: "build-gate",
      args,
      passed: false,
      messages: [...messages, ...testResult.messages],
      violations: testResult.violations,
      summary: testResult.summary,
      values: { commit: commits[0], specCommit: commits[1], ...specResult.values, ...testResult.values },
    };
  }
  messages.push(...testResult.messages);

  const newTestsRaw = testResult.values?.newTests;
  const newTestList: string[] = Array.isArray(newTestsRaw)
    ? (newTestsRaw as string[])
    : (newTestsRaw ? [String(newTestsRaw)] : []);

  const coverageResult = await coverage(inspectors, { "expect-failure": true });
  messages.push(...coverageResult.messages);
  violations.push(...coverageResult.violations);

  const existingPassResult = await existingTestsPass(
    inspectors,
    { newTests: newTestList } as unknown as Record<string, boolean | number | string>,
  );
  messages.push(...existingPassResult.messages);
  violations.push(...existingPassResult.violations);

  const newTestsFailResult = await newTestsFail(
    inspectors,
    { newTests: newTestList } as unknown as Record<string, boolean | number | string>,
  );
  messages.push(...newTestsFailResult.messages);
  violations.push(...newTestsFailResult.violations);

  const passed = coverageResult.passed && existingPassResult.passed && newTestsFailResult.passed;
  return {
    check: "build-gate",
    args,
    passed,
    messages,
    violations,
    summary: passed ? "Build gate passed" : violations.join("; "),
    values: {
      commit: commits[0],
      specCommit: commits[1],
      ...specResult.values,
      ...testResult.values,
      ...coverageResult.values,
      ...existingPassResult.values,
      ...newTestsFailResult.values,
    },
  };
};
