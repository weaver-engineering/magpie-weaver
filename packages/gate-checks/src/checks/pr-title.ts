import { type GateCheckResult, type GateCheckFn } from "../types.js";
import { isValidRef } from "./helpers.js";

export const requiredArgs: [string, ...string[]] = ["ref", "pr-title"];

export const fn: GateCheckFn = async (_inspectors, args): Promise<GateCheckResult> => {
  const ref = args["ref"] as string;
  const prTitle = args["pr-title"] as string;

  const violations: string[] = [];
  const messages: string[] = [];

  if (!isValidRef(ref)) {
    violations.push(`--ref "${ref}" does not match required pattern [A-Z]+-[0-9]+`);
    return {
      check: "pr-title",
      args,
      passed: false,
      messages,
      violations,
      summary: violations.join("; "),
      values: {},
    };
  }
  messages.push(`Ref "${ref}" is valid`);

  if (!prTitle.includes(ref)) {
    violations.push(`PR title "${prTitle}" does not contain ref "${ref}"`);
  } else {
    messages.push(`PR title "${prTitle}" contains ref "${ref}"`);
  }

  return {
    check: "pr-title",
    args,
    passed: violations.length === 0,
    messages,
    violations,
    summary: violations.length === 0
      ? `PR title contains ref "${ref}"`
      : violations.join("; "),
    values: { "pr-title": prTitle },
  };
};
