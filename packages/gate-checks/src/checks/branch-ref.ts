import { type GateCheckResult, type GateCheckFn } from "../types.js";
import { isValidRef, extractRefFromBranch } from "./helpers.js";

export const requiredArgs: string[] = [];

export const fn: GateCheckFn = async (inspectors, args): Promise<GateCheckResult> => {
  const headRef = (args["head-ref"] as string) ?? await inspectors.git.currentBranch();
  const violations: string[] = [];
  const messages: string[] = [];

  const branchRef = extractRefFromBranch(headRef);
  if (!branchRef) {
    violations.push(`--head-ref "${headRef}" does not match pattern */{ref}`);
    return {
      check: "branch-ref",
      args,
      passed: false,
      messages,
      violations,
      summary: violations.join("; "),
      values: {},
    };
  }
  messages.push(`Extracted ref "${branchRef}" from --head-ref`);

  if (!isValidRef(branchRef)) {
    violations.push(`Ref "${branchRef}" does not match required pattern [A-Z]+-[0-9]+`);
    return {
      check: "branch-ref",
      args,
      passed: false,
      messages,
      violations,
      summary: violations.join("; "),
      values: {},
    };
  }

  const explicitRef = args["ref"] as string | undefined;
  if (explicitRef) {
    if (!isValidRef(explicitRef)) {
      violations.push(`--ref "${explicitRef}" does not match required pattern [A-Z]+-[0-9]+`);
      return {
        check: "branch-ref",
        args,
        passed: false,
        messages,
        violations,
        summary: violations.join("; "),
        values: {},
      };
    }
    if (branchRef !== explicitRef) {
      violations.push(`Ref mismatch: branch ref="${branchRef}" does not match --ref="${explicitRef}"`);
      return {
        check: "branch-ref",
        args,
        passed: false,
        messages,
        violations,
        summary: violations.join("; "),
        values: {},
      };
    }
  }

  return {
    check: "branch-ref",
    args,
    passed: true,
    messages,
    violations,
    summary: `Valid ref: ${branchRef}`,
    values: { ref: branchRef },
  };
};
