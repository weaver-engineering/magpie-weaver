import type { ExternalTools, RefCommandResult } from "../types.js";

/** `pnpm task <ref> [--wip [title] [message]]` — the `ref` command, see
 * task-phasing-lld.md §3.13. Unimplemented until MAG-46-17. */
export function ref(
  _tools: ExternalTools,
  _args: Record<string, boolean | number | string | string[]>,
): RefCommandResult {
  throw new Error("not implemented");
}
