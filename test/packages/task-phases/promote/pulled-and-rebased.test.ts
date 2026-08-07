/**
 * Command-level system tests for `pnpm task promote [--confirm-rebase]
 * [--json]` resolving the `merged-pending-pull` state (derived in
 * MAG-46-12) into either `pulled` or `pulled-and-rebased`
 * (task-MAG-46-14-promote-pulled-and-rebase-spec.md, LLD §3.5's
 * build-reorder case).
 *
 * Six behaviors under test, kept separate per §3.1–§3.6:
 *   1. `merged-pending-pull` with no local `build/{ref}` (nothing
 *      pre-existing to reorder) -> plain fast-forward: `pullFastForward`
 *      is called, `rebase` is NOT, `action: "pulled"`, no confirmation
 *      required, exit 0 (§3.1).
 *   2. `merged-pending-pull` with local `build/{ref}` carrying a
 *      pre-existing build commit -> `pullFastForward` THEN `rebase` onto
 *      the fresh merge, THEN `push({force: true})`, `action:
 *      "pulled-and-rebased"`, `rebaseOutcome: {status: "ok"}`, exit 0 —
 *      gated by `--confirm-rebase` (§3.2).
 *   3. That cascading case WITHOUT `--confirm-rebase` in `--json` mode
 *      refuses cleanly: no git action at all, a message naming
 *      `--confirm-rebase`, `action: "none"`, exit 1 (§3.3).
 *   4. A rebase conflict is surfaced, not silently resolved: no push,
 *      `rebaseOutcome.status: "conflict"`, a message stating the
 *      newly-merged test content takes precedence, exit 1 (§3.4).
 *   5. An unexpected commit count is surfaced: no push, action STILL
 *      `"pulled-and-rebased"` (the pull half completed; only the rebase
 *      half failed — visible via `rebaseOutcome`, not a reversion to
 *      `"pulled"`/`"none"`), exit 1 (§3.5).
 *   6. The interactive (no `--json`) `y/N` prompt gates the cascading
 *      rebase+push identically to `--confirm-rebase`: `y` proceeds
 *      (§3.6 first Given), `n` or no input refuses with `action: "none"`
 *      and exit 1 (§3.6 second Given).
 *
 * `git.rebase`/`git.pullFastForward` are mocked here — the real
 * primitives were proven by MAG-46-13's dev-testing chunk; this chunk is
 * about `promote` consuming the shared `deriveRepoState()` pipeline
 * (§2.1: it never re-checks `build/{ref}`'s ancestry itself) and calling
 * them in the right order with the right gating.
 *
 * Same in-process pattern as every prior chunk: `run(argv, tools)` is
 * called directly with an injected `ExternalTools` whose `git`/`github`/
 * `gateChecks` members are test doubles — no real git/gh/fs/gate-check
 * anywhere. The derivation fixture mirrors `status/merged-pending-pull
 * .test.ts`'s (MAG-46-12): a confirmed-merged Build Gate PR
 * (`build/{ref}` <- `test/{ref}`) whose `headRefOid` matches
 * `origin/test/{ref}`'s current HEAD, with local `build/{ref}` absent
 * (§3.1) or behind `origin/build/{ref}` (§3.2–§3.6). The caller sits on
 * the derived phase's canonical branch (`build/{ref}`) so LLD §3.4's
 * `branchMismatch` guard passes — the same convention MAG-46-12's own
 * fixtures use. Mutating git methods that a scenario must NOT reach
 * (`rebase`/`push` in the plain-pull case, `pullFastForward`/`rebase`/
 * `push` in the refusal case, `push` in both failure cases, and
 * `checkout`/`createBranch`/`createRemoteBranch` everywhere) are
 * throw-mocks, so "no action" is enforced structurally, not merely
 * asserted.
 *
 * §3.6's interactive path is tested the way the spec's §2.1 correction
 * prescribes: `process.stdin` is mocked directly (swapped for a fake
 * `Readable` that pushes the canned answer and ends) — the mirror of
 * every file's `captureStdout()` helper — because the confirmation read
 * is CLI-layer I/O, not an `ExternalTools` member. Non-`--json` mode has
 * no structured output to parse the `PromoteCommandResult` from, so the
 * interactive tests spy on the command registry (the same `promote`
 * handler `run()` dispatches through) to capture the result object for
 * the `action`/`success` assertions while still exercising the real
 * argv/dispatch/exit-code path.
 *
 * Every one of these tests fails against the pre-implementation
 * codebase: `promote` currently only implements the fork, rebase-forward,
 * pr-raised, awaiting-pr no-op, and blocked-relay paths
 * (commands/promote.ts); a `merged-pending-pull` derivation falls through
 * to `new Error("not implemented")`. None of the six scenarios can
 * produce `action: "pulled"`/`"pulled-and-rebased"` — or a `"none"` that
 * names `--confirm-rebase` — yet.
 *
 * **Correction (architect fix, task/MAG-49 prerequisite):** `buildTools`'s
 * `isAncestor` double was an unconditional `true`, which happened to be
 * harmless only because `derivePrState`'s local-vs-origin comparison used
 * to be a plain `headSha` inequality that never consulted it. MAG-49
 * corrected that comparison to resolve direction via `isAncestor` (so that
 * "local carries its own commit(s) beyond origin" — build-implementer's
 * ordinary workflow once commits land straight on `build/{ref}` — no
 * longer misroutes into this file's `merged-pending-pull` scenarios
 * forever). An unconditional `true` here would now resolve
 * `isAncestor(origin/build/{ref}, build/{ref})` as true and misroute every
 * §3.2-§3.6 scenario into the ordinary ready? derivation instead of
 * `merged-pending-pull`, so the double now only resolves true for the
 * "local is an ancestor of origin" direction these scenarios actually
 * intend (behind, per this file's own fixture-mirrors-status-test comment
 * above). See task-MAG-49.md §3 correction for the full derivation.
 */

// Implements: task-MAG-46-14-promote-pulled-and-rebase-spec.md
// Spec sections: §3.1 (plain pull, no pre-existing build commits), §3.2
//   (pull + rebase, confirmed), §3.3 (missing confirmation refuses in
//   --json mode), §3.4 (rebase conflict surfaced), §3.5 (unexpected
//   commit count surfaced), §3.6 (interactive y/N confirmation)

import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { Readable } from "node:stream";
import { run } from "../../../../packages/task-phases/src/cli.js";
import { commandRegistry } from "../../../../packages/task-phases/src/registry.js";
import { promote as realPromote } from "../../../../packages/task-phases/src/commands/promote.js";
import type { RebaseOutcome } from "../../../../packages/task-phases/src/deps/git.js";
import type {
  ExternalTools,
  MergedPullRequestSummary,
  PromoteCommandResult,
} from "../../../../packages/task-phases/src/types.js";

/** A mock that fails the test loudly if the command under test calls a tool
 *  method that must not be touched on the path being exercised. */
function unexpected(method: string): Mock {
  return vi.fn().mockImplementation(() => {
    throw new Error(`unexpected call: ${method}`);
  });
}

/** A `headSha` double returning a value for exactly the given branches and
 *  failing the test loudly for any other — enforces that the implementation
 *  only consults the HEADs the spec's Given clauses set up. */
function headShaFor(map: Record<string, string>): Mock {
  return vi.fn().mockImplementation((branch: string) => {
    if (!(branch in map)) {
      throw new Error(`unexpected headSha call: ${branch}`);
    }
    return map[branch];
  });
}

/** A `branchExists` double for the merged-pending-pull scenarios: the
 *  spec/test/build branches all exist (the task has run through every
 *  phase), `build/{ref}` exists on origin (the merged PR landed there) and
 *  locally iff `localBuildExists` (the §3.1-vs-§3.2 distinction), and every
 *  other branch is absent. */
function branchExistsFor(ref: string, localBuildExists: boolean): Mock {
  return vi.fn().mockImplementation((name: string, opts?: { remote?: boolean }) => {
    if (name === `build/${ref}`) {
      return opts?.remote === true || localBuildExists;
    }
    return name === `spec/${ref}` || name === `test/${ref}`;
  });
}

/** The test/{ref} HEAD the merged Build Gate PR's `headRefOid` records —
 *  shared by every scenario so the ordinary-merge comparison matches. */
const TEST_HEAD = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

/** §3.2's local-vs-origin build HEADs — deliberately different, since local
 *  `build/{ref}` is behind `origin/build/{ref}` (the merged content has not
 *  been pulled locally yet). */
const LOCAL_BUILD_HEAD = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const ORIGIN_BUILD_HEAD = "cccccccccccccccccccccccccccccccccccccccc";

/** A fully-shaped `MergedPullRequestSummary` (gh.ts §4.9) recording
 *  `headRefOid` == the test branch's current HEAD (the ordinary-merge case
 *  this chunk's `merged-pending-pull` resolution operates on). */
function mergedBuildGatePR(): MergedPullRequestSummary {
  return {
    number: 42,
    url: "https://github.com/weaver-engineering/magpie-weaver/pull/42",
    mergedAt: "2026-08-01T00:00:00Z",
    headRefOid: TEST_HEAD,
    mergeCommitOid: "2222222222222222222222222222222222222222",
  };
}

/** The suite's `ExternalTools` fixtures plus the individual test doubles. */
interface PullSet {
  tools: ExternalTools;
  mocks: {
    fetch: Mock;
    currentBranch: Mock;
    branchExists: Mock;
    headSha: Mock;
    hasCommitsBeyond: Mock;
    headCommitTitle: Mock;
    isAncestor: Mock;
    findMergedPR: Mock;
    findOpenPR: Mock;
    gateRun: Mock;
    pullFastForward: Mock;
    rebase: Mock;
    push: Mock;
    checkout: Mock;
    createBranch: Mock;
  };
}

/**
 * Builds a full `ExternalTools` test double for the `merged-pending-pull`
 * resolution paths. Defaults encode the §3.2 cascading scenario for `ref`:
 * the Build Gate PR (`build/{ref}` <- `test/{ref}`) merged ordinarily
 * (`headRefOid` matches `origin/test/{ref}`), local `build/{ref}` exists
 * and trails `origin/build/{ref}` (so the derivation reports
 * `merged-pending-pull`), and the caller sits on the canonical
 * `build/{ref}` branch (LLD §3.4's `branchMismatch` guard passes). The
 * three mutating primitives under test (`pullFastForward`/`rebase`/`push`)
 * are resolving doubles by default; scenarios that must not reach one pass
 * `unexpected(...)` as the override, enforcing refusal structurally.
 * `git.rebase` resolves `{status: "ok"}` unless overridden. `checkout`/
 * `createBranch`/`createRemoteBranch`/`commitAll`/`isDirty`/`deleteBranch`/
 * `mergeBase`/`changedFiles` are throw-mocks — no scenario forks, restores,
 * or commits. `gateChecks.run` is a throw-mock: `resolveReady` passes
 * `merged-pending-pull` straight through (it only resolves `ready?`), so a
 * plain resolve never consults the gate.
 */
function buildTools(
  ref: string,
  overrides: {
    localBuildExists?: boolean;
    branchExists?: Mock;
    headSha?: Mock;
    currentBranch?: Mock;
    rebase?: Mock;
    pullFastForward?: Mock;
    push?: Mock;
  } = {},
): PullSet {
  const localBuildExists = overrides.localBuildExists ?? true;
  const fetch = vi.fn().mockResolvedValue(undefined);
  const currentBranch = overrides.currentBranch ?? vi.fn().mockResolvedValue(`build/${ref}`);
  const branchExists = overrides.branchExists ?? branchExistsFor(ref, localBuildExists);
  const headSha =
    overrides.headSha ??
    headShaFor({
      [`origin/test/${ref}`]: TEST_HEAD,
      ...(localBuildExists
        ? {
            [`build/${ref}`]: LOCAL_BUILD_HEAD,
            [`origin/build/${ref}`]: ORIGIN_BUILD_HEAD,
          }
        : {}),
    });
  const hasCommitsBeyond = vi.fn().mockResolvedValue(false);
  const headCommitTitle = vi.fn().mockResolvedValue("");
  // MAG-49 correction: the derivation resolves local-vs-origin direction via
  // `isAncestor`, not a plain `headSha` comparison (see repo-state.ts). This
  // fixture's local build/{ref} is meant to represent "behind origin" (per
  // this file's own header comment) whenever it exists at all, so only
  // isAncestor(build/{ref}, origin/build/{ref}) — local is an ancestor of
  // origin — resolves true; the reverse direction (which would misroute
  // this into the ordinary ready?/ahead derivation instead of
  // merged-pending-pull) resolves false.
  const isAncestor = vi.fn().mockImplementation(
    (ancestor: string, descendant: string) =>
      localBuildExists && ancestor === `build/${ref}` && descendant === `origin/build/${ref}`,
  );
  const findMergedPR = vi.fn().mockImplementation((base: string, head: string) =>
    base === `build/${ref}` && head === `test/${ref}` ? mergedBuildGatePR() : null,
  );
  const findMergedPRs = vi.fn().mockResolvedValue([]);
  const findOpenPR = vi.fn().mockResolvedValue(null);
  const gateRun = unexpected("gateChecks.run");

  const pullFastForward = overrides.pullFastForward ?? vi.fn().mockResolvedValue(undefined);
  const rebase = overrides.rebase ?? vi.fn().mockResolvedValue({ status: "ok" });
  const push = overrides.push ?? vi.fn().mockResolvedValue(undefined);
  const checkout = unexpected("checkout");
  const createBranch = unexpected("createBranch");

  const tools = {
    git: {
      fetch,
      currentBranch,
      branchExists,
      headSha,
      mergeBase: unexpected("mergeBase"),
      hasCommitsBeyond,
      headCommitTitle,
      isDirty: unexpected("isDirty"),
      isAncestor,
      createBranch,
      checkout,
      commitAll: unexpected("commitAll"),
      push,
      pullFastForward,
      rebase,
      deleteBranch: unexpected("deleteBranch"),
      createRemoteBranch: unexpected("createRemoteBranch"),
    },
    github: {
      createPR: unexpected("createPR"),
      findMergedPRs,
      findMergedPR,
      findOpenPR,
    },
    gateChecks: {
      run: gateRun,
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
      headSha,
      hasCommitsBeyond,
      headCommitTitle,
      isAncestor,
      findMergedPR,
      findOpenPR,
      gateRun,
      pullFastForward,
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

/** Replaces `process.stdin` with a fake `Readable` that pushes `answer`
 *  (the test's canned confirmation reply — a single line like `"y\n"` or
 *  the empty string for no input) and then ends — the exact mirror of
 *  `captureStdout()`, pointed the other direction (spec 14 §2.1). Returns
 *  a restore function. */
function stubStdin(answer: string): () => void {
  const original = process.stdin;
  const fake = new Readable({ read() {} });
  fake.push(answer);
  fake.push(null);
  Object.defineProperty(process, "stdin", {
    value: fake,
    configurable: true,
    writable: true,
  });
  return () => {
    Object.defineProperty(process, "stdin", {
      value: original,
      configurable: true,
      writable: true,
    });
  };
}

/** The `result` shape serialised under the `--json` doc for a promote run —
 *  the base `TaskPhasingCommandResult` fields plus `action` and
 *  `rebaseOutcome` (set when the action is `"pulled-and-rebased"`). */
interface JsonPromoteResult {
  action: string;
  messages: string[];
  violation?: string;
  success: boolean;
  rebaseOutcome?: RebaseOutcome;
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

/** Runs an in-process `promote --json` invocation to completion, with the
 *  given extra CLI flags (e.g. `--confirm-rebase`) appended afterward. */
async function runPromote(
  tools: ExternalTools,
  extraFlags: string[] = [],
): Promise<{ code: number; doc: { command: string; result: JsonPromoteResult; success: boolean } }> {
  const cap = captureStdout();
  const code = await run(["node", "cli.js", "promote", "--json", ...extraFlags], tools);
  const stdout = cap.stdout();
  cap.restore();
  return { code, doc: parseJson(stdout) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("promote: merged-pending-pull with no local build/{ref} — plain fast-forward, no confirmation (§3.1)", () => {
  it("fast-forwards build/AAA-123 and reports action pulled, without rebasing or requiring confirmation", async () => {
    const { tools, mocks } = buildTools("AAA-123", {
      localBuildExists: false,
      rebase: unexpected("git.rebase"),
      push: unexpected("git.push"),
    });
    const { code, doc } = await runPromote(tools);

    // §2.1: promote consumes the shared derivation — the Build Gate pair
    // was consulted and the headRefOid comparison actually made (ordinary
    // merge, not superseded).
    expect(mocks.findMergedPR).toHaveBeenCalledWith("build/AAA-123", "test/AAA-123");
    expect(mocks.headSha).toHaveBeenCalledWith("origin/test/AAA-123");

    // promote's own plain-vs-cascading decision: no local build/{ref} yet,
    // so there is nothing pre-existing to reorder.
    expect(mocks.branchExists).toHaveBeenCalledWith("build/AAA-123", { remote: false });

    // The fast-forward itself, and nothing else — rebase/push are
    // throw-mocks, so their absence is enforced structurally.
    expect(mocks.pullFastForward).toHaveBeenCalledTimes(1);
    expect(mocks.pullFastForward).toHaveBeenCalledWith("build/AAA-123");
    expect(mocks.rebase).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();

    // No checkout/restoration happens either — the pull is create-only
    // (`git branch <branch> origin/<branch>`), never a worktree switch
    // (checkout is a throw-mock).

    // Result contract: action pulled, success, no --confirm-rebase given
    // and none required, exit 0.
    expect(doc.result.action).toBe("pulled");
    expect(doc.result.success).toBe(true);
    expect(doc.success).toBe(true);
    expect(code).toBe(0);
  });
});

describe("promote: merged-pending-pull with pre-existing build commits — pull + rebase, confirmed (§3.2)", () => {
  it("fast-forwards, then rebases the build commit onto the fresh merge, then force-pushes, reporting pulled-and-rebased", async () => {
    const { tools, mocks } = buildTools("AAA-124");
    const { code, doc } = await runPromote(tools, ["--confirm-rebase"]);

    // The derivation: ordinary merged Build Gate PR, local build/{ref}
    // behind origin/build/{ref} (the local-vs-origin comparison).
    expect(mocks.findMergedPR).toHaveBeenCalledWith("build/AAA-124", "test/AAA-124");
    expect(mocks.headSha).toHaveBeenCalledWith("origin/test/AAA-124");
    expect(mocks.headSha).toHaveBeenCalledWith("build/AAA-124");
    expect(mocks.headSha).toHaveBeenCalledWith("origin/build/AAA-124");

    // pullFastForward then rebase, in that order: the pull brings local
    // build/{ref} up to the merged content, the rebase replays the
    // pre-existing build commit onto that fresh merge (spec 13 §3.3's
    // build-reorder fixture uses the same onto ref).
    expect(mocks.pullFastForward).toHaveBeenCalledTimes(1);
    expect(mocks.pullFastForward).toHaveBeenCalledWith("build/AAA-124");
    expect(mocks.rebase).toHaveBeenCalledWith("build/AAA-124", "origin/build/AAA-124");
    const pullOrder = mocks.pullFastForward.mock.invocationCallOrder[0];
    const rebaseOrder = mocks.rebase.mock.invocationCallOrder[0];
    expect(rebaseOrder).toBeGreaterThan(pullOrder);

    // The rebase rewrote build/{ref}, so the push afterward needs force.
    expect(mocks.push).toHaveBeenCalledWith("build/AAA-124", { force: true });
    const pushOrder = mocks.push.mock.invocationCallOrder[0];
    expect(pushOrder).toBeGreaterThan(rebaseOrder);

    // Result contract: action pulled-and-rebased, rebaseOutcome ok, exit 0.
    expect(doc.result.action).toBe("pulled-and-rebased");
    expect(doc.result.rebaseOutcome).toEqual({ status: "ok" });
    expect(doc.result.success).toBe(true);
    expect(doc.success).toBe(true);
    expect(code).toBe(0);
  });
});

describe("promote: missing confirmation refuses in --json mode (§3.3)", () => {
  it("takes no git action at all and states that --confirm-rebase must be supplied", async () => {
    const { tools, mocks } = buildTools("AAA-124", {
      pullFastForward: unexpected("git.pullFastForward"),
      rebase: unexpected("git.rebase"),
      push: unexpected("git.push"),
    });
    const { code, doc } = await runPromote(tools);

    // No git mutation of any kind — the refusal is evaluated before the
    // cascading action even begins its pull (pullFastForward/rebase/push
    // are throw-mocks, so any call would fail the test loudly).
    expect(mocks.pullFastForward).not.toHaveBeenCalled();
    expect(mocks.rebase).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();

    // A message states a rebase is required and --confirm-rebase must be
    // supplied — the exact flag is named, not a generic failure.
    const joined = doc.result.messages.join("\n");
    expect(joined).toContain("--confirm-rebase");

    // Refusal contract: action none, exit 1 (this invocation did not
    // deliver the requested promotion).
    expect(doc.result.action).toBe("none");
    expect(doc.result.success).toBe(false);
    expect(code).toBe(1);
  });
});

describe("promote: rebase conflict is surfaced, not silently resolved (§3.4)", () => {
  it("does not push, keeps action pulled-and-rebased, and tells the agent the merged test content takes precedence", async () => {
    const rebase = vi.fn().mockResolvedValue({
      status: "conflict",
      details: "conflict on packages/task-phases/src/commands/promote.ts",
    });
    const { tools, mocks } = buildTools("AAA-124", {
      rebase,
      push: unexpected("git.push"),
    });
    const { code, doc } = await runPromote(tools, ["--confirm-rebase"]);

    // The pull half completed; the rebase half reported the conflict.
    expect(mocks.pullFastForward).toHaveBeenCalledTimes(1);
    expect(mocks.rebase).toHaveBeenCalledWith("build/AAA-124", "origin/build/AAA-124");

    // No force-push of a conflicted rewrite (push is a throw-mock).
    expect(mocks.push).not.toHaveBeenCalled();

    // The reported message states the newly-merged test content takes
    // precedence and the agent must adjust their build WIP to match it.
    const joined = doc.result.messages.join("\n");
    expect(joined).toContain("precedence");
    expect(joined).toContain("adjust");

    // The conflict is surfaced via rebaseOutcome, not swallowed; the
    // pull half did complete, so action stays pulled-and-rebased (§3.5's
    // own reasoning); exit 1.
    expect(doc.result.action).toBe("pulled-and-rebased");
    expect(doc.result.rebaseOutcome).toEqual({
      status: "conflict",
      details: "conflict on packages/task-phases/src/commands/promote.ts",
    });
    expect(doc.result.success).toBe(false);
    expect(code).toBe(1);
  });
});

describe("promote: unexpected commit count is surfaced, not silently rewritten (§3.5)", () => {
  it("does not push, but still reports action pulled-and-rebased with the outcome surfaced via rebaseOutcome", async () => {
    const rebase = vi.fn().mockResolvedValue({
      status: "unexpected-commit-count",
      expected: 1,
      actual: 2,
      details: "build/AAA-124 has 2 commits of its own, expected 1",
    });
    const { tools, mocks } = buildTools("AAA-124", {
      rebase,
      push: unexpected("git.push"),
    });
    const { code, doc } = await runPromote(tools, ["--confirm-rebase"]);

    expect(mocks.pullFastForward).toHaveBeenCalledTimes(1);
    expect(mocks.rebase).toHaveBeenCalledWith("build/AAA-124", "origin/build/AAA-124");

    // No push of an unverified rewrite (push is a throw-mock).
    expect(mocks.push).not.toHaveBeenCalled();

    // The pull half of this action DID complete; only the rebase half
    // failed, and rebaseOutcome is where that's visible — NOT a reversion
    // to "pulled" or "none" (§3.5's explicit Then clause).
    expect(doc.result.action).toBe("pulled-and-rebased");
    expect(doc.result.rebaseOutcome).toEqual({
      status: "unexpected-commit-count",
      expected: 1,
      actual: 2,
      details: "build/AAA-124 has 2 commits of its own, expected 1",
    });
    expect(doc.result.success).toBe(false);
    expect(code).toBe(1);
  });
});

describe("promote: interactive y/N prompt gates the cascading rebase+push (§3.6)", () => {
  /** Runs a non-`--json` `promote` invocation with the given canned stdin
   *  answer, capturing both the CLI's exit code/stdout and the
   *  `PromoteCommandResult` the dispatched handler returned (non-json mode
   *  has no structured output to parse it from, so the result is captured
   *  by spying on the command registry entry `run()` dispatches through —
   *  the same `promote` handler, wrapped, not replaced). */
  async function runInteractive(
    tools: ExternalTools,
    answer: string,
  ): Promise<{ code: number; stdout: string; result: PromoteCommandResult | undefined }> {
    const restoreStdin = stubStdin(answer);
    let result: PromoteCommandResult | undefined;
    const spy = vi.spyOn(commandRegistry, "promote").mockImplementation(async (t, a) => {
      const r = await realPromote(t, a);
      result = r;
      return r;
    });
    const cap = captureStdout();
    const code = await run(["node", "cli.js", "promote"], tools);
    const stdout = cap.stdout();
    cap.restore();
    restoreStdin();
    spy.mockRestore();
    return { code, stdout, result };
  }

  it("shows a y/N prompt and proceeds with the rebase and push when the answer is y", async () => {
    const { tools, mocks } = buildTools("AAA-124");
    const { code, stdout, result } = await runInteractive(tools, "y\n");

    // A y/N prompt is shown before any rebase/push is attempted.
    expect(stdout).toMatch(/y\/n/i);

    // The rebase and push proceed only after the y answer, identically to
    // §3.2's --confirm-rebase path (same order: rebase, then force-push).
    expect(mocks.rebase).toHaveBeenCalledWith("build/AAA-124", "origin/build/AAA-124");
    expect(mocks.push).toHaveBeenCalledWith("build/AAA-124", { force: true });
    const rebaseOrder = mocks.rebase.mock.invocationCallOrder[0];
    const pushOrder = mocks.push.mock.invocationCallOrder[0];
    expect(pushOrder).toBeGreaterThan(rebaseOrder);

    expect(result?.action).toBe("pulled-and-rebased");
    expect(result?.success).toBe(true);
    expect(code).toBe(0);
  });

  it("refuses — no rebase or push — when the answer is n", async () => {
    const { tools, mocks } = buildTools("AAA-124", {
      rebase: unexpected("git.rebase"),
      push: unexpected("git.push"),
    });
    const { code, stdout, result } = await runInteractive(tools, "n\n");

    // The prompt is still shown — it precedes the read, not the answer.
    expect(stdout).toMatch(/y\/n/i);

    expect(mocks.rebase).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();

    expect(result?.action).toBe("none");
    expect(result?.success).toBe(false);
    expect(code).toBe(1);
  });

  it("refuses — no rebase or push — when no input is provided", async () => {
    const { tools, mocks } = buildTools("AAA-124", {
      rebase: unexpected("git.rebase"),
      push: unexpected("git.push"),
    });
    const { code, stdout, result } = await runInteractive(tools, "");

    expect(stdout).toMatch(/y\/n/i);

    expect(mocks.rebase).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();

    expect(result?.action).toBe("none");
    expect(result?.success).toBe(false);
    expect(code).toBe(1);
  });
});
