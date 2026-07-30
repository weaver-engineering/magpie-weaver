import type { ExternalTools, PromoteCommandResult } from "../types.js";

/** `pnpm task promote ...` — see task-phasing-lld.md §3.11. Unimplemented
 * until MAG-46-10. */
export function promote(
  _tools: ExternalTools,
  _args: Record<string, boolean | number | string | string[]>,
): PromoteCommandResult {
  throw new Error("not implemented");
}
