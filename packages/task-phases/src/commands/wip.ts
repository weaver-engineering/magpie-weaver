import type { ExternalTools, WipCommandResult } from "../types.js";

/** `pnpm task wip [title] [message]` — see task-phasing-lld.md §3.12.
 * Unimplemented until MAG-46-07. */
export function wip(
  _tools: ExternalTools,
  _args: Record<string, boolean | number | string | string[]>,
): WipCommandResult {
  throw new Error("not implemented");
}
