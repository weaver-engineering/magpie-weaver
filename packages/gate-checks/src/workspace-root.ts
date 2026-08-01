import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** Walks up from `startDir` to find the pnpm workspace root (marked by
 * `pnpm-workspace.yaml`) — never just one level up from this script's own
 * `dist/` directory, which only reaches `packages/gate-checks` itself, not
 * the monorepo root. `CoverageInspectorImpl` needs the real root as its
 * `cwd` so its coverage run's `root` covers every package, not just
 * gate-checks' own `src/` — otherwise `coverage/lcov.info` never contains
 * any other package's files, and `getNewLineCoverage()`'s per-file lookup
 * silently falls through to its "no new lines" 100% default for every
 * commit that touches anything outside gate-checks itself. */
export function findWorkspaceRoot(startDir: string): string {
  let dir = startDir;
  while (true) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`Could not find pnpm-workspace.yaml walking up from ${startDir}`);
    }
    dir = parent;
  }
}
