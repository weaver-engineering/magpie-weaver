/**
 * Command-level system tests for `pnpm task promote [--json]` performing the
 * final cleanup once the task's Main Gate PR is confirmed merged
 * (task-MAG-46-15-status-merged-pending-cleanup-and-promote-cleaned-up-
 * spec.md, LLD §3.6).
 *
 * Five behaviors under test, kept separate per §3.3–§3.6 (plus §2.1's
 * convergence requirement):
 *   1. `merged-pending-cleanup` (regular route) -> cleanup: checkout `main`,
 *      update local `main` to match `origin/main`, delete `spec/test/build`
 *      branches, NO confirmation required, `action: "cleaned-up"`,
 *      `branchesDeleted` contains all three, exit 0 (§3.3).
 *   2. §2.1 convergence: the interrupted-cleanup retrigger fixture (no PR
 *      found, a surviving branch already an ancestor of `main`) resolves to
 *      the SAME `cleaned-up` action and the same `branchesDeleted` as the
 *      ordinary route — one code path, not two that happen to look similar.
 *   3. Partially-already-deleted branches: `deleteBranch("test/{ref}")` is
 *      still called and tolerates "doesn't exist" as a no-op — cleanup
 *      succeeds with only some of spec/test/build surviving, `action` still
 *      `"cleaned-up"`, exit 0 (§3.4).
 *   4. After cleanup the ref reports `not-initialised` again (§3.5 — a
 *      trailing side-effect verification of the cleanup, so it stays in this
 *      file rather than moving to the status file, per the test-file-layout
 *      doc §4's exception).
 *   5. The quick route deletes only `task/{ref}`: `branchesDeleted` is
 *      exactly `["task/AAA-234"]`, and `deleteBranch` is never called with a
 *      spec/test/build branch that the route never created (§3.6).
 *
 * §2.1 contracts asserted explicitly:
 *   - `promote` consumes the shared `deriveRepoState()` pipeline — it never
 *     re-checks the merged/ancestor conditions itself (the merged Main Gate
 *     PR is consulted via `findMergedPR`, the retrigger via `isAncestor`).
 *   - No `--confirm-rebase` flag (or any prompt) gates this action — nothing
 *     is lost once the merge is confirmed, unlike MAG-46-14's cascading
 *     rewrite.
 *   - `git.isDirty()` is consulted before cleanup proceeds (a Given in every
 *     §3.3/§3.4/§3.6 fixture).
 *   - The cleanup sequence follows LLD §3.6: checkout `main` first, then
 *     update it, then delete the branches.
 *
 * Same in-process pattern as every prior chunk: `run(argv, tools)` is
 * called directly with an injected `ExternalTools` whose `git`/`github`/
 * `gateChecks` members are test doubles — no real git/gh/fs/gate-check
 * anywhere. The derivation fixture mirrors `status/merged-pending-cleanup
 * .test.ts`'s (MAG-46-15): a confirmed-merged Main Gate PR
 * (`main` <- `build/{ref}`) with local `main` not yet caught up (the
 * `isAncestor` confirmation returns `false`), or, for the retrigger, no PR
 * at all with a surviving branch already an ancestor of local `main`. The
 * caller sits on the derived phase's canonical branch (`build/{ref}`, or
 * `task/{ref}` on the quick route) so LLD §3.4's `branchMismatch` guard
 * passes. Mutating git methods a scenario must NOT reach (`push`/`rebase`/
 * `createBranch`/`createRemoteBranch`/`commitAll` everywhere) are
 * throw-mocks, so "no action" is enforced structurally, not merely
 * asserted. `isDirty` resolves `false`; the mutating primitives under test
 * (`checkout`/`pullFastForward`/`deleteBranch`) are resolving doubles.
 *
 * Every one of these tests fails against the pre-implementation codebase:
 * `promote` currently only implements the fork, rebase-forward, pr-raised,
 * awaiting-pr no-op, blocked-relay, and merged-pending-pull paths
 * (commands/promote.ts); a `merged-pending-cleanup` derivation falls
 * through to `new Error("not implemented")`. None of the scenarios can
 * produce `action: "cleaned-up"` — or the branch deletions it entails —
 * yet. §3.5 additionally fails because the post-cleanup `status` read has
 * no real cleanup having happened to leave no branches behind.
 */

// Implements: task-MAG-46-15-status-merged-pending-cleanup-and-promote-cleaned-up-spec.md
// System behaviors: 5.11 (merged-pending-cleanup -> cleaned-up, incl.
//   interrupted-cleanup retrigger and both routes)
// Spec sections: §3.3 (cleanup, no confirmation required), §2.1 (convergence
//   with the retrigger fixture), §3.4 (partially-already-deleted branches),
//   §3.5 (ref reports not-initialised after cleanup), §3.6 (quick route
//   deletes only task/{ref})

import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { run } from "../../../../packages/task-phases/src/cli.js";
import type {
  ExternalTools,
  MergedPullRequestSummary,
} from "../../../../packages/task-phases/src/types.js";

/** A mock that fails the test loudly if the command under test calls a tool
 *  method that must not be touched on the path being exercised. */
function unexpected(method: string): Mock {
  return vi.fn().mockImplementation(() => {
    throw new Error(`unexpected call: ${method}`);
  });
}

/** A `branchExists` double reporting exactly the given branches as existing
 *  — both the plain and `{ remote: true }` forms resolve identically. */
function existsOnly(...branches: string[]): Mock {
  return vi.fn().mockImplementation((name: string) => branches.includes(name));
}

/** A `findMergedPR` double that reports the given merged PR summary for
 *  exactly one base/head pair and `null` for every other pair. */
function mergedPRFor(
  pair: readonly [base: string, head: string],
  summary: MergedPullRequestSummary,
): Mock {
  return vi.fn().mockImplementation((base: string, head: string) =>
    base === pair[0] && head === pair[1] ? summary : null,
  );
}

/** A fully-shaped `MergedPullRequestSummary` (gh.ts §4.9) for the Main Gate
 *  pair `main` <- `build/{ref}` (or `main` <- `task/{ref}`). */
function mergedMainGatePR(): MergedPullRequestSummary {
  return {
    number: 42,
    url: "https://github.com/weaver-engineering/magpie-weaver/pull/42",
    mergedAt: "2026-08-01T00:00:00Z",
    headRefOid: "3333333333333333333333333333333333333333",
    mergeCommitOid: "4444444444444444444444444444444444444444",
  };
}

/** The suite's `ExternalTools` fixtures plus the individual test doubles. */
interface CleanupSet {
  tools: ExternalTools;
  mocks: {
    fetch: Mock;
    currentBranch: Mock;
    branchExists: Mock;
    isAncestor: Mock;
    isDirty: Mock;
    findMergedPR: Mock;
    findOpenPR: Mock;
    checkout: Mock;
    pullFastForward: Mock;
    deleteBranch: Mock;
    gateRun: Mock;
  };
}

/**
 * Builds a full `ExternalTools` test double for the `cleaned-up` action
 * paths. Defaults encode §3.3's regular-route scenario for `ref`: the Main
 * Gate PR (`main` <- `build/{ref}`) is confirmed merged, local `main` has
 * not caught up (`isAncestor` false — the derivation lands on
 * `merged-pending-cleanup`), the spec/test/build branches all survive, the
 * caller sits on the canonical `build/{ref}` (LLD §3.4's `branchMismatch`
 * guard passes), and `isDirty` reports `false`. The three mutating
 * primitives under test (`checkout`/`pullFastForward`/`deleteBranch`) are
 * resolving doubles; `isDirty` is a resolving `false`; every other mutating
 * git method is a throw-mock — `push`/`rebase`/`createBranch`/
 * `createRemoteBranch`/`commitAll` must never be touched by a cleanup, and
 * `gateChecks.run` must not run (`resolveReady` passes
 * `merged-pending-cleanup` straight through — it only resolves `ready?`).
 * `branchExists`/`findMergedPR`/`isAncestor`/`currentBranch` are
 * scenario-specific and therefore overridable.
 */
function buildTools(
  ref: string,
  overrides: {
    currentBranch?: Mock;
    branchExists?: Mock;
    findMergedPR?: Mock;
    isAncestor?: Mock;
    isDirty?: Mock;
    checkout?: Mock;
    pullFastForward?: Mock;
    deleteBranch?: Mock;
  } = {},
): CleanupSet {
  const fetch = vi.fn().mockResolvedValue(undefined);
  const currentBranch = overrides.currentBranch ?? vi.fn().mockResolvedValue(`build/${ref}`);
  const branchExists =
    overrides.branchExists ?? existsOnly(`spec/${ref}`, `test/${ref}`, `build/${ref}`);
  const isAncestor = overrides.isAncestor ?? vi.fn().mockResolvedValue(false);
  const isDirty = overrides.isDirty ?? vi.fn().mockResolvedValue(false);
  const findMergedPR =
    overrides.findMergedPR ?? mergedPRFor(["main", `build/${ref}`], mergedMainGatePR());
  const findMergedPRs = vi.fn().mockResolvedValue([]);
  const findOpenPR = vi.fn().mockResolvedValue(null);
  const gateRun = unexpected("gateChecks.run");
  const checkout = overrides.checkout ?? vi.fn().mockResolvedValue(undefined);
  const pullFastForward = overrides.pullFastForward ?? vi.fn().mockResolvedValue(undefined);
  const deleteBranch = overrides.deleteBranch ?? vi.fn().mockResolvedValue(undefined);

  const tools = {
    git: {
      fetch,
      currentBranch,
      branchExists,
      headSha: unexpected("headSha"),
      mergeBase: unexpected("mergeBase"),
      hasCommitsBeyond: vi.fn().mockResolvedValue(false),
      headCommitTitle: vi.fn().mockResolvedValue(""),
      isDirty,
      isAncestor,
      createBranch: unexpected("createBranch"),
      checkout,
      commitAll: unexpected("commitAll"),
      push: unexpected("push"),
      pullFastForward,
      rebase: unexpected("rebase"),
      deleteBranch,
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
      isAncestor,
      isDirty,
      findMergedPR,
      findOpenPR,
      checkout,
      pullFastForward,
      deleteBranch,
      gateRun,
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

/** The `result` shape serialised under the `--json` doc for a promote run —
 *  the base `TaskPhasingCommandResult` fields plus `action` and
 *  `branchesDeleted` (set when the action is `"cleaned-up"`). */
interface JsonPromoteResult {
  action: string;
  messages: string[];
  violation?: string;
  success: boolean;
  branchesDeleted?: string[];
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

/** Runs an in-process `promote --json` invocation to completion. No extra
 *  flags by default — the cleanup action must proceed with no
 *  `--confirm-rebase` (spec 15 §2.1's explicit difference from MAG-46-14). */
async function runPromote(
  tools: ExternalTools,
): Promise<{ code: number; doc: { command: string; result: JsonPromoteResult; success: boolean } }> {
  const cap = captureStdout();
  const code = await run(["node", "cli.js", "promote", "--json"], tools);
  const stdout = cap.stdout();
  cap.restore();
  return { code, doc: parseJson(stdout) };
}

/** Runs an in-process `status` invocation to completion (used by §3.5's
 *  post-cleanup check). */
async function runStatus(
  tail: string[],
  tools: ExternalTools,
): Promise<{ code: number; stdout: string }> {
  const cap = captureStdout();
  const code = await run(["node", "cli.js", ...tail], tools);
  const stdout = cap.stdout();
  cap.restore();
  return { code, stdout };
}

afterEach(() => {
  vi.restoreAllMocks();
});

/** The regular route's full cleanup branch set — every phase branch the
 *  workflow ever created, in the order the §3.3 Then clause names them. */
const REGULAR_ROUTE_BRANCHES = (ref: string): string[] => [
  `spec/${ref}`,
  `test/${ref}`,
  `build/${ref}`,
];

describe("promote: merged Main Gate PR merged — cleanup with no confirmation required (§3.3)", () => {
  it("checks out main, updates it, deletes all three phase branches, and reports cleaned-up without --confirm-rebase", async () => {
    const { tools, mocks } = buildTools("AAA-123");
    const { code, doc } = await runPromote(tools);

    // §2.1: promote consumes the shared derivation — the Main Gate pair was
    // consulted and the "main hasn't caught up" confirmation made.
    expect(mocks.findMergedPR).toHaveBeenCalledWith("main", "build/AAA-123");
    expect(mocks.isAncestor).toHaveBeenCalled();
    expect(mocks.isAncestor).toHaveBeenCalledWith(expect.any(String), "main");

    // The worktree is clean before the branch deletions proceed (a Given in
    // the §3.3 fixture).
    expect(mocks.isDirty).toHaveBeenCalled();

    // LLD §3.6's sequence: checkout main first, then update local main to
    // match origin/main (the fast-forward primitive), then delete branches.
    expect(mocks.checkout).toHaveBeenCalledWith("main");
    expect(mocks.pullFastForward).toHaveBeenCalledWith("main");
    const checkoutOrder = mocks.checkout.mock.invocationCallOrder[0];
    const updateOrder = mocks.pullFastForward.mock.invocationCallOrder[0];
    expect(updateOrder).toBeGreaterThan(checkoutOrder);

    expect(mocks.deleteBranch).toHaveBeenCalledWith("spec/AAA-123");
    expect(mocks.deleteBranch).toHaveBeenCalledWith("test/AAA-123");
    expect(mocks.deleteBranch).toHaveBeenCalledWith("build/AAA-123");
    const deleteOrder = mocks.deleteBranch.mock.invocationCallOrder[0];
    expect(deleteOrder).toBeGreaterThan(updateOrder);

    // Nothing else mutates — push/rebase/createBranch/createRemoteBranch/
    // commitAll are throw-mocks, so reaching any would fail this test.
    expect(mocks.gateRun).not.toHaveBeenCalled();

    // Result contract: action cleaned-up, branchesDeleted carries all three,
    // success, exit 0 — with no --confirm-rebase flag given and none required.
    expect(doc.result.action).toBe("cleaned-up");
    expect(doc.result.branchesDeleted).toEqual(
      expect.arrayContaining(REGULAR_ROUTE_BRANCHES("AAA-123")),
    );
    expect(doc.result.success).toBe(true);
    expect(doc.success).toBe(true);
    expect(code).toBe(0);
  });
});

describe("promote: interrupted-cleanup retrigger converges on the identical cleaned-up result (§2.1)", () => {
  it("resolves the no-PR retrigger fixture to the same cleaned-up action and branchesDeleted as §3.3", async () => {
    // The retrigger fixture: no merged/open Main Gate PR is found, but the
    // surviving `test/AAA-125` branch is already an ancestor of local main —
    // the derivation converges on the SAME merged-pending-cleanup state, and
    // promote must run the SAME cleaned-up action (one code path, not two
    // that happen to look similar).
    const { tools, mocks } = buildTools("AAA-125", {
      branchExists: existsOnly("test/AAA-125", "build/AAA-125"),
      findMergedPR: vi.fn().mockResolvedValue(null),
      isAncestor: vi.fn().mockImplementation((a: string, b: string) =>
        a === "test/AAA-125" && b === "main",
      ),
    });
    const { code, doc } = await runPromote(tools);

    // §2.1: the ancestry retrigger is what drives the derivation — not a
    // second, separate cleanup code path.
    expect(mocks.findMergedPR).toHaveBeenCalledWith("main", "build/AAA-125");
    expect(mocks.isAncestor).toHaveBeenCalledWith("test/AAA-125", "main");

    expect(mocks.isDirty).toHaveBeenCalled();
    expect(mocks.checkout).toHaveBeenCalledWith("main");
    expect(mocks.pullFastForward).toHaveBeenCalledWith("main");

    // Identical to §3.3: the full regular-route branch set is deleted —
    // deleteBranch is called for every branch in the set, surviving or not
    // (its real implementation tolerates "doesn't exist" as a no-op).
    expect(mocks.deleteBranch).toHaveBeenCalledWith("spec/AAA-125");
    expect(mocks.deleteBranch).toHaveBeenCalledWith("test/AAA-125");
    expect(mocks.deleteBranch).toHaveBeenCalledWith("build/AAA-125");

    expect(doc.result.action).toBe("cleaned-up");
    expect(doc.result.branchesDeleted).toEqual(REGULAR_ROUTE_BRANCHES("AAA-125"));
    expect(doc.result.success).toBe(true);
    expect(doc.success).toBe(true);
    expect(code).toBe(0);
  });
});

describe("promote: cleanup tolerates partially-already-deleted branches (§3.4)", () => {
  it("still calls deleteBranch for the already-deleted test branch, no-ops, and reports cleaned-up", async () => {
    // As §3.3, except `test/AAA-124` was already deleted in a prior,
    // interrupted cleanup attempt — only spec and build survive.
    const { tools, mocks } = buildTools("AAA-124", {
      branchExists: existsOnly("spec/AAA-124", "build/AAA-124"),
    });
    const { code, doc } = await runPromote(tools);

    // deleteBranch is called for the full branch set regardless of
    // existence — the real primitive tolerates "doesn't exist" as a no-op,
    // which is exactly what re-running a partially-finished cleanup needs.
    expect(mocks.deleteBranch).toHaveBeenCalledWith("spec/AAA-124");
    expect(mocks.deleteBranch).toHaveBeenCalledWith("test/AAA-124");
    expect(mocks.deleteBranch).toHaveBeenCalledWith("build/AAA-124");

    expect(mocks.checkout).toHaveBeenCalledWith("main");
    expect(mocks.pullFastForward).toHaveBeenCalledWith("main");

    // The missing branch is a no-op, not an error: still cleaned-up, exit 0.
    expect(doc.result.action).toBe("cleaned-up");
    expect(doc.result.branchesDeleted).toEqual(REGULAR_ROUTE_BRANCHES("AAA-124"));
    expect(doc.result.success).toBe(true);
    expect(doc.success).toBe(true);
    expect(code).toBe(0);
  });
});

describe("promote: ref reports not-initialised after cleanup (§3.5)", () => {
  it("status --ref reports not-initialised once no phase branch remains", async () => {
    // The post-cleanup state: every phase branch is gone (cleanup deleted
    // them), so the ref is not-initialised again. findMergedPR/findOpenPR
    // are throw-mocks — with no branch of any kind there is nothing to
    // check a PR for, so the derivation must not reach github at all.
    const fetch = vi.fn().mockResolvedValue(undefined);
    const currentBranch = vi.fn().mockResolvedValue("main");
    const branchExists = vi.fn().mockResolvedValue(false);
    const tools = {
      git: {
        fetch,
        currentBranch,
        branchExists,
        headSha: unexpected("headSha"),
        mergeBase: unexpected("mergeBase"),
        hasCommitsBeyond: unexpected("hasCommitsBeyond"),
        headCommitTitle: unexpected("headCommitTitle"),
        isDirty: unexpected("isDirty"),
        isAncestor: unexpected("isAncestor"),
        createBranch: unexpected("createBranch"),
        checkout: unexpected("checkout"),
        commitAll: unexpected("commitAll"),
        push: unexpected("push"),
        pullFastForward: unexpected("pullFastForward"),
        rebase: unexpected("rebase"),
        deleteBranch: unexpected("deleteBranch"),
        createRemoteBranch: unexpected("createRemoteBranch"),
      },
      github: {
        createPR: unexpected("createPR"),
        findMergedPRs: unexpected("findMergedPRs"),
        findMergedPR: unexpected("findMergedPR"),
        findOpenPR: unexpected("findOpenPR"),
      },
      gateChecks: {
        run: unexpected("gateChecks.run"),
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

    const { code, stdout } = await runStatus(["status", "--ref", "AAA-123", "--json"], tools);

    expect(code).toBe(0);
    expect(stdout).toContain("Task::Phase::State AAA-123::-::not-initialised");

    const lines = stdout.trim().split("\n");
    const doc = JSON.parse(lines[lines.length - 1]) as {
      success: boolean;
      result: { taskStatus: { phase: string | null; state: string } };
    };
    expect(doc.success).toBe(true);
    expect(doc.result.taskStatus.phase).toBeNull();
    expect(doc.result.taskStatus.state).toBe("not-initialised");

    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("promote: quick route cleanup deletes only task/{ref} (§3.6)", () => {
  it("checks out main, updates it, deletes exactly task/AAA-234, and reports cleaned-up with branchesDeleted exactly [task/AAA-234]", async () => {
    const { tools, mocks } = buildTools("AAA-234", {
      currentBranch: vi.fn().mockResolvedValue("task/AAA-234"),
      branchExists: existsOnly("task/AAA-234"),
      findMergedPR: mergedPRFor(["main", "task/AAA-234"], mergedMainGatePR()),
    });
    const { code, doc } = await runPromote(tools);

    // §2.1: the quick route's Main Gate pair (main <- task/{ref}) was
    // consulted — the derivation reports phase quick / merged-pending-cleanup.
    expect(mocks.findMergedPR).toHaveBeenCalledWith("main", "task/AAA-234");
    expect(mocks.isAncestor).toHaveBeenCalledWith(expect.any(String), "main");

    expect(mocks.isDirty).toHaveBeenCalled();
    expect(mocks.checkout).toHaveBeenCalledWith("main");
    expect(mocks.pullFastForward).toHaveBeenCalledWith("main");

    // Only task/AAA-234 ever existed on the quick route — nothing else is
    // deleted.
    expect(mocks.deleteBranch).toHaveBeenCalledTimes(1);
    expect(mocks.deleteBranch).toHaveBeenCalledWith("task/AAA-234");
    expect(mocks.deleteBranch).not.toHaveBeenCalledWith("spec/AAA-234");
    expect(mocks.deleteBranch).not.toHaveBeenCalledWith("test/AAA-234");
    expect(mocks.deleteBranch).not.toHaveBeenCalledWith("build/AAA-234");

    expect(doc.result.action).toBe("cleaned-up");
    expect(doc.result.branchesDeleted).toEqual(["task/AAA-234"]);
    expect(doc.result.success).toBe(true);
    expect(doc.success).toBe(true);
    expect(code).toBe(0);
  });
});
