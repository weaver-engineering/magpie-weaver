/**
 * System tests for the `GateChecksTool` — the `ExternalTools.gateChecks`
 * wrapper (task-phasing-lld.md §4.7/§4.7.1): `gateFor` (the pure
 * `Phase` → `GateName` mapping) and `run` (calls through to
 * `@magpieweaver/gate-checks`'s public `runCheck` and returns its result
 * unmodified).
 *
 * Per the spec's Correction, this chunk is *not* one of the
 * "prove it for real" dev-testing chunks: `@magpieweaver/gate-checks` is
 * an existing, already-thoroughly-tested dependency in this monorepo, so
 * the automated suite calls `GateChecksTool` directly at the TypeScript
 * level with `runCheck` mocked (`vi.mock("@magpieweaver/gate-checks",
 * ...)`), and asserts only the pass-through contract — the right gate
 * name, `args` passed through unchanged (including `ref`), and the result
 * relayed unmodified. It must not spin up real git repositories and must
 * not exercise the real `pnpm task --dev-testing gate-check <method>`
 * CLI subprocess.
 *
 * `RealGateChecksTool` throws "not implemented" during the test phase, so
 * every test that reaches a real method call fails as required by the
 * fail-then-pass rule. §3.4.1 (unknown phase) is already satisfied by the
 * placeholder's throw-before-any-runCheck-call behavior, so it passes and
 * guards that contract against regression.
 *
 * Spec: MAG-46-08 §3.1 gateFor mapping, §3.2 run() calls runCheck with
 * the mapped gate and passes args through, §3.3 run() relays a failing
 * GateCheckResult unmodified, §3.4 error handling.
 */

// Implements: task-MAG-46-08-dev-testing-gate-check-spec.md
// System behaviors: 8.9, 8.10

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@magpieweaver/gate-checks", () => ({
  runCheck: vi.fn(),
}));

import { runCheck } from "@magpieweaver/gate-checks";
import { RealGateChecksTool } from "../../../../packages/task-phases/src/deps/gate-check.js";
import type {
  GateCheckResult,
  Phase,
} from "../../../../packages/task-phases/src/types.js";

const runCheckMock = vi.mocked(runCheck);

// The mock is the one shared with the code under test, so its call history
// must not leak between the run() tests.
beforeEach(() => {
  runCheckMock.mockReset();
});

// ---------------------------------------------------------------------------
// §3.1 gateFor mapping
// ---------------------------------------------------------------------------

describe("§3.1 gateFor mapping", () => {
  it.each([
    ["spec", "test-gate"],
    ["test", "build-gate"],
    ["build", "main-gate"],
    ["quick", "main-gate"],
  ])("maps phase %s to gate %s (§3.1)", (phase, gate) => {
    const tool = new RealGateChecksTool();
    expect(tool.gateFor(phase as Phase)).toBe(gate);
  });
});

// ---------------------------------------------------------------------------
// §3.2 run() calls runCheck with the mapped gate and passes args through
// ---------------------------------------------------------------------------

describe("§3.2 run() calls runCheck with the mapped gate and passes args through", () => {
  it("calls runCheck once with gateFor(phase) and passes args unchanged (§3.2)", async () => {
    const fixedResult: GateCheckResult = {
      check: "test-gate",
      passed: true,
      args: {},
      messages: [],
      violations: [],
      summary: "ok",
      values: {},
    };
    runCheckMock.mockResolvedValueOnce(fixedResult);

    const tool = new RealGateChecksTool();
    const result = await tool.run("spec", { ref: "AAA-001" });

    // Then — runCheck was called exactly once with the mapped gate name
    expect(runCheckMock).toHaveBeenCalledTimes(1);
    const [calledGate, calledArgs] = runCheckMock.mock.calls[0];
    expect(calledGate).toBe("test-gate");
    // args passed through unchanged, including ref (gate-check is
    // deliberately decoupled from task-phases' own branch-naming scheme)
    expect(calledArgs).toEqual({ ref: "AAA-001" });

    // Then — the return value is exactly the mocked result (unmodified)
    expect(result).toEqual(fixedResult);
  });
});

// ---------------------------------------------------------------------------
// §3.3 run() relays a failing GateCheckResult unmodified
// ---------------------------------------------------------------------------

describe("§3.3 run() relays a failing GateCheckResult unmodified", () => {
  it("returns the failing result exactly as runCheck resolved (§3.3)", async () => {
    const failing: GateCheckResult = {
      check: "build-gate",
      passed: false,
      args: { ref: "AAA-002" },
      messages: [],
      violations: ["some real violation message"],
      summary: "failed",
      values: {},
    };
    runCheckMock.mockResolvedValueOnce(failing);

    const tool = new RealGateChecksTool();
    const result = await tool.run("test", { ref: "AAA-002" });

    // Then — passed/violations are relayed unmodified, not re-summarized
    expect(result).toEqual(failing);
  });
});

// ---------------------------------------------------------------------------
// §3.4 Error handling
// ---------------------------------------------------------------------------

describe("§3.4.1 unknown phase", () => {
  it("rejects before runCheck is called at all (§3.4.1)", async () => {
    const tool = new RealGateChecksTool();

    // Then — rejects/throws before runCheck is called
    await expect(
      Promise.resolve().then(() => tool.run("notaphase" as Phase, { ref: "AAA-001" })),
    ).rejects.toThrow();
    expect(runCheckMock).not.toHaveBeenCalled();
  });
});

describe("§3.4.2 runCheck rejecting is not swallowed", () => {
  it("propagates runCheck's rejection unchanged (§3.4.2)", async () => {
    runCheckMock.mockRejectedValueOnce(new Error("boom"));

    const tool = new RealGateChecksTool();

    // Then — the rejection propagates out of run() unchanged
    await expect(
      Promise.resolve().then(() => tool.run("spec", { ref: "AAA-001" })),
    ).rejects.toThrow("boom");
  });
});
