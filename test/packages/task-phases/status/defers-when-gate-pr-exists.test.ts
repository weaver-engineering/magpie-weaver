/**
 * Command-level system tests for `pnpm task status --ref <ref>` deferring
 * ("not implemented") whenever any gate PR for `{ref}` is merged or open —
 * the merge-status/open-PR check the §3.2 pipeline runs *before* the
 * no-PR branch-exists derivation (task-MAG-46-06-01-status-defers-when-
 * gate-pr-exists-spec.md, LLD §3.2).
 *
 * **Correction (MAG-46, quick-route architect fix, ahead of MAG-46-11):**
 * the original §3.2 case here — "defers when the Build Gate PR is open" —
 * has been removed. It asserted the case MAG-46-06.01's own comment on
 * `assertNoGatePR()` always said was temporary: "The PR-driven states
 * (awaiting-pr, merged-pending-pull, merged-pending-cleanup) are owned by
 * later chunks (MAG-46-11/12/15); until they land, an existing PR means
 * the caller cannot answer authoritatively." MAG-46-11 is exactly that
 * later chunk for the open-Build-Gate-PR case: `status`/`promote` now
 * derive real `awaiting-pr` for it instead of deferring, which directly
 * contradicts what this file's old §3.2 asserted. That behavior is
 * retested for real in `status/awaiting-pr.test.ts` (MAG-46-11's own test
 * file, per its test-file-layout note) — not rewritten in place here,
 * since covering it is MAG-46-11's test-phase work, not an architect
 * correction to make on its behalf. §3.1/§3.3/§3.4 below are untouched —
 * none of those pairs are MAG-46-11's scope, still correctly deferred,
 * still owned by MAG-46-12/15.
 *
 * Same in-process pattern as specs 04/06: `run(argv, tools)` is called
 * directly with an injected `ExternalTools` whose `git`/`github` members
 * are test doubles — no real git/gh/fs calls anywhere. Unlike spec 06,
 * whose Given clauses only ever set `findMergedPR`/`findOpenPR` to return
 * `null` as a precondition, the doubles here are asserted explicitly:
 * each scenario configures one gate pair as PR-present, and the test
 * requires both that the deferral fires AND that the branch-exists
 * derivation (`hasCommitsBeyond`, `headCommitTitle`) is provably
 * unreached (§2.1) — not merely that the right message came out.
 *
 * Every one of these tests fails against the pre-implementation codebase:
 * `status` currently ignores the PR pairs entirely and derives
 * phase/state from branch existence alone, so the deferral message and
 * the pair consultation can't be produced yet.
 */

// Implements: task-MAG-46-06-01-status-defers-when-gate-pr-exists-spec.md
// System behaviors: 1.5.6, 1.5.8, 1.5.9 (1.5.7 retired — see correction
// note above; retested for real in status/awaiting-pr.test.ts, MAG-46-11)

import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { run } from "../../../../packages/task-phases/src/cli.js";
import type {
  ExternalTools,
  MergedPullRequestSummary,
  PullRequestSummary,
} from "../../../../packages/task-phases/src/types.js";

/** A mock that fails the test loudly if the command under test calls a tool
 *  method that must not be touched on the deferral path. */
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
  summary: PullRequestSummary | MergedPullRequestSummary,
): Mock {
  return vi.fn().mockImplementation((base: string, head: string) =>
    base === pair[0] && head === pair[1] ? summary : null,
  );
}

/** A fully-shaped `MergedPullRequestSummary` (gh.ts §4.9). */
function mergedPR(over: Partial<MergedPullRequestSummary> = {}): MergedPullRequestSummary {
  return {
    number: 42,
    url: "https://github.com/weaver-engineering/magpie-weaver/pull/42",
    mergedAt: "2026-08-01T00:00:00Z",
    headRefOid: "1111111111111111111111111111111111111111",
    mergeCommitOid: "2222222222222222222222222222222222222222",
    ...over,
  };
}

/** A fully-shaped `PullRequestSummary` (gh.ts §4.9). */
function openPR(over: Partial<PullRequestSummary> = {}): PullRequestSummary {
  return {
    number: 43,
    url: "https://github.com/weaver-engineering/magpie-weaver/pull/43",
    ...over,
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
  };
}

/** Builds a full `ExternalTools` test double for the PR-present deferral
 *  path. Defaults: fetch resolves, currentBranch "main", no branch exists,
 *  no commits beyond main, no PR ever raised, and no PR-summary consultation
 *  asserted; every other tool method throws if called. */
function buildTools(
  overrides: {
    branchExists?: Mock;
    currentBranch?: Mock;
    findMergedPR?: Mock;
    findOpenPR?: Mock;
  } = {},
): MockSet {
  const fetch = vi.fn().mockResolvedValue(undefined);
  const currentBranch = overrides.currentBranch ?? vi.fn().mockResolvedValue("main");
  const branchExists = overrides.branchExists ?? vi.fn().mockResolvedValue(false);
  const hasCommitsBeyond = vi.fn().mockResolvedValue(false);
  const headCommitTitle = vi.fn().mockResolvedValue("");
  const isAncestor = vi.fn().mockResolvedValue(false);
  const findMergedPR = overrides.findMergedPR ?? vi.fn().mockResolvedValue(null);
  const findMergedPRs = vi.fn().mockResolvedValue([]);
  const findOpenPR = overrides.findOpenPR ?? vi.fn().mockResolvedValue(null);

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
    },
    github: {
      createPR: unexpected("createPR"),
      findMergedPRs,
      findMergedPR,
      findOpenPR,
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

describe("status: defers when a gate PR exists", () => {
  it("defers when the Build Gate PR is merged, without deriving from branches (§3.1)", async () => {
    const { tools, mocks } = buildTools({
      branchExists: existsOnly("test/AAA-101"),
      findMergedPR: prOnlyFor(["build/AAA-101", "test/AAA-101"], mergedPR()),
    });
    const cap = captureStdout();
    const code = await run(["node", "cli.js", "status", "--ref", "AAA-101"], tools);
    const stdout = cap.stdout();
    cap.restore();

    // The deferral is the same "not implemented" placeholder every
    // not-yet-built path in this command already uses.
    expect(code).toBe(1);
    expect(stdout).toContain("not implemented");

    // fetch runs unconditionally first (§1.1).
    expect(mocks.fetch).toHaveBeenCalledTimes(1);

    // The Build Gate pair (test/{ref} -> build/{ref}) was consulted and
    // its merged PR triggered the deferral.
    expect(mocks.findMergedPR).toHaveBeenCalledWith("build/AAA-101", "test/AAA-101");

    // The branch-exists derivation (MAG-46-06) genuinely wasn't reached
    // (§2.1) — not merely that the right message came out.
    expect(mocks.hasCommitsBeyond).not.toHaveBeenCalled();
    expect(mocks.headCommitTitle).not.toHaveBeenCalled();
  });

  it("defers when the Main Gate PR (normal route) is merged, without deriving from branches (§3.3)", async () => {
    const { tools, mocks } = buildTools({
      branchExists: existsOnly("build/AAA-103"),
      findMergedPR: prOnlyFor(["main", "build/AAA-103"], mergedPR()),
    });
    const cap = captureStdout();
    const code = await run(["node", "cli.js", "status", "--ref", "AAA-103"], tools);
    const stdout = cap.stdout();
    cap.restore();

    expect(code).toBe(1);
    expect(stdout).toContain("not implemented");

    expect(mocks.fetch).toHaveBeenCalledTimes(1);

    // The Main Gate pair (build/{ref} -> main) was consulted and its
    // merged PR triggered the deferral.
    expect(mocks.findMergedPR).toHaveBeenCalledWith("main", "build/AAA-103");

    expect(mocks.hasCommitsBeyond).not.toHaveBeenCalled();
    expect(mocks.headCommitTitle).not.toHaveBeenCalled();
  });

  it("defers when the Main Gate PR (quick route) is open, without deriving from branches (§3.4)", async () => {
    const { tools, mocks } = buildTools({
      branchExists: existsOnly("task/AAA-104"),
      findMergedPR: vi.fn().mockResolvedValue(null),
      findOpenPR: prOnlyFor(["main", "task/AAA-104"], openPR()),
    });
    const cap = captureStdout();
    const code = await run(["node", "cli.js", "status", "--ref", "AAA-104"], tools);
    const stdout = cap.stdout();
    cap.restore();

    expect(code).toBe(1);
    expect(stdout).toContain("not implemented");

    expect(mocks.fetch).toHaveBeenCalledTimes(1);

    // Every merged check comes back null, but the open Main Gate PR on the
    // quick route (task/{ref} -> main) still triggers deferral.
    expect(mocks.findOpenPR).toHaveBeenCalledWith("main", "task/AAA-104");

    expect(mocks.hasCommitsBeyond).not.toHaveBeenCalled();
    expect(mocks.headCommitTitle).not.toHaveBeenCalled();
  });
});
