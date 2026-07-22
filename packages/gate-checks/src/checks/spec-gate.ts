import { type GateCheckResult, type GateCheckFn } from "../types.js";
import { fn as validateSpecCommit } from "./validate-spec-commit.js";

export const requiredArgs: string[] = [];

export const fn: GateCheckFn = async (inspectors, args): Promise<GateCheckResult> => {
  const destinationBranch = (args["destination-branch"] as string) || "main";
  const messages: string[] = [];
  const violations: string[] = [];

  let mergeBase: string;
  try {
    mergeBase = await inspectors.git.mergeBase("HEAD", destinationBranch);
  } catch {
    throw new Error(`Invalid argument: --destination-branch="${destinationBranch}" could not be resolved`);
  }

  let commits: string[];
  try {
    commits = await inspectors.git.revList(mergeBase, "HEAD");
  } catch {
    throw new Error(`Invalid argument: --destination-branch="${destinationBranch}" could not be resolved`);
  }

  if (commits.length !== 1) {
    violations.push(
      `Expected exactly 1 commit between HEAD and ${destinationBranch}, found ${commits.length}`,
    );
    return {
      check: "spec-gate",
      args,
      passed: false,
      messages,
      violations,
      summary: violations.join("; "),
      values: { mergeBase, commits },
    };
  }

  let destCommits: string[];
  try {
    destCommits = await inspectors.git.revList(mergeBase, destinationBranch);
  } catch {
    throw new Error(`Invalid argument: --destination-branch="${destinationBranch}" could not be resolved`);
  }

  if (destCommits.length > 0) {
    violations.push(`Destination branch "${destinationBranch}" has advanced past the merge base`);
    return {
      check: "spec-gate",
      args,
      passed: false,
      messages,
      violations,
      summary: violations.join("; "),
      values: { mergeBase, commits },
    };
  }

  const specResult = await validateSpecCommit(inspectors, {
    "spec-commit-sha": commits[0],
  });

  return {
    check: "spec-gate",
    args,
    passed: specResult.passed,
    messages: [...messages, ...specResult.messages],
    violations: specResult.violations,
    summary: specResult.passed ? "Spec gate passed" : specResult.summary,
    values: { commit: commits[0], ...specResult.values },
  };
};
