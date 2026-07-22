import { type FunctionCatalog } from "../types.js";
import { fn as prAndBranchRefs, requiredArgs as prAndBranchRefsArgs } from "./pr-and-branch-refs.js";
import { fn as prTitle, requiredArgs as prTitleArgs } from "./pr-title.js";
import { fn as getInboundCommits, requiredArgs as getInboundCommitsArgs } from "./get-inbound-commits.js";
import { fn as validateSpecCommit, requiredArgs as validateSpecCommitArgs } from "./validate-spec-commit.js";
import { fn as validateTestCommit, requiredArgs as validateTestCommitArgs } from "./validate-test-commit.js";
import { fn as validateBuildCommit, requiredArgs as validateBuildCommitArgs } from "./validate-build-commit.js";
import { fn as validateTaskCommit, requiredArgs as validateTaskCommitArgs } from "./validate-task-commit.js";
import { fn as existingTestsPass, requiredArgs as existingTestsPassArgs } from "./existing-tests-pass.js";
import { fn as newTestsFail, requiredArgs as newTestsFailArgs } from "./new-tests-fail.js";
import { fn as coverage, requiredArgs as coverageArgs } from "./coverage.js";
import { fn as specGate, requiredArgs as specGateArgs } from "./spec-gate.js";

export const catalog: FunctionCatalog = {
  "pr-and-branch-refs": { fn: prAndBranchRefs, requiredArgs: prAndBranchRefsArgs },
  "pr-title": { fn: prTitle, requiredArgs: prTitleArgs },
  "get-inbound-commits": { fn: getInboundCommits, requiredArgs: getInboundCommitsArgs },
  "validate-spec-commit": { fn: validateSpecCommit, requiredArgs: validateSpecCommitArgs },
  "validate-test-commit": { fn: validateTestCommit, requiredArgs: validateTestCommitArgs },
  "validate-build-commit": { fn: validateBuildCommit, requiredArgs: validateBuildCommitArgs },
  "validate-task-commit": { fn: validateTaskCommit, requiredArgs: validateTaskCommitArgs },
  "existing-tests-pass": { fn: existingTestsPass, requiredArgs: existingTestsPassArgs },
  "new-tests-fail": { fn: newTestsFail, requiredArgs: newTestsFailArgs },
  "coverage": { fn: coverage, requiredArgs: coverageArgs },
  "spec-gate": { fn: specGate, requiredArgs: specGateArgs },
};
