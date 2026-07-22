import { type GateCheckResult, type GateCheckFn } from "../types.js";

export const requiredArgs: [string, ...string[]] = ["base-ref", "head-ref"];

export const fn: GateCheckFn = async (inspectors, args): Promise<GateCheckResult> => {
  const baseRef = args["base-ref"] as string;
  const headRef = args["head-ref"] as string;

  if (baseRef === headRef) {
    return {
      check: "get-inbound-commits",
      args,
      passed: false,
      messages: [],
      violations: ["No commits between --base-ref and --head-ref"],
      summary: "No commits found",
      values: {},
    };
  }

  let commits: string[];
  try {
    commits = await inspectors.git.revList(baseRef, headRef);
  } catch {
    throw new Error(
      `Invalid argument: --base-ref="${baseRef}" or --head-ref="${headRef}" could not be resolved`,
    );
  }

  if (commits.length === 0) {
    return {
      check: "get-inbound-commits",
      args,
      passed: false,
      messages: [],
      violations: ["No commits between --base-ref and --head-ref"],
      summary: "No commits found",
      values: {},
    };
  }

  return {
    check: "get-inbound-commits",
    args,
    passed: true,
    messages: [`Found ${commits.length} commit(s)`],
    violations: [],
    summary: `${commits.length} commit(s) found`,
    values: { commits },
  };
};
