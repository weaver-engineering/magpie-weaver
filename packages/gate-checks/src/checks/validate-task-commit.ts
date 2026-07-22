import { type GateCheckResult, type GateCheckFn } from '../types.js';
import { parseCommitMessage, isValidRef, commitTitleStartsWithRef, commitTitleContinuesBeyondRef } from './helpers.js';

export const requiredArgs: [string, ...string[]] = ['task-commit-sha'];

export const fn: GateCheckFn = async (inspectors, args): Promise<GateCheckResult> => {
  const commitSha = args['task-commit-sha'] as string;
  const violations: string[] = [];
  const messages: string[] = [];

  let commitMessage: string;
  try {
    const msgs = await inspectors.git.commitMessages(commitSha);
    commitMessage = msgs[0] ?? '';
  } catch {
    throw new Error(
      `Invalid argument: --task-commit-sha="${commitSha}" could not be resolved`,
    );
  }

  const parsed = parseCommitMessage(commitMessage);
  if (!parsed.ref || !isValidRef(parsed.ref)) {
    violations.push('Commit message title must start with a valid ref matching [A-Z]+-[0-9]+');
    return {
      check: 'validate-task-commit',
      args,
      passed: false,
      messages,
      violations,
      summary: violations.join('; '),
      values: {},
    };
  }

  const ref = parsed.ref;

  if (!commitTitleStartsWithRef(parsed.title, ref)) {
    violations.push(`Commit message title must start with "${ref}"`);
  } else if (!commitTitleContinuesBeyondRef(parsed.title, ref)) {
    violations.push('Commit message title must continue beyond the ref');
  }

  if (!parsed.body) {
    violations.push('Commit message body must not be empty');
  }

  const modifiedFiles = await inspectors.git.modified(commitSha);
  const newFiles = await inspectors.git.added(commitSha);
  const deletedFiles = await inspectors.git.deleted(commitSha);

  const testFiles = /^test\//;
  const newTests = newFiles.filter((f) => testFiles.test(f));
  const modifiedTests = modifiedFiles.filter((f) => testFiles.test(f));
  const deletedTests = deletedFiles.filter((f) => testFiles.test(f));

  return {
    check: 'validate-task-commit',
    args,
    passed: violations.length === 0,
    messages,
    violations,
    summary: violations.length === 0 ? 'Valid task commit' : violations.join('; '),
    values: {
      newFiles,
      modifiedFiles,
      deletedFiles,
      newTests,
      modifiedTests,
      deletedTests,
    },
  };
};
