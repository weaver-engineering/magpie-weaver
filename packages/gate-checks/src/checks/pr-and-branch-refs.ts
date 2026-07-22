import { type GateCheckResult, type GateCheckFn } from '../types.js';
import { isValidRef, extractRefFromBranch } from './helpers.js';

export const requiredArgs: [string, ...string[]] = ['head-ref', 'pr-base-ref'];

export const fn: GateCheckFn = async (_inspectors, args): Promise<GateCheckResult> => {
  const headRef = args['head-ref'] as string;
  const prBaseRef = args['pr-base-ref'] as string;

  const violations: string[] = [];
  const messages: string[] = [];

  const headBranchRef = extractRefFromBranch(headRef);
  const baseBranchRef = extractRefFromBranch(prBaseRef);

  if (!headBranchRef) {
    violations.push(`--head-ref "${headRef}" does not match pattern */{ref}`);
  } else {
    messages.push(`Extracted ref "${headBranchRef}" from --head-ref`);
  }

  if (!baseBranchRef) {
    violations.push(`--pr-base-ref "${prBaseRef}" does not match pattern build/{ref}`);
  } else {
    messages.push(`Extracted ref "${baseBranchRef}" from --pr-base-ref`);
  }

  if (headBranchRef && baseBranchRef) {
    if (headBranchRef !== baseBranchRef) {
      violations.push(
        `Ref mismatch: --head-ref ref="${headBranchRef}" does not match --pr-base-ref ref="${baseBranchRef}"`,
      );
    } else if (!isValidRef(headBranchRef)) {
      violations.push(
        `Ref "${headBranchRef}" does not match required pattern [A-Z]+-[0-9]+`,
      );
    }
  }

  const ref = headBranchRef && baseBranchRef === headBranchRef && isValidRef(headBranchRef)
    ? headBranchRef
    : undefined;

  return {
    check: 'pr-and-branch-refs',
    args,
    passed: violations.length === 0,
    messages,
    violations,
    summary: violations.length === 0
      ? `Valid refs: head-ref="${headRef}", pr-base-ref="${prBaseRef}"`
      : violations.join('; '),
    values: ref ? { ref } : {},
  };
};
