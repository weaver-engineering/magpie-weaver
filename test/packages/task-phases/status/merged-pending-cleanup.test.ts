/**
 * Command-level system tests for `pnpm task status [--ref <ref>]` deriving
 * `phase: "build" (regular route), state: "merged-pending-cleanup"` once the
 * Main Gate PR is confirmed merged and local `main` hasn't caught up yet
 * (task-MAG-46-15-status-merged-pending-cleanup-and-promote-cleaned-up-
 * spec.md, LLD §3.2).
 *
 * Two behaviors under test, kept separate per §3.1-§3.2:
 *   1. Merged Main Gate PR (`build/{ref}` -> `main`) + local `main`'s HEAD
 *      not yet including the merge (confirmed via `git.isAncestor`) ->
 *      phase `build`, state `merged-pending-cleanup` (§3.1).
 *   2. Interrupted prior cleanup: no merged/open PR found via `github`, a
 *      surviving phase branch (`test/{ref}`) already an ancestor of local
 *      `main` -> the SAME `merged-pending-cleanup` state, not a distinct
 *      "stale"/"broken" state (§3.2).
 *
 * §2.1 contracts asserted explicitly:
 *   - The merged Main Gate PR path confirms "change not in main" via
 *     `git.isAncestor(<merge commit>, "main")` — the PR's merge commit must
 *     NOT already be reachable from local `main` for the state to hold.
 *   - The interrupted-cleanup retrigger is the ancestry check
 *     `git.isAncestor("test/{ref}", "main")` returning `true` — local `main`
 *     already contains the surviving branch's content, so the ref converges
 *     on the identical `merged-pending-cleanup` state rather than regressing
 *     to an earlier stale phase.
 *   - `status` only ever *reports* this state, never resolves it: no
 *     `git.checkout`/`git.pullFastForward`/`git.deleteBranch`/`git.rebase`
 *     call happens anywhere in these scenarios (resolving is
 *     `promote`-only, spec 15 §3.3-§3.6).
 *
 * Same in-process pattern as every prior chunk: `run(argv, tools)` is
 * called directly with an injected `ExternalTools` whose `git`/`github`
 * members are test doubles — no real git/gh/fs/gate-check anywhere. Every
 * mutating tool method is a throw-mock so that "no action taken" is
 * enforced structurally, not merely asserted. `hasCommitsBeyond`/
 * `headCommitTitle` are resolving mocks — never called in either
 * merged-pending-cleanup case (both derivations return before the
 * branch-exists chain is reached).
 *
 * Every one of these tests fails against the pre-implementation codebase:
 * `lib/repo-state.ts`'s `derivePrState` still throws "not implemented" the
 * moment a merged PR is found on a Main Gate pair (spec 06.01's
 * unconditional gate-PR deferral, replaced for these pairs by this chunk
 * per §2.1), so `status` cannot yet report `merged-pending-cleanup` — it
 * exits 1 with "not implemented" instead. The §3.2 retrigger fails too:
 * with no PR, derivation currently falls through to the ordinary branch
 * derivation, which reports the surviving `test/{ref}` branch as phase
 * `test` (its staleness check against the absent `spec/{ref}` falls back to
 * `spec`) — never `build`/`merged-pending-cleanup`.
 */

// Implements: task-MAG-46-15-status-merged-pending-cleanup-and-promote-cleaned-up-spec.md
// System behaviors: 1.5.8 (merged-pending-cleanup, incl. interrupted-cleanup
//   retrigger), 3.10 (report merged-pending-cleanup read-only — no action taken)
// Spec sections: §3.1 (ordinary merged-pending-cleanup detection),
//   §3.2 (interrupted-cleanup retrigger)

import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { run } from "../../../../packages/task-phases/src/cli.js";
import type {
  ExternalTools,
  MergedPullRequestSummary,
  TaskStatus,
} from "../../../../packages/task-phases/src/types.js";

/** A mock that fails the test loudly if the command under test calls a tool
 *  method that must not be touched on the merged-pending-cleanup read path. */
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

/** The commit the merged Main Gate PR recorded as landing on `main` — the
 *  OID the "change not in main" ancestry check is expected to consult. */
const MERGE_COMMIT_OID = "4444444444444444444444444444444444444444";

/** A fully-shaped `MergedPullRequestSummary` (gh.ts §4.9) for the Main Gate
 *  pair `main` <- `build/{ref}` (or `main` <- `task/{ref}`). */
function mergedMainGatePR(): MergedPullRequestSummary {
  return {
    number: 42,
    url: "https://github.com/weaver-engineering/magpie-weaver/pull/42",
    mergedAt: "2026-08-01T00:00:00Z",
    headRefOid: "3333333333333333333333333333333333333333",
    mergeCommitOid: MERGE_COMMIT_OID,
  };
}

interface MockSet {
  tools: ExternalTools;
  mocks: {
    fetch: Mock;
    currentBranch: Mock;
    branchExists: Mock;
    hasCommitsBeyond: Mock;
    headCommitTitle: Mock;
    isAncestor: Mock;
    findMergedPR: Mock;
    findOpenPR: Mock;
    gateRun: Mock;
    pullFastForward: Mock;
    rebase: Mock;
    checkout: Mock;
    deleteBranch: Mock;
  };
}

/**
 * Builds a full `ExternalTools` test double for the merged-pending-cleanup
 * read path. Defaults: the caller sits on `main`, the regular route's
 * spec/test/build branches all exist, `github` finds the merged Main Gate
 * PR (`main` <- `build/{ref}`), and `isAncestor` reports `false` — local
 * `main` has NOT yet caught up with the merge, so derivation lands on
 * `merged-pending-cleanup`. Every mutating git method is a throw-mock,
 * `github.createPR` is a throw-mock, and `gateChecks.run` is a throw-mock —
 * a `status` read must touch none of them. `branchExists`/`isAncestor`/
 * `findMergedPR` are scenario-specific and therefore overridable.
 */
function buildTools(
  ref: string,
  overrides: {
    branchExists?: Mock;
    isAncestor?: Mock;
    findMergedPR?: Mock;
    currentBranch?: Mock;
  } = {},
): MockSet {
  const fetch = vi.fn().mockResolvedValue(undefined);
  const currentBranch = overrides.currentBranch ?? vi.fn().mockResolvedValue("main");
  const branchExists =
    overrides.branchExists ?? existsOnly(`spec/${ref}`, `test/${ref}`, `build/${ref}`);
  const hasCommitsBeyond = vi.fn().mockResolvedValue(false);
  const headCommitTitle = vi.fn().mockResolvedValue("");
  const isAncestor = overrides.isAncestor ?? vi.fn().mockResolvedValue(false);
  const findMergedPR =
    overrides.findMergedPR ?? mergedPRFor(["main", `build/${ref}`], mergedMainGatePR());
  const findMergedPRs = vi.fn().mockResolvedValue([]);
  const findOpenPR = vi.fn().mockResolvedValue(null);
  const gateRun = unexpected("gateChecks.run");
  const pullFastForward = unexpected("git.pullFastForward");
  const rebase = unexpected("git.rebase");
  const checkout = unexpected("git.checkout");
  const deleteBranch = unexpected("git.deleteBranch");

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
      createBranch: unexpected("createBranch"),
      checkout,
      commitAll: unexpected("commitAll"),
      push: unexpected("push"),
      pullFastForward,
      rebase,
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
      hasCommitsBeyond,
      headCommitTitle,
      isAncestor,
      findMergedPR,
      findOpenPR,
      gateRun,
      pullFastForward,
      rebase,
      checkout,
      deleteBranch,
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

/** Runs an in-process `status` invocation to completion. `tail` is
 *  everything after the leading `["node","cli.js"]`. */
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

/** Parses the single JSON document a `--json` status run emits. */
function parseJson(
  stdout: string,
): { success: boolean; result: { taskStatus: TaskStatus } } {
  const lines = stdout.trim().split("\n");
  const doc = JSON.parse(lines[lines.length - 1]) as {
    success: boolean;
    result: { taskStatus: TaskStatus };
  };
  return doc;
}

describe("status: merged Main Gate PR with local main not yet caught up (§3.1)", () => {
  it("derives phase build / state merged-pending-cleanup, confirming main hasn't caught up via isAncestor", async () => {
    const { tools, mocks } = buildTools("AAA-123");
    const { code, stdout } = await runStatus(["status", "--ref", "AAA-123", "--json"], tools);

    // A successfully-derived merged-pending-cleanup read is a successful run.
    expect(code).toBe(0);
    expect(stdout).toContain("Task::Phase::State AAA-123::build::merged-pending-cleanup");

    const json = parseJson(stdout);
    expect(json.success).toBe(true);
    expect(json.result.taskStatus.phase).toBe("build");
    expect(json.result.taskStatus.state).toBe("merged-pending-cleanup");

    // fetch runs unconditionally first (§1.1), and the regular route's Main
    // Gate pair was consulted.
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.findMergedPR).toHaveBeenCalledWith("main", "build/AAA-123");

    // §2.1: "change not in main" is confirmed via git.isAncestor — the merge
    // commit's reachability from local main is actually consulted, not just
    // "a merged PR exists".
    expect(mocks.isAncestor).toHaveBeenCalled();
    expect(mocks.isAncestor).toHaveBeenCalledWith(expect.any(String), "main");

    // PR-driven: the branch-exists derivation (`hasCommitsBeyond`/
    // `headCommitTitle`) is never reached for merged-pending-cleanup, and a
    // plain read never touches gate-check.
    expect(mocks.hasCommitsBeyond).not.toHaveBeenCalled();
    expect(mocks.headCommitTitle).not.toHaveBeenCalled();
    expect(mocks.gateRun).not.toHaveBeenCalled();

    // status only reports; it never resolves (§2.1/§3.1 Then): no
    // checkout/pullFastForward/deleteBranch/rebase (each is a throw-mock —
    // reaching any would have thrown and failed this test).
    expect(mocks.checkout).not.toHaveBeenCalled();
    expect(mocks.pullFastForward).not.toHaveBeenCalled();
    expect(mocks.deleteBranch).not.toHaveBeenCalled();
    expect(mocks.rebase).not.toHaveBeenCalled();
  });
});

describe("status: interrupted prior cleanup — surviving branch already an ancestor of main (§3.2)", () => {
  it("derives the SAME build / merged-pending-cleanup, not a distinct stale or broken state", async () => {
    // No merged/open Main Gate PR is found (the PR-driven stage runs and
    // finds nothing), `test/AAA-124` survives locally, and
    // `git.isAncestor("test/AAA-124", "main")` — the retrigger's ancestry
    // safety net — reports true: local main already contains the branch.
    const { tools, mocks } = buildTools("AAA-124", {
      branchExists: existsOnly("test/AAA-124"),
      findMergedPR: vi.fn().mockResolvedValue(null),
      isAncestor: vi.fn().mockImplementation((a: string, b: string) =>
        a === "test/AAA-124" && b === "main",
      ),
    });
    const { code, stdout } = await runStatus(["status", "--ref", "AAA-124", "--json"], tools);

    expect(code).toBe(0);
    expect(stdout).toContain("Task::Phase::State AAA-124::build::merged-pending-cleanup");

    const json = parseJson(stdout);
    expect(json.success).toBe(true);
    // Identical to §3.1's derivation — same phase, same state.
    expect(json.result.taskStatus.phase).toBe("build");
    expect(json.result.taskStatus.state).toBe("merged-pending-cleanup");

    // The PR-driven stage ran and found no Main Gate PR for this ref...
    expect(mocks.findMergedPR).toHaveBeenCalledWith("main", "build/AAA-124");

    // ...so the interrupted-cleanup retrigger is what drives the state: the
    // surviving branch's ancestry against local main is consulted, exactly
    // as the Given pins.
    expect(mocks.isAncestor).toHaveBeenCalledWith("test/AAA-124", "main");

    // The retrigger returns before the ordinary branch-exists derivation is
    // reached, and a plain read never touches gate-check or resolves.
    expect(mocks.hasCommitsBeyond).not.toHaveBeenCalled();
    expect(mocks.headCommitTitle).not.toHaveBeenCalled();
    expect(mocks.gateRun).not.toHaveBeenCalled();
    expect(mocks.checkout).not.toHaveBeenCalled();
    expect(mocks.pullFastForward).not.toHaveBeenCalled();
    expect(mocks.deleteBranch).not.toHaveBeenCalled();
    expect(mocks.rebase).not.toHaveBeenCalled();
  });
});
