import { type GateCheckResult, type GateCheckFn } from '../types.js';

export const requiredArgs: [string, ...string[]] = ['pr-base-sha', 'pr-head-sha'];

export const fn: GateCheckFn = async (inspectors, args): Promise<GateCheckResult> => {
  const prBaseSha = args['pr-base-sha'] as string;
  const prHeadSha = args['pr-head-sha'] as string;

  if (prBaseSha === prHeadSha) {
    return {
      check: 'get-inbound-commits',
      args,
      passed: false,
      messages: [],
      violations: ['No commits between --pr-base-sha and --pr-head-sha'],
      summary: 'No commits found',
      values: {},
    };
  }

  let commits: string[];
  try {
    commits = await inspectors.git.revList(prBaseSha, prHeadSha);
  } catch {
    throw new Error(
      `Invalid argument: --pr-base-sha="${prBaseSha}" or --pr-head-sha="${prHeadSha}" could not be resolved`,
    );
  }

  if (commits.length === 0) {
    return {
      check: 'get-inbound-commits',
      args,
      passed: false,
      messages: [],
      violations: ['No commits between --pr-base-sha and --pr-head-sha'],
      summary: 'No commits found',
      values: {},
    };
  }

  return {
    check: 'get-inbound-commits',
    args,
    passed: true,
    messages: [`Found ${commits.length} commit(s)`],
    violations: [],
    summary: `${commits.length} commit(s) found`,
    values: { commits },
  };
};
