import { type GateCheckResult, type GateCheckFn } from "../types.js";
import { fn as branchRef } from "./branch-ref.js";
import { fn as validateSpecCommit } from "./validate-spec-commit.js";
import { fn as validateTestCommit } from "./validate-test-commit.js";
import { fn as validateBuildCommit } from "./validate-build-commit.js";
import { fn as validateTaskCommit } from "./validate-task-commit.js";

export const requiredArgs: string[] = [];

export const fn: GateCheckFn = async (inspectors, args): Promise<GateCheckResult> => {
  const destinationBranch = (args["destination-branch"] as string) || "main";
  const messages: string[] = [];
  const violations: string[] = [];

  const branchResult = await branchRef(inspectors, args);
  if (!branchResult.passed) {
    return {
      check: "main-gate",
      args,
      passed: false,
      messages,
      violations: branchResult.violations,
      summary: branchResult.summary,
      values: {},
    };
  }
  const ref = branchResult.values.ref as string;
  messages.push(...branchResult.messages);
  messages.push("Branch validated via branch-ref");

  const currentBranch = await inspectors.git.currentBranch();
  messages.push(`Current branch: ${currentBranch}`);

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

  let destCommits: string[];
  try {
    destCommits = await inspectors.git.revList(mergeBase, destinationBranch);
  } catch {
    throw new Error(`Invalid argument: --destination-branch="${destinationBranch}" could not be resolved`);
  }

  if (destCommits.length > 0) {
    violations.push(`Destination branch "${destinationBranch}" has advanced past the merge base`);
    return {
      check: "main-gate",
      args,
      passed: false,
      messages,
      violations,
      summary: violations.join("; "),
      values: { mergeBase, commits },
    };
  }
  messages.push(`Destination branch "${destinationBranch}" has not advanced`);

  const buildBranchPattern = `build/${ref}`;
  const taskBranchPattern = `task/${ref}`;

  if (currentBranch === buildBranchPattern) {
    if (commits.length !== 3) {
      violations.push(
        `Expected exactly 3 commits between HEAD and ${destinationBranch}, found ${commits.length}`,
      );
      return {
        check: "main-gate",
        args,
        passed: false,
        messages,
        violations,
        summary: violations.join("; "),
        values: { mergeBase, commits },
      };
    }
    messages.push(`3 commits between HEAD and ${destinationBranch}`);

    const originBranch = `origin/${buildBranchPattern}`;
    let buildBase: string;
    try {
      buildBase = await inspectors.git.mergeBase(originBranch, `HEAD`);
    } catch {
      violations.push(`Remote branch "${originBranch}" could not be resolved`);
      return {
        check: "main-gate",
        args,
        passed: false,
        messages,
        violations,
        summary: violations.join("; "),
        values: { mergeBase, commits },
      };
    }

    if (buildBase !== commits[1]) {
      violations.push(`Merge base with "${originBranch}" must be the second commit (test commit)`);
      return {
        check: "main-gate",
        args,
        passed: false,
        messages,
        violations,
        summary: violations.join("; "),
        values: { mergeBase, commits, buildBase },
      };
    }
    messages.push(`Merge base with "${originBranch}" is the test commit`);

    const specResult = await validateSpecCommit(inspectors, {
      "spec-commit-ref": commits[2],
      ref,
    });
    if (!specResult.passed) {
      return {
        check: "main-gate",
        args,
        passed: false,
        messages: [...messages, ...specResult.messages],
        violations: specResult.violations,
        summary: specResult.summary,
        values: { commit: commits[2], ...specResult.values },
      };
    }

    const testResult = await validateTestCommit(inspectors, {
      "test-commit-ref": commits[1],
      ref,
    });
    if (!testResult.passed) {
      return {
        check: "main-gate",
        args,
        passed: false,
        messages: [...messages, ...specResult.messages, ...testResult.messages],
        violations: testResult.violations,
        summary: testResult.summary,
        values: { commit: commits[1], specCommit: commits[2], ...specResult.values, ...testResult.values },
      };
    }

    const buildResult = await validateBuildCommit(inspectors, {
      "build-commit-ref": commits[0],
      ref,
    });

    return {
      check: "main-gate",
      args,
      passed: buildResult.passed,
      messages: [...messages, ...specResult.messages, ...testResult.messages, ...buildResult.messages],
      violations: buildResult.violations,
      summary: buildResult.passed ? "Main gate passed" : buildResult.summary,
      values: {
        commit: commits[0],
        specCommit: commits[2],
        testCommit: commits[1],
        ...specResult.values,
        ...testResult.values,
        ...buildResult.values,
      },
    };
  }

  if (currentBranch === taskBranchPattern) {
    if (commits.length !== 1) {
      violations.push(
        `Expected exactly 1 commit between HEAD and ${destinationBranch}, found ${commits.length}`,
      );
      return {
        check: "main-gate",
        args,
        passed: false,
        messages,
        violations,
        summary: violations.join("; "),
        values: { mergeBase, commits },
      };
    }
    messages.push(`1 commit between HEAD and ${destinationBranch}`);

    const taskResult = await validateTaskCommit(inspectors, {
      "task-commit-ref": commits[0],
      ref,
    });

    return {
      check: "main-gate",
      args,
      passed: taskResult.passed,
      messages: [...messages, ...taskResult.messages],
      violations: taskResult.violations,
      summary: taskResult.passed ? "Main gate passed" : taskResult.summary,
      values: { commit: commits[0], ...taskResult.values },
    };
  }

  violations.push(`Branch "${currentBranch}" does not match build/{ref} or task/{ref}`);
  return {
    check: "main-gate",
    args,
    passed: false,
    messages,
    violations,
    summary: violations.join("; "),
    values: { currentBranch },
  };
};
