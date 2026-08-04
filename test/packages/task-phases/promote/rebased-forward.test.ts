/**
 * Command-level system tests for `pnpm task promote [--confirm-rebase]
 * [--json]` — the two plain rebase-forward triggers from LLD §3.5 that were
 * missed between MAG-46-10 and MAG-46-14:
 *
 * 1. **Spec amended under an already-forked `test/{ref}`** (§3.1) — `spec`
 *    is derived again (the §3.2 staleness check in `derivePhase` falls back
 *    to `spec` because `spec/{ref}` is no longer an ancestor of
 *    `test/{ref}`), but `test/{ref}` already exists, so instead of forking
 *    `promote` rebases `test/{ref}` onto the amended `spec/{ref}` HEAD,
 *    force-pushes it, and restores the caller's starting branch.
 * 2. **`origin/main` drifting ahead of `spec/{ref}` / `task/{ref}`** (§3.2,
 *    §3.3) — the trunk reference is `origin/main`, not local `main` (§2.1);
 *    when the derived phase's branch is behind it, `promote` rebases the
 *    branch onto `origin/main` and force-pushes.
 *
 * Both resolve to `PromoteCommandResult.action: "rebased"` — distinct from
 * MAG-46-14's `"pulled-and-rebased"`, which only applies to the
 * merged-pending-pull case. `git.rebase` itself is mocked here (the real
 * primitive is MAG-46-13's); this chunk is about `promote` correctly
 * *detecting* each trigger and calling `rebase()` with the right arguments,
 * then reacting to each `RebaseOutcome` variant (`ok` / `conflict` /
 * `unexpected-commit-count`) at the `promote` level.
 *
 * Same in-process pattern as every prior chunk: `run(argv, tools)` is called
 * directly with an injected `ExternalTools` whose `git`/`github`/
 * `gateChecks` members are test doubles — no real git/gh/fs/gate-check
 * anywhere. `git.rebase`/`git.push`/`git.checkout` are the mutating
 * primitives under test, asserted explicitly (Guard Rails); `git.createBranch`
 * is a throw-mock on every fixture — none of these scenarios forks, so any
 * call to it is a regression against spec 10's fork action.
 *
 * Every one of these tests fails against the pre-implementation codebase:
 * `promote` currently only implements the fork (`action: "forked"`) and
 * blocked-relay paths (commands/promote.ts) — the rebase-forward triggers
 * fall through to `new Error("not implemented")`, and the §3.1 fixtures'
 * stale-test branches drive the existing fork path, which the throw-mocked
 * `createBranch` refuses. None of the six scenarios can produce
 * `action: "rebased"` yet.
 */

// Implements: task-MAG-46-10-01-promote-rebase-forward-spec.md
// System behaviors: 1.7.1, 1.7.2, 1.7.4, 1.7.5, 5.7, 5.8, 5.13

import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { run } from "../../../../packages/task-phases/src/cli.js";
import type { RebaseOutcome } from "../../../../packages/task-phases/src/deps/git.js";
import type {
  ExternalTools,
  GateCheckResult,
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
interface RebaseSet {
  tools: ExternalTools;
  mocks: {
    fetch: Mock;
    currentBranch: Mock;
    branchExists: Mock;
    hasCommitsBeyond: Mock;
    headCommitTitle: Mock;
    isAncestor: Mock;
    gateRun: Mock;
    rebase: Mock;
    push: Mock;
    checkout: Mock;
    createBranch: Mock;
  };
}

/**
 * Builds a full `ExternalTools` test double for the rebase-forward paths.
 * Defaults encode the §3.1 scenario (spec amended under an existing
 * `test/AAA-123`): `test/AAA-123` exists, `spec/AAA-123` has a commit of its
 * own (`hasCommitsBeyond` true → `ready?`), no WIP marker, gate passes
 * (→ `ready`), and the derivation's staleness check sees
 * `isAncestor("spec/AAA-123", "test/AAA-123")` as `false` (spec amended
 * after test forked). Every test overrides the pieces its scenario needs;
 * `git.rebase` resolves `{status: "ok"}` unless overridden, and
 * `git.createBranch` is a throw-mock because no rebase-forward path forks.
 * No PR (merged or open) ever raised — `findMergedPR`/`findOpenPR` resolve
 * `null`/`[]`, the no-gate-PR precondition of §3.2's pipeline.
 */
function buildRebaseTools(
  overrides: {
    currentBranch?: Mock;
    branchExists?: Mock;
    hasCommitsBeyond?: Mock;
    headCommitTitle?: Mock;
    isAncestor?: Mock;
    gateRun?: Mock;
    rebase?: Mock;
  } = {},
): RebaseSet {
  const fetch = vi.fn().mockResolvedValue(undefined);
  const currentBranch =
    overrides.currentBranch ?? vi.fn().mockResolvedValue("spec/AAA-123");
  const branchExists =
    overrides.branchExists ??
    vi.fn().mockImplementation((name: string) => {
      return name === "spec/AAA-123" || name === "test/AAA-123";
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

  const rebase = overrides.rebase ?? vi.fn().mockResolvedValue({ status: "ok" });
  const push = vi.fn().mockResolvedValue(undefined);
  const checkout = vi.fn().mockResolvedValue(undefined);
  const createBranch = unexpected("createBranch");

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
      push,
      pullFastForward: unexpected("pullFastForward"),
      rebase,
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
      gateRun: runGate,
      rebase,
      push,
      checkout,
      createBranch,
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
 *  the base `TaskPhasingCommandResult` fields plus `action` and
 *  `rebaseOutcome` (set when the action is `"rebased"`). */
interface JsonRebaseResult {
  action: string;
  messages: string[];
  violation?: string;
  success: boolean;
  rebaseOutcome?: RebaseOutcome;
}

/** Parses the single JSON document a `--json` promote run emits. */
function parseJson(
  stdout: string,
): { command: string; result: JsonRebaseResult; success: boolean } {
  const lines = stdout.trim().split("\n");
  expect(lines).toHaveLength(1);
  const doc = JSON.parse(lines[0]) as {
    command: string;
    result: JsonRebaseResult;
    success: boolean;
  };
  return doc;
}

/** Runs an in-process `promote` invocation to completion, with the given
 *  extra CLI flags (e.g. `--confirm-rebase`) appended after `--json`. */
async function runPromote(
  tools: ExternalTools,
  extraFlags: string[] = [],
): Promise<{ code: number; doc: { command: string; result: JsonRebaseResult; success: boolean } }> {
  const cap = captureStdout();
  const code = await run(["node", "cli.js", "promote", "--json", ...extraFlags], tools);
  const stdout = cap.stdout();
  cap.restore();
  return { code, doc: parseJson(stdout) };
}

describe("promote: spec amended under existing test/{ref} — rebase test onto spec (§3.1)", () => {
  it("rebases test/{ref} onto the amended spec/{ref}, force-pushes, then restores the starting branch", async () => {
    // §3.1 Given: test/AAA-123 exists, spec is NOT its ancestor (spec was
    // amended after test forked), current branch is spec/AAA-123.
    const isAncestor = vi.fn().mockImplementation((ancestor: string, descendant: string) => {
      // The staleness check in the derivation: spec is NOT an ancestor of test.
      return !(ancestor === "spec/AAA-123" && descendant === "test/AAA-123");
    });
    const { tools, mocks } = buildRebaseTools({ isAncestor });
    const { code, doc } = await runPromote(tools, ["--confirm-rebase"]);

    // The rebase itself, onto the amended spec HEAD, in place.
    expect(mocks.rebase).toHaveBeenCalledWith("test/AAA-123", "spec/AAA-123");

    // Force-push of the rewritten branch, ordered after the rebase.
    expect(mocks.push).toHaveBeenCalledWith("test/AAA-123", { force: true });
    const rebaseOrder = mocks.rebase.mock.invocationCallOrder[0];
    const pushOrder = mocks.push.mock.invocationCallOrder[0];
    expect(pushOrder).toBeGreaterThan(rebaseOrder);

    // Branch-restoration invariant (§2.1): `rebase()`'s `--onto`/`<branch>`
    // form leaves `test/AAA-123` checked out, so the caller's starting
    // branch is checked back out AFTERWARD — assert the ordering.
    expect(mocks.checkout).toHaveBeenCalledWith("spec/AAA-123");
    const checkoutOrder = mocks.checkout.mock.invocationCallOrder[0];
    expect(checkoutOrder).toBeGreaterThan(pushOrder);

    // No fork happened — the branch existed and was rebased, not re-created.
    expect(mocks.createBranch).not.toHaveBeenCalled();

    // Result contract: action rebased, rebaseOutcome ok, exit 0.
    expect(doc.result.action).toBe("rebased");
    expect(doc.result.rebaseOutcome).toEqual({ status: "ok" });
    expect(doc.result.success).toBe(true);
    expect(doc.success).toBe(true);
    expect(code).toBe(0);
  });

  it("derives phase spec via the staleness fallback and resolves ready? through the gate before rebasing", async () => {
    const isAncestor = vi.fn().mockImplementation((ancestor: string, descendant: string) => {
      return !(ancestor === "spec/AAA-123" && descendant === "test/AAA-123");
    });
    const { tools, mocks } = buildRebaseTools({ isAncestor });
    const { code } = await runPromote(tools, ["--confirm-rebase"]);

    // promote always resolves ready? (behavior 5.12) — the gate for the
    // spec phase ran and passed.
    expect(mocks.gateRun).toHaveBeenCalledTimes(1);
    expect(mocks.gateRun).toHaveBeenCalledWith("spec", { ref: "AAA-123" });

    // The derivation consulted the spec branch's commit graph, not the test
    // branch's — phase fell back to spec because the ancestry check failed.
    expect(mocks.isAncestor).toHaveBeenCalledWith("spec/AAA-123", "test/AAA-123");
    expect(mocks.hasCommitsBeyond).toHaveBeenCalledWith("spec/AAA-123", expect.anything());

    expect(code).toBe(0);
  });
});

describe("promote: origin/main drifted ahead of spec/{ref} — rebase spec onto origin/main (§3.2)", () => {
  it("rebases spec/{ref} onto origin/main and force-pushes, no restoration needed", async () => {
    // §3.2 Given: test/AAA-124 does NOT exist (phase derives to spec by the
    // ordinary chain), but origin/main is NOT an ancestor of spec/AAA-124 —
    // the trunk has commits not yet reachable from the branch (§2.1's
    // drift reference: origin/main, not local main).
    const currentBranch = vi.fn().mockResolvedValue("spec/AAA-124");
    const branchExists = vi.fn().mockImplementation((name: string) => {
      return name === "spec/AAA-124";
    });
    const hasCommitsBeyond = vi.fn().mockImplementation((branch: string) =>
      Promise.resolve(branch === "spec/AAA-124"),
    );
    const isAncestor = vi.fn().mockImplementation((ancestor: string) => {
      // Drift: origin/main is not an ancestor of the spec branch.
      return !(ancestor === "origin/main");
    });
    const { tools, mocks } = buildRebaseTools({
      currentBranch,
      branchExists,
      hasCommitsBeyond,
      isAncestor,
    });
    const { code, doc } = await runPromote(tools, ["--confirm-rebase"]);

    // The rebase target is the derived branch itself, onto the trunk ref.
    expect(mocks.rebase).toHaveBeenCalledWith("spec/AAA-124", "origin/main");
    expect(mocks.push).toHaveBeenCalledWith("spec/AAA-124", { force: true });
    const rebaseOrder = mocks.rebase.mock.invocationCallOrder[0];
    const pushOrder = mocks.push.mock.invocationCallOrder[0];
    expect(pushOrder).toBeGreaterThan(rebaseOrder);

    // §2.1: the branch being rebased IS the currently-checked-out branch, so
    // rebase()'s internal checkout is a no-op — no restoration call.
    expect(mocks.checkout).not.toHaveBeenCalled();

    // The drift reference was origin/main, not local main.
    expect(mocks.isAncestor).toHaveBeenCalledWith("origin/main", "spec/AAA-124");

    expect(doc.result.action).toBe("rebased");
    expect(doc.result.rebaseOutcome).toEqual({ status: "ok" });
    expect(code).toBe(0);
  });
});

describe("promote: origin/main drifted ahead of task/{ref} on the quick route (§3.3)", () => {
  it("rebases task/{ref} onto origin/main and force-pushes", async () => {
    // §3.3 Given: derived phase is quick for AAA-125 — task/AAA-125 exists,
    // no spec/test branches; origin/main is NOT an ancestor of task/AAA-125.
    const currentBranch = vi.fn().mockResolvedValue("task/AAA-125");
    const branchExists = vi.fn().mockImplementation((name: string) => {
      return name === "task/AAA-125";
    });
    const hasCommitsBeyond = vi.fn().mockImplementation((branch: string) =>
      Promise.resolve(branch === "task/AAA-125"),
    );
    const isAncestor = vi.fn().mockImplementation((ancestor: string) => {
      return !(ancestor === "origin/main");
    });
    const { tools, mocks } = buildRebaseTools({
      currentBranch,
      branchExists,
      hasCommitsBeyond,
      isAncestor,
    });
    const { code, doc } = await runPromote(tools, ["--confirm-rebase"]);

    expect(mocks.rebase).toHaveBeenCalledWith("task/AAA-125", "origin/main");
    expect(mocks.push).toHaveBeenCalledWith("task/AAA-125", { force: true });
    expect(mocks.checkout).not.toHaveBeenCalled();
    expect(mocks.isAncestor).toHaveBeenCalledWith("origin/main", "task/AAA-125");

    expect(doc.result.action).toBe("rebased");
    expect(doc.result.rebaseOutcome).toEqual({ status: "ok" });
    expect(code).toBe(0);
  });
});

describe("promote: missing confirmation refuses in --json mode (§3.4)", () => {
  it("takes no action and explains that --confirm-rebase is required", async () => {
    // Same situation as §3.1 (spec amended under existing test), but
    // --confirm-rebase is NOT given.
    const isAncestor = vi.fn().mockImplementation((ancestor: string, descendant: string) => {
      return !(ancestor === "spec/AAA-123" && descendant === "test/AAA-123");
    });
    const { tools, mocks } = buildRebaseTools({ isAncestor });
    const { code, doc } = await runPromote(tools);

    // Nothing was performed — neither the rebase nor the force-push, nor a
    // fork.
    expect(mocks.rebase).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.createBranch).not.toHaveBeenCalled();
    expect(mocks.checkout).not.toHaveBeenCalled();

    // A message states a rebase is required and --confirm-rebase must be
    // supplied.
    const joined = doc.result.messages.join("\n");
    expect(joined).toContain("--confirm-rebase");

    // Refusal contract: action none, exit 1.
    expect(doc.result.action).toBe("none");
    expect(doc.result.success).toBe(false);
    expect(code).toBe(1);
  });
});

describe("promote: rebase conflict is surfaced, not resolved (§3.5)", () => {
  it("does not push, but still restores the caller's branch, and reports the conflict", async () => {
    const isAncestor = vi.fn().mockImplementation((ancestor: string, descendant: string) => {
      return !(ancestor === "spec/AAA-123" && descendant === "test/AAA-123");
    });
    const rebase = vi
      .fn()
      .mockResolvedValue({ status: "conflict", details: "conflict on test/packages/foo.ts" });
    const { tools, mocks } = buildRebaseTools({ isAncestor, rebase });
    const { code, doc } = await runPromote(tools, ["--confirm-rebase"]);

    // The rebase ran and reported a conflict.
    expect(mocks.rebase).toHaveBeenCalledWith("test/AAA-123", "spec/AAA-123");

    // No force-push of a conflicted rewrite.
    expect(mocks.push).not.toHaveBeenCalled();

    // §2.1: the conflict was discovered mid-replay, AFTER rebase() already
    // checked test/AAA-123 out — the caller's starting branch is restored
    // regardless of outcome.
    expect(mocks.checkout).toHaveBeenCalledWith("spec/AAA-123");

    // The conflict is surfaced via rebaseOutcome, not swallowed; exit 1.
    expect(doc.result.rebaseOutcome).toEqual({
      status: "conflict",
      details: "conflict on test/packages/foo.ts",
    });
    expect(doc.result.success).toBe(false);
    expect(code).toBe(1);
  });
});

describe("promote: unexpected commit count is surfaced, not silently rewritten (§3.6)", () => {
  it("does not push and does not restore, and tells the agent to squash first", async () => {
    const isAncestor = vi.fn().mockImplementation((ancestor: string, descendant: string) => {
      return !(ancestor === "spec/AAA-123" && descendant === "test/AAA-123");
    });
    const rebase = vi.fn().mockResolvedValue({
      status: "unexpected-commit-count",
      expected: 1,
      actual: 3,
      details: "test/AAA-123 has 3 commits of its own, expected 1",
    });
    const { tools, mocks } = buildRebaseTools({ isAncestor, rebase });
    const { code, doc } = await runPromote(tools, ["--confirm-rebase"]);

    expect(mocks.rebase).toHaveBeenCalledWith("test/AAA-123", "spec/AAA-123");
    expect(mocks.push).not.toHaveBeenCalled();

    // §2.1: rebase()'s commit-count precondition is a plain `rev-list
    // --count`, checked BEFORE any checkout is attempted — the worktree
    // never moved, so there is nothing to restore (contrast §3.5).
    expect(mocks.checkout).not.toHaveBeenCalled();

    // The reported message tells the agent the branch carries more than one
    // commit of its own and must be squashed before promoting.
    const joined = doc.result.messages.join("\n");
    expect(joined).toContain("squash");

    // The outcome is surfaced via rebaseOutcome, not swallowed; exit 1.
    expect(doc.result.rebaseOutcome).toEqual({
      status: "unexpected-commit-count",
      expected: 1,
      actual: 3,
      details: "test/AAA-123 has 3 commits of its own, expected 1",
    });
    expect(doc.result.success).toBe(false);
    expect(code).toBe(1);
  });
});
