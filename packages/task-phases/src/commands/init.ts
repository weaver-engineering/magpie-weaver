import type { ExternalTools, InitCommandResult } from "../types.js";

/** `pnpm task init <ref> ...` — see task-phasing-lld.md §3.8. Unimplemented
 * until MAG-46-05. */
export function init(
  _tools: ExternalTools,
  _args: Record<string, boolean | number | string | string[]>,
): InitCommandResult {
  throw new Error("not implemented");
}
