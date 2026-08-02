import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { catalog } from "./checks/index.js";
import { CoverageInspectorImpl } from "./coverage-inspector.js";
import { GitInspectorImpl } from "./git-inspector.js";
import { findWorkspaceRoot } from "./workspace-root.js";
import type { GateCheckResult } from "./types.js";

/**
 * The package's public library entry point — the thing an external
 * consumer (e.g. `@magpieweaver/task-phases`'s `GateChecksTool`) actually
 * depends on. Constructing `GitInspectorImpl`/`CoverageInspectorImpl`
 * directly is `cli.ts`'s own concern (and gate-checks' own test doubles'
 * — dependency injection exists for mocking *this* package's unit tests,
 * not as a contract external consumers should reach into).
 *
 * Looks up `checkName` in the catalog, validates its required arguments,
 * constructs the real inspectors, and runs the check against the current
 * working tree. Throws on an unknown check name or a missing required
 * argument — same invalid-argument convention every check function in
 * this package already uses — so callers (this package's own `cli.ts`
 * included) handle it via one `try`/`catch`, not a bespoke error path.
 */
export async function runCheck(
  checkName: string,
  args: Record<string, boolean | number | string | string[]>,
  options?: {
    /** Suppresses the coverage inspector's own subprocess (vitest) output.
     * Defaults to `true` — a programmatic caller almost always wants a
     * clean result, not raw test-runner output interleaved with its own.
     * `cli.ts`'s interactive (non-`--json`) mode is the one case that
     * wants the opposite, so it passes `quiet: false` explicitly. */
    quiet?: boolean;
  },
): Promise<GateCheckResult> {
  const def = catalog[checkName];
  if (!def) {
    throw new Error(`Check "${checkName}" not found`);
  }

  for (const requiredArg of def.requiredArgs) {
    if (!(requiredArg in args)) {
      throw new Error(`Missing required argument: --${requiredArg}`);
    }
  }

  const quiet = options?.quiet ?? true;
  const repoRoot = findWorkspaceRoot(dirname(fileURLToPath(import.meta.url)));
  const inspectors = {
    git: new GitInspectorImpl(),
    coverage: new CoverageInspectorImpl({ cwd: repoRoot, json: quiet }),
  };

  const fnResult = def.fn(inspectors, args as Record<string, boolean | number | string>);
  return fnResult instanceof Promise ? await fnResult : fnResult;
}
