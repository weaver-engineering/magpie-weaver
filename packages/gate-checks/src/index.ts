/**
 * `@magpieweaver/gate-checks`'s public library entry point — matching
 * `package.json`'s `"main": "index.js"`, which had no corresponding
 * source file until now. `runCheck` is the one thing an external
 * consumer needs: everything else (the inspector implementations, the
 * check catalog itself) is this package's own internal wiring, not a
 * contract to depend on directly.
 */
export { runCheck } from "./run-check.js";
export type { GateCheckResult } from "./types.js";
