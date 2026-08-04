/**
 * Command-level system tests for `pnpm task status [--ref <ref>]` reporting
 * `phase: "quick", state: "awaiting-pr"` once the Main Gate PR raised on the
 * quick route (`task/{ref}` -> `main`) is open (task-MAG-46-11-01-promote-
 * quick-route-pr-raised-spec.md §3.4, LLD §3.2).
 *
 * MAG-46-11 established `awaiting-pr` for the Build Gate PR pair
 * (`test/{ref}` -> `build/{ref}`), attached to the source phase `test`.
 * MAG-46-11.01 extends that same `deriveRepoState()` awaiting-pr resolution
 * (LLD §4.5) to the quick route's own base/head pair — `main`/`task/{ref}` —
 * so an open Main Gate PR on the quick route derives `awaiting-pr` attached
 * to the **source** phase `quick` (§2.1: one derivation function covering
 * all routes, never the destination `main`).
 *
 * One behavior under test:
 *   1. Finding an open PR for the quick route's Main Gate pair
 *      (`main` <- `task/{ref}`), `status` derives `phase: "quick", state:
 *      "awaiting-pr"` — the source phase of that PR, not the destination.
 *
 * Same in-process pattern as every prior chunk: `run(argv, tools)` is
 * called directly with an injected `ExternalTools` whose `git`/`github`
 * members are test doubles — no real git/gh/fs/gate-check anywhere. Every
 * mutating tool method is a throw-mock so that a `status` read provably
 * touches none of them; `hasCommitsBeyond`/`headCommitTitle` are resolving
 * mocks asserted to be *never* called, proving the awaiting-pr derivation
 * is reached from the PR stage, not the branch-exists chain.
 *
 * This test fails against the pre-implementation codebase:
 * `lib/repo-state.ts`'s `derivePrState` still throws `"not implemented"`
 * the moment an open PR is found on any pair other than the Build Gate pair
 * (the `main`/`task/{ref}` route is still the deferred MAG-46-12/15
 * territory), so `status` cannot yet report `phase: "quick", state:
 * "awaiting-pr"` for the quick route — it exits 1 with "not implemented"
 * instead.
 */

// Implements: task-MAG-46-11-01-promote-quick-route-pr-raised-spec.md
// System behaviors: quick::awaiting-pr for an open main/task/{ref} PR,
//   attached to the source phase quick
// Spec sections: §3.4

import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { run } from "../../../../packages/task-phases/src/cli.js";
import type {
  ExternalTools,
  PullRequestSummary,
  TaskStatus,
} from "../../../../packages/task-phases/src/types.js";

/** A mock that fails the test loudly if the command under test calls a tool
 *  method that must not be touched on the awaiting-pr read path. */
function unexpected(method: string): Mock {
  return vi.fn().mockImplementation(() => {
    throw new Error(`unexpected call: ${method}`);
  });
}

/** A `branchExists` double reporting exactly the given branches as existing
 *  — both the plain and `{ remote: true }` forms resolve identically, since
 *  these scenarios never depend on the local/remote distinction. */
function existsOnly(...branches: string[]): Mock {
  return vi.fn().mockImplementation((name: string) => branches.includes(name));
}

/** The open Main Gate PR (quick route) the spec's §3.4 Given carries. */
const OPEN_PR: PullRequestSummary = {
  number: 52,
  url: "https://github.com/weaver-engineering/magpie-weaver/pull/52",
};

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
  };
}

/**
 * Builds a full `ExternalTools` test double for the quick route's
 * awaiting-pr read path. Defaults: `task/AAA-234` exists (so
 * `anyPhaseBranchExists` passes), the caller sits on `task/AAA-234` (the
 * quick route's canonical branch), no merged PR on any pair, and an open
 * PR on the quick route's Main Gate pair (`main` <- `task/AAA-234`). Every
 * mutating git method is a throw-mock, `github.createPR` is a throw-mock,
 * and `gateChecks.run` is a throw-mock — a `status` read must touch none
 * of them. `hasCommitsBeyond`/`headCommitTitle` are resolving mocks
 * asserted never-called, proving derivation comes from the PR stage.
 */
function buildTools(
  overrides: {
    branchExists?: Mock;
    currentBranch?: Mock;
    findMergedPR?: Mock;
    findOpenPR?: Mock;
  } = {},
): MockSet {
  const fetch = vi.fn().mockResolvedValue(undefined);
  const currentBranch = overrides.currentBranch ?? vi.fn().mockResolvedValue("task/AAA-234");
  const branchExists = overrides.branchExists ?? existsOnly("task/AAA-234");
  const hasCommitsBeyond = vi.fn().mockResolvedValue(true);
  const headCommitTitle = vi.fn().mockResolvedValue("AAA-234: add tests");
  const isAncestor = vi.fn().mockResolvedValue(true);
  const findMergedPR = overrides.findMergedPR ?? vi.fn().mockResolvedValue(null);
  const findMergedPRs = vi.fn().mockResolvedValue([]);
  const findOpenPR =
    overrides.findOpenPR ??
    vi.fn().mockImplementation((base: string, head: string) =>
      base === "main" && head === "task/AAA-234" ? OPEN_PR : null,
    );
  const gateRun = unexpected("gateChecks.run");

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

describe("status: reports awaiting-pr on the quick phase for the open Main Gate PR (§3.4)", () => {
  it("derives phase quick / state awaiting-pr, attached to the source phase, from the PR stage", async () => {
    const { tools, mocks } = buildTools();
    const { code, stdout } = await runStatus(["status", "--ref", "AAA-234", "--json"], tools);

    // A successfully-derived awaiting-pr read is a successful status run.
    expect(code).toBe(0);
    expect(stdout).toContain("Task::Phase::State AAA-234::quick::awaiting-pr");

    // The structured result reports phase "quick" and state "awaiting-pr" —
    // the phase is the SOURCE phase of the open PR (quick), never the
    // destination (main) (§2.1).
    const json = parseJson(stdout);
    expect(json.success).toBe(true);
    expect(json.result.taskStatus.phase).toBe("quick");
    expect(json.result.taskStatus.state).toBe("awaiting-pr");

    // fetch runs unconditionally first (§1.1), and the quick route's Main
    // Gate pair was consulted.
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.findOpenPR).toHaveBeenCalledWith("main", "task/AAA-234");

    // PR-driven: the branch-exists derivation (`hasCommitsBeyond`/
    // `headCommitTitle`) is never reached for awaiting-pr, and a plain read
    // never touches gate-check.
    expect(mocks.hasCommitsBeyond).not.toHaveBeenCalled();
    expect(mocks.headCommitTitle).not.toHaveBeenCalled();
    expect(mocks.gateRun).not.toHaveBeenCalled();
  });
});