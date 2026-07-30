import type { ExternalTools, StatusCommandResult } from "../types.js";

/** `pnpm task status ...` — see task-phasing-lld.md §3.9. Unimplemented
 * until MAG-46-04. */
export function status(
  _tools: ExternalTools,
  _args: Record<string, boolean | number | string | string[]>,
): StatusCommandResult {
  throw new Error("not implemented");
}
