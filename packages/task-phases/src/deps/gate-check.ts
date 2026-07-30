import type { GateCheckResult, Phase } from "../types.js";

/**
 * Concrete shape of `GateChecksTool` (task-phasing-lld.md §2's
 * `ExternalTools.gateChecks`, detailed in §4.7.1). A thin wrapper over
 * `@magpieweaver/gate-checks`, owning the `Phase` -> destination-gate
 * mapping (§3.7) so no caller needs to know it independently.
 *
 * `RealGateChecksTool` below is a placeholder only: every method throws,
 * including `gateFor` — no method is implemented until the chunk that
 * owns it (MAG-46-08).
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
  run(
    _phase: Phase,
    _args: Record<string, boolean | number | string | string[]>,
  ): Promise<GateCheckResult> {
    throw new Error("not implemented");
  }

  gateFor(_phase: Phase): GateName {
    throw new Error("not implemented");
  }
}
