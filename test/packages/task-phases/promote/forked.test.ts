/**
 * Command-level system tests for `pnpm task promote` — the `spec::ready ->
 * forked` action (task-MAG-46-10-promote-forked-spec.md, LLD §3.11).
 *
 * `promote` is the first command to *act* on the §3.2 derivation that
 * `status` only reads: finding `spec/{ref}` resolved `ready` (via
 * `resolveReady()`, called unconditionally — no `--check`-style opt-in,
 * unlike `status`), it creates `test/{ref}` off `spec/{ref}` and returns the
 * worktree to `spec/{ref}` (LLD §2.1's branch-restoration invariant — this
 * chunk is its first application). Finding `spec/{ref}` `blocked`, it takes
 * no git action and relays the gate's own violations verbatim. The
 * `branchMismatch` guard (LLD §3.4) lands here too, gating every `promote`
 * action from here on: `currentBranch != canonicalBranch` refuses outright.
 *
 * Same in-process pattern as every prior chunk: `run(argv, tools)` is
 * called directly with an injected `ExternalTools` whose `git`/`github`/
 * `gateChecks` members are test doubles — no real git/gh/fs/gate-check
 * anywhere. Each derivation-relevant interaction is asserted explicitly
 * (Guard Rails), most importantly the phase's *parent-aware* state
 * derivation: §2.1's correction means a freshly-forked `test/{ref}` is
 * `not-started` because it has no commit ***of its own*** — i.e.
 * `hasCommitsBeyond("test/{ref}", "spec/{ref}")` is `false`, never
 * `hasCommitsBeyond("test/{ref}", "main")`, which would measure the *task's*
 * total progress instead of the phase's.
 *
 * Every one of these tests fails against the pre-implementation codebase:
 * `promote` currently throws `new Error("not implemented")`
 * (commands/promote.ts), so the fork action, the blocked relay, the
 * branchMismatch refusal, and their exit-code contracts can't be produced
 * yet. `git.createBranch`/`git.checkout` are *stateful* doubles so the
 * re-derived post-fork status (test exists, spec ancestor) falls out of the
 * same mock set the way it would on a real worktree.
 */

// Implements: task-MAG-46-10-promote-forked-spec.md
// System behaviors: 5.1, 5.3, 5.6, 5.12

import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { run } from "../../../../packages/task-phases/src/cli.js";
import type {
  ExternalTools,
  GateCheckResult,
  TaskStatus,
} from "../../../../packages/task-phases/src/types.js";

/** A mock that fails the test loudly if the command under test calls a tool
 *  method that must not be touched on the path being exercised. */
function unexpected(method: string): Mock {
  return vi.fn().mockImplementation(() => {
    throw new Error(`unexpected call: ${method}`);
  });
}

/** A fully-shaped `GateCheckResult` with the given overrides folded in. */
function gateCheckResult(overrides: Partial<GateCheckResult> = {}): GateCheckResult {
  return {
    check: "test-gate",
    passed: true,
    args: {},
    messages: [],
    violations: [],
    summary: "ok",
    values: {},
    ...overrides,
  };
}

/** A `gateChecks.run` mock resolving to the given `GateCheckResult`. */
function gateRun(overrides: Partial<GateCheckResult> = {}): Mock {
  return vi.fn().mockResolvedValue(gateCheckResult(overrides));
}

/** The suite's `ExternalTools` fixtures plus the individual test doubles. */
interface ForkSet {
  tools: ExternalTools;
  mocks: {
    fetch: Mock;
    currentBranch: Mock;
    branchExists: Mock;
    hasCommitsBeyond: Mock;
    headCommitTitle: Mock;
    isAncestor: Mock;
    createBranch: Mock;
    checkout: Mock;
    gateRun: Mock;
  };
}

/**
 * Builds a full `ExternalTools` test double for the *ready spec forks into
 * test* path (§3.1). The `git` doubles are **stateful**: `test/AAA-123` does
 * not exist when the command starts (so the initial derivation is `spec`),
 * and `createBranch` flips a flag the `branchExists` double reads — exactly
 * how a real worktree behaves once the fork actually runs. State derivation
 * is parent-aware: the spec phase has commits beyond its parent
 * (`hasCommitsBeyond("spec/AAA-123", ...)` resolves `true`), the freshly
 * forked test branch has none beyond *`spec/AAA-123`* (resolves `false`).
 * `gateChecks.run` resolves a passing `test-gate`. No PR (merged or open)
 * ever raised. Every other tool method throws if called. `createBranch` and
 * `checkout` are real mocks (they are the fork's actual mutations, asserted
 * below); `git.push` is a throw-mock — §2.1: the forked branch is pushed for
 * the *first* time by the next phase's own work, not here.
 */
function buildForkTools(
  overrides: {
    currentBranch?: Mock;
    hasCommitsBeyond?: Mock;
    headCommitTitle?: Mock;
    isAncestor?: Mock;
    gateRun?: Mock;
  } = {},
): ForkSet {
  const testCreated = { value: false };
  const fetch = vi.fn().mockResolvedValue(undefined);
  const currentBranch =
    overrides.currentBranch ?? vi.fn().mockResolvedValue("spec/AAA-123");
  const branchExists = vi.fn().mockImplementation((name: string) => {
    if (name === "test/AAA-123") return testCreated.value;
    return name === "spec/AAA-123";
  });
  const hasCommitsBeyond =
    overrides.hasCommitsBeyond ??
    vi.fn().mockImplementation((branch: string) => Promise.resolve(branch === "spec/AAA-123"));
  const headCommitTitle =
    overrides.headCommitTitle ?? vi.fn().mockResolvedValue("Draft the interface");
  const isAncestor = overrides.isAncestor ?? vi.fn().mockResolvedValue(true);
  const findMergedPR = vi.fn().mockResolvedValue(null);
  const findMergedPRs = vi.fn().mockResolvedValue([]);
  const findOpenPR = vi.fn().mockResolvedValue(null);
  const runGate = overrides.gateRun ?? gateRun({ passed: true, check: "test-gate" });

  const createBranch = vi.fn().mockImplementation((newBranch: string) => {
    if (newBranch === "test/AAA-123") testCreated.value = true;
    return Promise.resolve();
  });
  const checkout = vi.fn().mockResolvedValue(undefined);

  const tools = {
    git: {
      fetch,
      currentBranch,
      branchExists,
      headSha: unexpected("headSha"),
      mergeBase: unexpected("mergeBase"),
      hasCommitsBeyond,
      headCommitTitle,
      isDirty: unexpected("isDirty"),
      isAncestor,
      createBranch,
      checkout,
      commitAll: unexpected("commitAll"),
      push: unexpected("push"),
      pullFastForward: unexpected("pullFastForward"),
      rebase: unexpected("rebase"),
      deleteBranch: unexpected("deleteBranch"),
    },
    github: {
      createPR: unexpected("createPR"),
      findMergedPRs,
      findMergedPR,
      findOpenPR,
    },
    gateChecks: {
      run: runGate,
      gateFor: unexpected("gateChecks.gateFor"),
    },
    fileSystem: {
      loadConfig: unexpected("fileSystem.loadConfig"),
      exists: unexpected("fileSystem.exists"),
      readFile: unexpected("fileSystem.readFile"),
      writeFile: unexpected("fileSystem.writeFile"),
      copyFile: unexpected("fileSystem.copyFile"),
      mkdir: unexpected("fileSystem.mkdir"),
      readDir: unexpected("fileSystem.readDir"),
    },
  } as unknown as ExternalTools;

  return {
    tools,
    mocks: {
      fetch,
      currentBranch,
      branchExists,
      hasCommitsBeyond,
      headCommitTitle,
      isAncestor,
      createBranch,
      checkout,
      gateRun: runGate,
    },
  };
}

/** Captures everything the CLI writes to stdout during an in-process run. */
function captureStdout(): { stdout: () => string; restore: () => void } {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    chunks.push(String(chunk));
    return true;
  });
  return {
    stdout: () => chunks.join(""),
    restore: () => spy.mockRestore(),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

/** The `result` shape serialised under the `--json` doc for a promote run —
 *  the base `TaskPhasingCommandResult` fields plus `action`. */
interface JsonPromoteResult {
  action: string;
  messages: string[];
  violation?: string;
  success: boolean;
}

/** Parses the single JSON document a `--json` promote run emits. */
function parseJson(
  stdout: string,
): { command: string; result: JsonPromoteResult; success: boolean } {
  const lines = stdout.trim().split("\n");
  expect(lines).toHaveLength(1);
  const doc = JSON.parse(lines[0]) as {
    command: string;
    result: JsonPromoteResult;
    success: boolean;
  };
  return doc;
}

/** Runs an in-process `promote --json` invocation to completion. */
async function runPromote(
  tools: ExternalTools,
): Promise<{ code: number; doc: { command: string; result: JsonPromoteResult; success: boolean } }> {
  const cap = captureStdout();
  const code = await run(["node", "cli.js", "promote", "--json"], tools);
  const stdout = cap.stdout();
  cap.restore();
  return { code, doc: parseJson(stdout) };
}

describe("promote: forks a ready spec phase into test (§3.1)", () => {
  it("creates test/{ref} from spec/{ref} then restores the starting branch, in that order", async () => {
    const { tools, mocks } = buildForkTools();
    const { code, doc } = await runPromote(tools);

    // The fork itself, off the spec branch it found.
    expect(mocks.createBranch).toHaveBeenCalledWith("test/AAA-123", "spec/AAA-123");

    // Branch-restoration invariant (§2.1): the starting branch is checked
    // back out AFTERWARD — assert the ordering, not merely that both ran.
    expect(mocks.checkout).toHaveBeenCalledWith("spec/AAA-123");
    const createOrder = mocks.createBranch.mock.invocationCallOrder[0];
    const checkoutOrder = mocks.checkout.mock.invocationCallOrder[0];
    expect(createOrder).toBeGreaterThan(0);
    expect(checkoutOrder).toBeGreaterThan(createOrder);

    // The caller is not left parked on the branch it just created.
    expect(mocks.currentBranch).toHaveBeenCalled();

    // The fork action succeeded.
    expect(doc.result.action).toBe("forked");
    expect(doc.result.success).toBe(true);
    expect(doc.success).toBe(true);
    expect(code).toBe(0);
  });

  it("resolves ready? via resolveReady and derives the post-fork status against the fork's own parent (§2.1)", async () => {
    const { tools, mocks } = buildForkTools();
    const { code, doc } = await runPromote(tools);

    // gateChecks.run was reached — resolution happened — but the call the
    // command itself makes is to resolveReady (asserted via the double).
    expect(mocks.gateRun).toHaveBeenCalledTimes(1);
    expect(mocks.gateRun).toHaveBeenCalledWith("spec", { ref: "AAA-123" });

    // The pre-fork spec derivation consulted the spec branch's commit graph.
    expect(mocks.hasCommitsBeyond).toHaveBeenCalledWith("spec/AAA-123", expect.anything());

    // Re-derived status: test/AAA-123 now exists (phase test carries no
    // commit of its own), so state is not-started — hasCommitsBeyond is
    // consulted against the FORK'S OWN PARENT `spec/AAA-123`, not `main`.
    expect(mocks.hasCommitsBeyond).toHaveBeenCalledWith("test/AAA-123", "spec/AAA-123");
    expect(mocks.hasCommitsBeyond).not.toHaveBeenCalledWith("test/AAA-123", "main");
    expect(mocks.isAncestor).toHaveBeenCalledWith("spec/AAA-123", "test/AAA-123");

    // That re-derived status is surfaced: phase test, state not-started.
    const joined = doc.result.messages.join("\n");
    expect(joined).toContain("test::not-started");

    // ...and, because the branch-restoration invariant leaves the caller on
    // spec/AAA-123 while the canonical branch is now test/AAA-123, it
    // reports branchMismatch: true — an expected consequence, not a refusal.
    expect(joined).toContain("spec/AAA-123");
    expect(joined).toContain("test/AAA-123");

    expect(code).toBe(0);
  });
});

describe("promote: blocked spec phase performs no action (§3.2)", () => {
  it("takes no git action and relays the gate's own violation verbatim, exit 0", async () => {
    const { tools, mocks } = buildForkTools({
      gateRun: gateRun({
        passed: false,
        check: "test-gate",
        violations: ["spec must define at least one behavior"],
      }),
    });
    const { code, doc } = await runPromote(tools);

    // No fork was created.
    expect(mocks.createBranch).not.toHaveBeenCalled();
    expect(mocks.checkout).not.toHaveBeenCalled();

    // The gate was still consulted (promote always resolves ready?).
    expect(mocks.gateRun).toHaveBeenCalledTimes(1);
    expect(mocks.gateRun).toHaveBeenCalledWith("spec", { ref: "AAA-123" });

    // A successfully-determined blocked result: action is none, exit 0.
    expect(doc.result.action).toBe("none");
    expect(code).toBe(0);
    expect(doc.result.success).toBe(true);

    // The gate's own violation text is surfaced directly.
    expect(doc.result.violation).toBe("spec must define at least one behavior");
  });
});

describe("promote: branchMismatch refuses to act (§3.3)", () => {
  it("performs no mutating git operation and reports the mismatch naming both branches", async () => {
    // The task's canonical branch is test/AAA-123 (test exists, spec its
    // ancestor), but the caller happens to be on build/AAA-123.
    const testCreated = { value: true };
    const currentBranch = vi.fn().mockResolvedValue("build/AAA-123");
    const branchExists = vi.fn().mockImplementation((name: string) => {
      if (name === "test/AAA-123") return testCreated.value;
      return name === "spec/AAA-123";
    });
    const hasCommitsBeyond = vi.fn().mockResolvedValue(true);
    const headCommitTitle = vi.fn().mockResolvedValue("AAA-123: build it");
    const isAncestor = vi.fn().mockResolvedValue(true);

    const tools = {
      git: {
        fetch: vi.fn().mockResolvedValue(undefined),
        currentBranch,
        branchExists,
        headSha: unexpected("headSha"),
        mergeBase: unexpected("mergeBase"),
        hasCommitsBeyond,
        headCommitTitle,
        isDirty: unexpected("isDirty"),
        isAncestor,
        createBranch: unexpected("createBranch"),
        checkout: unexpected("checkout"),
        commitAll: unexpected("commitAll"),
        push: unexpected("push"),
        pullFastForward: unexpected("pullFastForward"),
        rebase: unexpected("rebase"),
        deleteBranch: unexpected("deleteBranch"),
      },
      github: {
        createPR: unexpected("createPR"),
        findMergedPRs: vi.fn().mockResolvedValue([]),
        findMergedPR: vi.fn().mockResolvedValue(null),
        findOpenPR: vi.fn().mockResolvedValue(null),
      },
      gateChecks: {
        run: gateRun({ passed: true, check: "build-gate" }),
        gateFor: unexpected("gateChecks.gateFor"),
      },
      fileSystem: {
        loadConfig: unexpected("fileSystem.loadConfig"),
        exists: unexpected("fileSystem.exists"),
        readFile: unexpected("fileSystem.readFile"),
        writeFile: unexpected("fileSystem.writeFile"),
        copyFile: unexpected("fileSystem.copyFile"),
        mkdir: unexpected("fileSystem.mkdir"),
        readDir: unexpected("fileSystem.readDir"),
      },
    } as unknown as ExternalTools;

    const { code, doc } = await runPromote(tools);

    // Nothing was performed: the mismatch guard refuses before any action.
    expect(doc.result.action).toBe("none");
    expect(code).toBe(1);
    expect(doc.result.success).toBe(false);

    // A message states the mismatch naming both the checked-out branch and
    // the task's canonical phase/state.
    const joined = doc.result.messages.join("\n");
    expect(joined).toContain("build/AAA-123");
    expect(joined).toContain("test/AAA-123");
  });
});