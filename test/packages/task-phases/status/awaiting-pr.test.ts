/**
 * Command-level system tests for `pnpm task status [--ref <ref>]` reporting
 * `phase: "test", state: "awaiting-pr"` once the Build Gate PR
 * (`test/{ref}` -> `build/{ref}`) is open (task-MAG-46-11-status-awaiting-
 * pr-and-promote-pr-raised-spec.md, LLD §3.2).
 *
 * Two behaviors under test, kept separate per §2.1:
 *   1. Finding an open PR for the Build Gate pair, `status` derives
 *      `state: "awaiting-pr"` attached to the **source** phase of that PR
 *      — `phase` stays `"test"`, not something derived from the PR's
 *      destination (`build`) (§3.2). This is PR-driven: it happens in the
 *      §3.2 merge-status/open-PR stage, *before* the branch-exists
 *      derivation (`hasCommitsBeyond`/`headCommitTitle` are never
 *      reached), the same stage spec 06.01's deferral used to own.
 *   2. Amending the test-scoped commit while a PR is open (an ordinary git
 *      push, outside `task-phases`) — represented here by re-running
 *      `status` with the same open PR still present — continues to report
 *      `awaiting-pr` against that same PR, with `task-phases` having taken
 *      no action of its own: no mutating git call, no `github.createPR`,
 *      no `gateChecks.run` (§3.4, LLD §3.4's "amending... keeps the PR open
 *      and current automatically... promote/status take no special action").
 *
 * Same in-process pattern as every prior chunk: `run(argv, tools)` is
 * called directly with an injected `ExternalTools` whose `git`/`github`
 * members are test doubles — no real git/gh/fs/gate-check anywhere. Every
 * mutating tool method is a throw-mock so that "took no action" is enforced
 * structurally, not merely asserted. `hasCommitsBeyond`/`headCommitTitle`
 * are resolving mocks asserted to be *never* called, proving the
 * awaiting-pr derivation is reached from the PR stage, not the branch-exists
 * chain.
 *
 * Every one of these tests fails against the pre-implementation codebase:
 * `lib/repo-state.ts`'s `assertNoGatePR()` still throws "not implemented"
 * the moment an open Build Gate PR is found (spec 06.01, replaced by this
 * chunk per §2.1), so `status` cannot yet report `awaiting-pr` — it exits 1
 * with "not implemented" instead. (The retired 06.01 test case that pinned
 * that deferral was removed by the architect ahead of this chunk; the still-
 * deferred merged/Main-Gate cases remain in defers-when-gate-pr-exists.test.ts,
 * owned by MAG-46-12/15.)
 */

// Implements: task-MAG-46-11-status-awaiting-pr-and-promote-pr-raised-spec.md
// System behaviors: 5.9 (status reports awaiting-pr), 5.10 (awaiting-pr
//   attached to source phase test)
// Spec sections: §3.2, §3.4

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

/** A `findMergedPR`/`findOpenPR` double that reports the given PR summary
 *  for exactly one base/head pair and `null` for every other pair. */
function prOnlyFor(
  pair: readonly [base: string, head: string],
  summary: PullRequestSummary,
): Mock {
  return vi.fn().mockImplementation((base: string, head: string) =>
    base === pair[0] && head === pair[1] ? summary : null,
  );
}

/** The open Build Gate PR §3.1/§3.2 raise/report. */
const OPEN_PR: PullRequestSummary = {
  number: 45,
  url: "https://github.com/weaver-engineering/magpie-weaver/pull/45",
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
 * Builds a full `ExternalTools` test double for the awaiting-pr read path.
 * Defaults: `test/AAA-123` and `spec/AAA-123` exist (so `anyPhaseBranchExists`
 * passes), the caller sits on `test/AAA-123`, no merged PR on any pair, and
 * an open PR on the Build Gate pair (`build/AAA-123` <- `test/AAA-123`).
 * Every mutating git method is a throw-mock, `github.createPR` is a
 * throw-mock, and `gateChecks.run` is a throw-mock — a `status` read must
 * touch none of them. `hasCommitsBeyond`/`headCommitTitle` are resolving
 * mocks asserted never-called, proving derivation comes from the PR stage.
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
  const currentBranch = overrides.currentBranch ?? vi.fn().mockResolvedValue("test/AAA-123");
  const branchExists = overrides.branchExists ?? existsOnly("test/AAA-123", "spec/AAA-123");
  const hasCommitsBeyond = vi.fn().mockResolvedValue(true);
  const headCommitTitle = vi.fn().mockResolvedValue("AAA-123: add tests");
  const isAncestor = vi.fn().mockResolvedValue(true);
  const findMergedPR = overrides.findMergedPR ?? vi.fn().mockResolvedValue(null);
  const findMergedPRs = vi.fn().mockResolvedValue([]);
  const findOpenPR =
    overrides.findOpenPR ??
    prOnlyFor(["build/AAA-123", "test/AAA-123"], OPEN_PR);
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

describe("status: reports awaiting-pr once the Build Gate PR is open (§3.2)", () => {
  it("derives phase test / state awaiting-pr, attached to the source phase, from the PR stage", async () => {
    const { tools, mocks } = buildTools();
    const { code, stdout } = await runStatus(["status", "--ref", "AAA-123", "--json"], tools);

    // A successfully-derived awaiting-pr read is a successful status run.
    expect(code).toBe(0);
    expect(stdout).toContain("Task::Phase::State AAA-123::test::awaiting-pr");

    // The structured result reports phase "test" and state "awaiting-pr" —
    // the phase is the SOURCE phase of the open PR (test), never the
    // destination (build) (§2.1).
    const json = parseJson(stdout);
    expect(json.success).toBe(true);
    expect(json.result.taskStatus.phase).toBe("test");
    expect(json.result.taskStatus.state).toBe("awaiting-pr");

    // fetch runs unconditionally first (§1.1), and the Build Gate pair was
    // consulted.
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.findOpenPR).toHaveBeenCalledWith("build/AAA-123", "test/AAA-123");

    // PR-driven: the branch-exists derivation (`hasCommitsBeyond`/
    // `headCommitTitle`) is never reached for awaiting-pr, and a plain read
    // never touches gate-check.
    expect(mocks.hasCommitsBeyond).not.toHaveBeenCalled();
    expect(mocks.headCommitTitle).not.toHaveBeenCalled();
    expect(mocks.gateRun).not.toHaveBeenCalled();
  });
});

describe("status: amending the test commit while awaiting-pr needs no tool action (§3.4)", () => {
  it("still reports awaiting-pr against the same open PR, having performed no action of its own", async () => {
    // §3.4 Given: the same open Build Gate PR persists (the agent pushed an
    // amended test-scoped commit directly to test/AAA-123, outside
    // task-phases — §3.2's derivation is unaffected by it). Re-querying
    // status must still report awaiting-pr against that PR, and task-phases
    // must have taken no action.
    const { tools, mocks } = buildTools();

    const { code, stdout } = await runStatus(["status", "--ref", "AAA-123", "--json"], tools);

    expect(code).toBe(0);
    const json = parseJson(stdout);
    expect(json.result.taskStatus.phase).toBe("test");
    expect(json.result.taskStatus.state).toBe("awaiting-pr");

    // The same, unchanged PR is re-reported — not re-raised.
    expect(mocks.findOpenPR).toHaveBeenCalledWith("build/AAA-123", "test/AAA-123");

    // No action of task-phases' own: no PR creation, no mutating git call,
    // no gate-check. Every mutating tool method is a throw-mock, so any
    // call would fail loudly; the assertions below make the intended
    // absence explicit.
    expect(mocks.gateRun).not.toHaveBeenCalled();
    // createPR/createBranch/checkout/push/commitAll/pullFastForward/rebase/
    // deleteBranch/createRemoteBranch are all throw-mocks — reaching any
    // one would have thrown and failed this test.
  });
});
