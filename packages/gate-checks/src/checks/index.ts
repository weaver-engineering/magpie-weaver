import { type FunctionCatalog } from "../types.js";
import { fn as branchRefFn, requiredArgs as branchRefArgs } from "./branch-ref.js";
import { fn as prTitle, requiredArgs as prTitleArgs } from "./pr-title.js";
import { fn as getInboundCommits, requiredArgs as getInboundCommitsArgs } from "./get-inbound-commits.js";
import { fn as validateSpecCommit, requiredArgs as validateSpecCommitArgs } from "./validate-spec-commit.js";
import { fn as validateTestCommit, requiredArgs as validateTestCommitArgs } from "./validate-test-commit.js";
import { fn as validateBuildCommit, requiredArgs as validateBuildCommitArgs } from "./validate-build-commit.js";
import { fn as validateTaskCommit, requiredArgs as validateTaskCommitArgs } from "./validate-task-commit.js";
import { fn as existingTestsPass, requiredArgs as existingTestsPassArgs } from "./existing-tests-pass.js";
import { fn as newTestsFail, requiredArgs as newTestsFailArgs } from "./new-tests-fail.js";
import { fn as coverage, requiredArgs as coverageArgs } from "./coverage.js";
import { fn as testGate, requiredArgs as testGateArgs } from "./test-gate.js";
import { fn as buildGate, requiredArgs as buildGateArgs } from "./build-gate.js";
import { fn as mainGate, requiredArgs as mainGateArgs } from "./main-gate.js";

export const catalog: FunctionCatalog = {
  "branch-ref": { fn: branchRefFn, requiredArgs: branchRefArgs },
  "pr-title": { fn: prTitle, requiredArgs: prTitleArgs },
  "get-inbound-commits": { fn: getInboundCommits, requiredArgs: getInboundCommitsArgs },
  "validate-spec-commit": { fn: validateSpecCommit, requiredArgs: validateSpecCommitArgs },
  "validate-test-commit": { fn: validateTestCommit, requiredArgs: validateTestCommitArgs },
  "validate-build-commit": { fn: validateBuildCommit, requiredArgs: validateBuildCommitArgs },
  "validate-task-commit": { fn: validateTaskCommit, requiredArgs: validateTaskCommitArgs },
  "existing-tests-pass": { fn: existingTestsPass, requiredArgs: existingTestsPassArgs },
  "new-tests-fail": { fn: newTestsFail, requiredArgs: newTestsFailArgs },
  "coverage": { fn: coverage, requiredArgs: coverageArgs },
  "test-gate": { fn: testGate, requiredArgs: testGateArgs },
  "build-gate": { fn: buildGate, requiredArgs: buildGateArgs },
  "main-gate": { fn: mainGate, requiredArgs: mainGateArgs },
};
