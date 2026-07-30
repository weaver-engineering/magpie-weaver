import type { ExternalTools, ListCommandResult } from "../types.js";

/** `pnpm task list` — see task-phasing-lld.md §3.10. Unimplemented until
 * MAG-46-16. */
export function list(
  _tools: ExternalTools,
  _args: Record<string, boolean | number | string | string[]>,
): ListCommandResult {
  throw new Error("not implemented");
}
