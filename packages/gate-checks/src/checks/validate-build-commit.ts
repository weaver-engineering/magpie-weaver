import { type GateCheckResult, type GateCheckFn } from "../types.js";
import { parseCommitMessage, isValidRef, commitTitleStartsWithRef, commitTitleContinuesBeyondRef } from "./helpers.js";

export const requiredArgs: [string, ...string[]] = ["build-commit-sha"];

const allowedPaths = ["apps/", "packages/", "package.json", "pnpm-lock.yaml"];

function isAllowedPath(filePath: string): boolean {
  return allowedPaths.some((p) => filePath === p || filePath.startsWith(p));
}

export const fn: GateCheckFn = async (inspectors, args): Promise<GateCheckResult> => {
  const commitSha = args["build-commit-sha"] as string;
  const violations: string[] = [];
  const messages: string[] = [];

  let commitMessage: string;
  try {
    const msgs = await inspectors.git.commitMessages(commitSha);
    commitMessage = msgs[0] ?? "";
  } catch {
    throw new Error(
      `Invalid argument: --build-commit-sha="${commitSha}" could not be resolved`,
    );
  }

  const parsed = parseCommitMessage(commitMessage);
  if (!parsed.ref || !isValidRef(parsed.ref)) {
    violations.push("Commit message title must start with a valid ref matching [A-Z]+-[0-9]+");
    return {
      check: "validate-build-commit",
      args,
      passed: false,
      messages,
      violations,
      summary: violations.join("; "),
      values: {},
    };
  }

  const ref = parsed.ref;

  if (!commitTitleStartsWithRef(parsed.title, ref)) {
    violations.push(`Commit message title must start with "${ref}"`);
  } else if (!commitTitleContinuesBeyondRef(parsed.title, ref)) {
    violations.push("Commit message title must continue beyond the ref");
  }

  if (!parsed.body) {
    violations.push("Commit message body must not be empty");
  }

  const changedFiles = await inspectors.git.diffTree(commitSha);
  const outsideFiles = changedFiles.filter((f) => !isAllowedPath(f));

  if (outsideFiles.length > 0) {
    violations.push(`Changes outside allowed paths: ${outsideFiles.join(", ")}`);
  }

  const newFiles = await inspectors.git.added(commitSha);
  const modifiedFiles = await inspectors.git.modified(commitSha);
  const deletedFiles = await inspectors.git.deleted(commitSha);

  return {
    check: "validate-build-commit",
    args,
    passed: violations.length === 0,
    messages,
    violations,
    summary: violations.length === 0 ? "Valid build commit" : violations.join("; "),
    values: { newFiles, modifiedFiles, deletedFiles },
  };
};
