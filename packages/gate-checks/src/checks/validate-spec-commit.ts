import { type GateCheckResult, type GateCheckFn } from "../types.js";
import { parseCommitMessage, isValidRef, commitTitleStartsWithRef, commitTitleContinuesBeyondRef } from "./helpers.js";

export const requiredArgs: string[] = [];

export const fn: GateCheckFn = async (inspectors, args): Promise<GateCheckResult> => {
  const commitRef = (args["spec-commit-ref"] as string) ?? "HEAD";
  const violations: string[] = [];
  const messages: string[] = [];

  let commitMessage: string;
  try {
    const msgs = await inspectors.git.commitMessages(commitRef);
    commitMessage = msgs[0] ?? "";
  } catch {
    throw new Error(
      `Invalid argument: --spec-commit-ref="${commitRef}" could not be resolved`,
    );
  }

  const parsed = parseCommitMessage(commitMessage);
  const explicitRef = args["ref"] as string | undefined;

  if (explicitRef) {
    if (parsed.ref !== explicitRef) {
      violations.push(`Commit message title must start with ref "${explicitRef}"`);
      return {
        check: "validate-spec-commit",
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
      check: "validate-spec-commit",
      args,
      passed: false,
      messages,
      violations,
      summary: violations.join("; "),
      values: {},
    };
  }

  const ref = parsed.ref!;

  if (!commitTitleStartsWithRef(parsed.title, ref)) {
    violations.push(`Commit message title must start with "${ref}"`);
  } else if (!commitTitleContinuesBeyondRef(parsed.title, ref)) {
    violations.push("Commit message title must continue beyond the ref");
  }

  if (!parsed.body) {
    violations.push("Commit message body must not be empty");
  }

  const taskDir = `docs/tasks/task-${ref}`;
  const taskFile = `${taskDir}/task-${ref}.md`;
  const specPattern = /^task-[A-Z]+-[0-9]+(-[0-9]+)?(-[a-z][a-z0-9-]*)?-spec\.md$/;

  let taskFiles: string[];
  try {
    taskFiles = await inspectors.git.lsTree(commitRef, taskDir);
  } catch {
    taskFiles = [];
  }

  if (taskFiles.length === 0) {
    violations.push(`Task directory "${taskDir}" does not exist`);
  }

  const taskFileExists = taskFiles.includes(taskFile);
  if (!taskFileExists) {
    violations.push(`Task file "${taskFile}" does not exist`);
  }

  const specFiles = taskFiles.filter((f) => {
    const basename = f.replace(`${taskDir}/`, "");
    return specPattern.test(basename);
  });

  if (specFiles.length === 0) {
    violations.push("No specification files found");
  }

  const changedFiles = await inspectors.git.diffTree(commitRef);
  const changesOutside = changedFiles.filter((f) => !f.startsWith(taskDir));

  if (changesOutside.length > 0) {
    violations.push(`Changes outside task directory: ${changesOutside.join(", ")}`);
  }

  return {
    check: "validate-spec-commit",
    args,
    passed: violations.length === 0,
    messages,
    violations,
    summary: violations.length === 0 ? "Valid spec commit" : violations.join("; "),
    values: { task: taskFile, specs: specFiles, ref },
  };
};
