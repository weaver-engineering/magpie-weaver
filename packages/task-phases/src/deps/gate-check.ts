import { runCheck } from "@magpieweaver/gate-checks";
import type { GateCheckResult, Phase } from "../types.js";

/**
 * Concrete shape of `GateChecksTool` (task-phasing-lld.md §2's
 * `ExternalTools.gateChecks`, detailed in §4.7.1). A thin wrapper over
 * `@magpieweaver/gate-checks`, owning the `Phase` -> destination-gate
 * mapping (§3.7) so no caller needs to know it independently.
 *
 * `run()` calls through to `@magpieweaver/gate-checks`'s public `runCheck`
 * entry point (its `index.ts`/`package.json` `main`) — not into the
 * package's internal `catalog` or inspector construction, which exists
 * only to support gate-checks' own unit-test mocking (MAG-46-08 spec,
 * Correction).
 */
export type GateName = "test-gate" | "build-gate" | "main-gate";

export interface GateChecksTool {
  /** Runs the destination gate check for `phase`'s next gate against the
   * current working tree. `args` MUST include `ref`, mirroring
   * gate-checks's own CLI convention. */
  run(
    phase: Phase,
    args: Record<string, boolean | number | string | string[]>,
  ): Promise<GateCheckResult>;

  /** The destination gate `phase` resolves to, without running it. */
  gateFor(phase: Phase): GateName;
}

export class RealGateChecksTool implements GateChecksTool {
  async run(
    phase: Phase,
    args: Record<string, boolean | number | string | string[]>,
  ): Promise<GateCheckResult> {
    return runCheck(this.gateFor(phase), args);
  }

  gateFor(phase: Phase): GateName {
    switch (phase) {
      case "spec":
        return "test-gate";
      case "test":
        return "build-gate";
      case "build":
      case "quick":
        return "main-gate";
      default:
        throw new Error(`Unknown phase "${phase}"`);
    }
  }
}
