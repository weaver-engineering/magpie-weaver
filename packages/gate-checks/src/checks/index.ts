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
import { fn as build, requiredArgs as buildArgs } from "./build.js";
import { fn as testGate, requiredArgs as testGateArgs } from "./test-gate.js";
import { fn as buildGate, requiredArgs as buildGateArgs } from "./build-gate.js";
import { fn as mainGate, requiredArgs as mainGateArgs } from "./main-gate.js";

export const catalog: FunctionCatalog = {
  "branch-ref": {
    fn: branchRefFn,
    requiredArgs: branchRefArgs,
    description:
      "Validates that --head-ref (or the current checked-out branch, if omitted) matches the {prefix}/{ref} branch-naming pattern and extracts a well-formed ref from it. If --ref is also given, confirms it agrees with the branch-derived ref.",
    argDescriptions: {
      "head-ref": "Branch name to extract the ref from. Defaults to the current checked-out branch.",
      "ref": "If given, must match the ref extracted from --head-ref.",
    },
  },
  "pr-title": {
    fn: prTitle,
    requiredArgs: prTitleArgs,
    description: "Validates that a PR title starts with --ref, and that --ref itself matches the required [A-Z]+-[0-9]+ pattern.",
    argDescriptions: {
      "ref": "The task ref the PR title must start with.",
      "pr-title": "The PR title text to validate.",
    },
  },
  "get-inbound-commits": {
    fn: getInboundCommits,
    requiredArgs: getInboundCommitsArgs,
    description: "Lists the commits reachable from --head-ref but not from --base-ref; fails if there are none.",
    argDescriptions: {
      "base-ref": "The branch/ref to compare from.",
      "head-ref": "The branch/ref whose inbound commits (relative to --base-ref) are being inspected.",
    },
  },
  "validate-spec-commit": {
    fn: validateSpecCommit,
    requiredArgs: validateSpecCommitArgs,
    description:
      "Validates a spec-phase commit's message: title starts with a valid ref (or matches --ref, if given), continues beyond it, and the body is non-empty.",
    argDescriptions: {
      "spec-commit-ref": "Which commit to validate. Defaults to HEAD.",
      "ref": "If given, the commit title must start with exactly this ref, not just any valid one.",
    },
  },
  "validate-test-commit": {
    fn: validateTestCommit,
    requiredArgs: validateTestCommitArgs,
    description:
      "Validates a test-phase commit's message (as validate-spec-commit) and that it only touches test/, package.json, pnpm-lock.yaml, or *.interface.ts files.",
    argDescriptions: {
      "test-commit-ref": "Which commit to validate. Defaults to HEAD.",
      "ref": "If given, the commit title must start with exactly this ref, not just any valid one.",
    },
  },
  "validate-build-commit": {
    fn: validateBuildCommit,
    requiredArgs: validateBuildCommitArgs,
    description:
      "Validates a build-phase commit's message (as validate-spec-commit) and that it only touches apps/, packages/ (excluding *.interface.ts), package.json, or pnpm-lock.yaml.",
    argDescriptions: {
      "build-commit-ref": "Which commit to validate. Defaults to HEAD.",
      "ref": "If given, the commit title must start with exactly this ref, not just any valid one.",
    },
  },
  "validate-task-commit": {
    fn: validateTaskCommit,
    requiredArgs: validateTaskCommitArgs,
    description:
      "Validates a quick-route task commit's message (as validate-spec-commit, no path restriction) and reports which added/modified/deleted files are tests.",
    argDescriptions: {
      "task-commit-ref": "Which commit to validate. Defaults to HEAD.",
      "ref": "If given, the commit title must start with exactly this ref, not just any valid one.",
    },
  },
  "existing-tests-pass": {
    fn: existingTestsPass,
    requiredArgs: existingTestsPassArgs,
    description:
      "Confirms no pre-existing test has regressed - every currently-failing test file must be one of the given --newTests. Requires coverage to already have been run (see the coverage check) and no uncommitted changes under test/.",
    argDescriptions: {
      "newTests": "New test file path(s), excluded from the existing-tests-must-pass requirement.",
    },
  },
  "new-tests-fail": {
    fn: newTestsFail,
    requiredArgs: newTestsFailArgs,
    description:
      "The fail-then-pass rule's fail half: confirms every listed --newTests file genuinely fails right now. At least one must be given. Requires coverage to already have been run and no uncommitted changes under test/.",
    argDescriptions: {
      "newTests": "New test file path(s) expected to currently fail.",
    },
  },
  "coverage": {
    fn: coverage,
    requiredArgs: coverageArgs,
    description:
      "Runs the test suite with coverage instrumentation and reports line-coverage figures. Other checks (existing-tests-pass, new-tests-fail) depend on this having been run first in the same process.",
    argDescriptions: {
      "expect-failure": "Whether a failing test run is itself the expected condition (true) rather than a violation (false).",
    },
  },
  "build": {
    fn: build,
    requiredArgs: buildArgs,
    description:
      "Verifies the monorepo actually compiles (pnpm -r build) - the only check that runs tsc for real rather than vitest's transpile-only esbuild path. Useful standalone for a fast, narrow build-only answer without paying for a full test+coverage run.",
  },
  "test-gate": {
    fn: testGate,
    requiredArgs: testGateArgs,
    description:
      "The spec/{ref} -> test/{ref} promotion gate: branch-ref, exactly-one-commit-ahead-of-destination, destination-not-advanced, and validate-spec-commit on that one commit. Not GitHub-enforced at the branch-protection level - task-phases enforces it itself.",
    argDescriptions: {
      "ref": "Expected task ref, cross-checked against the branch name.",
      "destination-branch": "Branch to compare against. Defaults to \"origin/main\".",
      "head-ref": "Branch to extract the ref from, passed through to branch-ref. Defaults to the current checked-out branch.",
    },
  },
  "build-gate": {
    fn: buildGate,
    requiredArgs: buildGateArgs,
    description:
      "The test/{ref} -> build/{ref} promotion gate: branch-ref, validate-spec-commit, validate-test-commit, coverage, existing-tests-pass, new-tests-fail, and build. GitHub-enforced via required branch protection.",
    argDescriptions: {
      "ref": "Expected task ref, cross-checked against the branch name.",
      "destination-branch": "Branch to compare against. Defaults to \"origin/main\".",
      "head-ref": "Branch to extract the ref from, passed through to branch-ref. Defaults to the current checked-out branch.",
      "newTests": "New test file path(s) - passed through to existing-tests-pass/new-tests-fail.",
    },
  },
  "main-gate": {
    fn: mainGate,
    requiredArgs: mainGateArgs,
    description:
      "The build/{ref}|task/{ref} -> main promotion gate: branch-ref, validate-spec-commit, validate-test-commit, validate-build-commit, validate-task-commit, coverage, and build. GitHub-enforced via required branch protection.",
    argDescriptions: {
      "ref": "Expected task ref, cross-checked against the branch name.",
      "destination-branch": "Branch to compare against. Defaults to \"origin/main\".",
      "head-ref": "Branch to extract the ref from, passed through to branch-ref. Defaults to the current checked-out branch.",
    },
  },
};
