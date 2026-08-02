import { type GateCheckResult, type GateCheckFn } from "../types.js";
import { fn as branchRef } from "./branch-ref.js";
import { fn as validateSpecCommit } from "./validate-spec-commit.js";
import { fn as validateTestCommit } from "./validate-test-commit.js";
import { fn as validateBuildCommit } from "./validate-build-commit.js";
import { fn as validateTaskCommit } from "./validate-task-commit.js";
import { fn as coverage } from "./coverage.js";
import { fn as build } from "./build.js";

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
      check: "main-gate",
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

  const currentBranch = (args["head-ref"] as string) ?? await inspectors.git.currentBranch();
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
  const readyBranchPattern = `ready/${ref}`;
  const taskBranchPattern = `task/${ref}`;

  // The full route's Main Gate PR is raised from ready/{ref} (created off
  // build/{ref} once the build commit is ready), not from build/{ref}
  // itself — build/{ref} only ever receives the Build Gate PR merge, so
  // it can be branch-protected without an exception for a direct push.
  // (Not main/{ref}: git can't create that ref at all once `main` itself
  // exists as a branch — refs/heads/main and refs/heads/main/{ref} can't
  // coexist.) This same check runs locally too, as the agent's own
  // self-verification step, possibly before it has renamed/pushed
  // ready/{ref} yet — so both names are accepted here as equivalent.
  if (currentBranch === buildBranchPattern || currentBranch === readyBranchPattern) {
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
    messages.push(...specResult.messages);

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
    messages.push(...testResult.messages);

    const buildResult = await validateBuildCommit(inspectors, {
      "build-commit-ref": commits[0],
      ref,
    });
    if (!buildResult.passed) {
      return {
        check: "main-gate",
        args,
        passed: false,
        messages: [...messages, ...specResult.messages, ...testResult.messages, ...buildResult.messages],
        violations: buildResult.violations,
        summary: buildResult.summary,
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
    messages.push(...buildResult.messages);

    const buildCheckResult = await build(inspectors, {});
    messages.push(...buildCheckResult.messages);
    violations.push(...buildCheckResult.violations);

    const coverageResult = await coverage(inspectors, { "expect-failure": false });
    messages.push(...coverageResult.messages);
    violations.push(...coverageResult.violations);

    const passed = buildResult.passed && buildCheckResult.passed && coverageResult.passed;
    return {
      check: "main-gate",
      args,
      passed,
      messages,
      violations,
      summary: passed ? "Main gate passed" : violations.join("; "),
      values: {
        commit: commits[0],
        specCommit: commits[2],
        testCommit: commits[1],
        ...specResult.values,
        ...testResult.values,
        ...buildResult.values,
        ...buildCheckResult.values,
        ...coverageResult.values,
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
    if (!taskResult.passed) {
      return {
        check: "main-gate",
        args,
        passed: false,
        messages: [...messages, ...taskResult.messages],
        violations: taskResult.violations,
        summary: taskResult.summary,
        values: { commit: commits[0], ...taskResult.values },
      };
    }
    messages.push(...taskResult.messages);

    const buildCheckResult = await build(inspectors, {});
    messages.push(...buildCheckResult.messages);
    violations.push(...buildCheckResult.violations);

    const coverageResult = await coverage(inspectors, { "expect-failure": false });
    messages.push(...coverageResult.messages);
    violations.push(...coverageResult.violations);

    const passed = buildCheckResult.passed && coverageResult.passed;
    return {
      check: "main-gate",
      args,
      passed,
      messages,
      violations,
      summary: passed ? "Main gate passed" : violations.join("; "),
      values: {
        commit: commits[0],
        ...taskResult.values,
        ...buildCheckResult.values,
        ...coverageResult.values,
      },
    };
  }

  violations.push(`Branch "${currentBranch}" does not match build/{ref}, ready/{ref}, or task/{ref}`);
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
