import { type GateCheckResult, type GateCheckFn } from "../types.js";
import { parseCommitMessage, isValidRef, commitTitleStartsWithRef, commitTitleContinuesBeyondRef } from "./helpers.js";

export const requiredArgs: string[] = [];

const allowedPaths = ["test/", "package.json", "pnpm-lock.yaml"];

function isAllowedPath(filePath: string): boolean {
  return allowedPaths.some((p) => filePath === p || filePath.startsWith(p));
}

export const fn: GateCheckFn = async (inspectors, args): Promise<GateCheckResult> => {
  const commitRef = (args["test-commit-ref"] as string) ?? "HEAD";
  const violations: string[] = [];
  const messages: string[] = [];

  let commitMessage: string;
  try {
    const msgs = await inspectors.git.commitMessages(commitRef);
    commitMessage = msgs[0] ?? "";
  } catch {
    throw new Error(
      `Invalid argument: --test-commit-ref="${commitRef}" could not be resolved`,
    );
  }

  const parsed = parseCommitMessage(commitMessage);
  const explicitRef = args["ref"] as string | undefined;

  if (explicitRef) {
    if (parsed.ref !== explicitRef) {
      violations.push(`Commit message title must start with ref "${explicitRef}"`);
      return {
        check: "validate-test-commit",
        args,
        passed: false,
        messages,
        violations,
        summary: violations.join("; "),
        values: {},
      };
    }
  } else if (!parsed.ref || !isValidRef(parsed.ref)) {
    violations.push("Commit message title must start with a valid ref matching [A-Z]+-[0-9]+");
    return {
      check: "validate-test-commit",
      args,
      passed: false,
      messages,
      violations,
      summary: violations.join("; "),
      values: {},
    };
  }

  const ref = parsed.ref!;

  messages.push(`Ref "${ref}" found in commit message`);

  if (!commitTitleStartsWithRef(parsed.title, ref)) {
    violations.push(`Commit message title must start with "${ref}"`);
  } else if (!commitTitleContinuesBeyondRef(parsed.title, ref)) {
    violations.push("Commit message title must continue beyond the ref");
  } else {
    messages.push(`Commit message title valid: "${parsed.title}"`);
  }

  if (!parsed.body) {
    violations.push("Commit message body must not be empty");
  } else {
    messages.push("Commit message body present");
  }

  const changedFiles = await inspectors.git.diffTree(commitRef);
  const outsideFiles = changedFiles.filter((f) => !isAllowedPath(f));

  if (outsideFiles.length > 0) {
    violations.push(`Changes outside allowed paths: ${outsideFiles.join(", ")}`);
  } else {
    messages.push("Changes within allowed paths (test/, package.json, pnpm-lock.yaml)");
  }

  const newFiles = await inspectors.git.added(commitRef);
  const modifiedFiles = await inspectors.git.modified(commitRef);

  const newTests = newFiles.filter((f) => f.startsWith("test/"));
  const existingTests = modifiedFiles.filter((f) => f.startsWith("test/"));

  if (existingTests.length > 0) {
    violations.push(`Existing tests must not be changed: ${existingTests.join(", ")}`);
  } else {
    messages.push("No existing tests modified");
  }

  if (newTests.length === 0) {
    violations.push("At least one new test must be defined in test/");
  } else {
    messages.push(`${newTests.length} new test(s): ${newTests.join(", ")}`);
  }

  return {
    check: "validate-test-commit",
    args,
    passed: violations.length === 0,
    messages,
    violations,
    summary: violations.length === 0 ? "Valid test commit" : violations.join("; "),
    values: { existingTests, newTests, ref },
  };
};
