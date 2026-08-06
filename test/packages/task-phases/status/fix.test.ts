/**
 * Command-level system tests for `pnpm task status --fix` — the
 * branch-switch extension of `status` (task-MAG-46-18-init-status-ref-
 * flag-variants-spec.md §3.6/3.7, LLD §3.9): on a branch mismatch `--fix`
 * checks out the derived canonical branch and reports `fixed: true` (§3.6);
 * when the current branch already IS the canonical branch it is a no-op —
 * nothing checked out, `fixed: false` (§3.7).
 *
 * The scenario is the merged Build Gate PR (`build/{ref}` <- `test/{ref}`)
 * from MAG-46-12: the derivation yields canonical `build/{ref}` while the
 * caller sits on `test/{ref}` — a genuine mismatch `--fix` must resolve.
 * Same in-process pattern as every prior status chunk: `run(argv, tools)`
 * is called directly with an injected `ExternalTools` whose `git`/`github`
 * members are test doubles — no real git/gh calls anywhere. `fetch()`
 * runs first (§1.1), `findMergedPR` reports the merged Build Gate PR
 * (with `headRefOid` matching the remote `test/{ref}` HEAD), and
 * `isDirty` is a benign resolving mock (spec §3.6 pins it `false`; `--fix`
 * only commits WIP first when `--wip` is also given, which these tests
 * never pass). Every other tool method is a throw-mock — a status read
 * must not touch createBranch/commitAll/pull/rebase/gate-check.
 *
 * Fail-then-pass: §3.6's test fails against the pre-implementation
 * codebase — `status.ts` has no `--fix` handling at all, so it never calls
 * `git.checkout` and reports `fixed: false`; both assertions fail. §3.7's
 * no-op assertions (checkout NOT called, `fixed: false`) are the opposite
 * corner and are *already* satisfied by the stub, which never calls
 * checkout and always reports `fixed: false` — the file as a whole still
 * fails the gate through §3.6, and §3.7 pins the no-op contract so the
 * build phase cannot over-fix (e.g. blindly checking out on every --fix).
 */

// Implements: task-MAG-46-18-init-status-ref-flag-variants-spec.md
// System behaviors: 3.7 (status --fix switches to canonical branch)

import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { run } from "../../../../packages/task-phases/src/cli.js";
import type {
  ExternalTools,
  MergedPullRequestSummary,
  TaskStatus,
} from "../../../../packages/task-phases/src/types.js";

/** A mock that fails the test loudly if the command under test calls a tool
 * method it must not touch on the --fix path. */
function unexpected(method: string): Mock {
  return vi.fn().mockImplementation(() => {
    throw new Error(`unexpected call: ${method}`);
  });
}

/** A `branchExists` double reporting exactly the given branches as existing
 * — both the plain and `{ remote: true }` forms resolve identically. */
function existsOnly(...branches: string[]): Mock {
  return vi.fn().mockImplementation((name: string) => branches.includes(name));
}

/** §3.7's caught-up build HEAD — local equals origin, so the merged PR no
 * longer drives state and derivation falls through to the ordinary
 * build-phase derivation (canonical stays `build/{ref}`). */
const CAUGHT_UP_HEAD = "dddddddddddddddddddddddddddddddddddddddd";

/** The test/{ref} HEAD the merged Build Gate PR's `headRefOid` records —
 * shared by both scenarios so the ordinary-merge comparison matches. */
const TEST_HEAD = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

/** A fully-shaped `MergedPullRequestSummary` (gh.ts §4.9) recording
 * `headRefOid` == the test branch's current HEAD (the ordinary-merge case). */
function mergedBuildGatePR(): MergedPullRequestSummary {
  return {
    number: 42,
    url: "https://github.com/weaver-engineering/magpie-weaver/pull/42",
    mergedAt: "2026-08-01T00:00:00Z",
    headRefOid: TEST_HEAD,
    mergeCommitOid: "2222222222222222222222222222222222222222",
  };
}

interface MockSet {
  tools: ExternalTools;
  mocks: {
    fetch: Mock;
    currentBranch: Mock;
    branchExists: Mock;
    headSha: Mock;
    findMergedPR: Mock;
    findOpenPR: Mock;
    checkout: Mock;
  };
}

/** Builds a full `ExternalTools` test double for the `status --fix` path.
 * Defaults: the merged Build Gate PR for `build/{ref}` <- `test/{ref}` is
 * present with `headRefOid` == `headSha("origin/test/{ref}")` — the
 * derivation canonical branch is `build/{ref}` — and `isDirty` is false.
 * `checkout` is a benign resolving mock: the --fix switch is exactly what
 * these tests assert. `branchExists`/`headSha`/`currentBranch` are
 * scenario-specific and therefore required overrides. Every mutating git
 * method, `github.createPR`, and `gateChecks.run` are throw-mocks. */
function buildTools(
  ref: string,
  overrides: {
    currentBranch: Mock;
    branchExists: Mock;
    headSha: Mock;
  },
): MockSet {
  const fetch = vi.fn().mockResolvedValue(undefined);
  const currentBranch = overrides.currentBranch;
  const branchExists = overrides.branchExists;
  const headSha = overrides.headSha;
  const findMergedPR = vi.fn().mockImplementation((base: string, head: string) =>
    base === `build/${ref}` && head === `test/${ref}` ? mergedBuildGatePR() : null,
  );
  const findMergedPRs = vi.fn().mockResolvedValue([]);
  const findOpenPR = vi.fn().mockResolvedValue(null);
  const checkout = vi.fn().mockResolvedValue(undefined);
  // Benign resolving mocks: the §3.7 caught-up case falls through to the
  // ordinary build-phase derivation, which consults them (the §3.6 case
  // never reaches them — PR-driven). Throw-mocks would let the mocks'
  // shape leak into the test's own fixture rather than the code under test.
  const hasCommitsBeyond = vi.fn().mockResolvedValue(false);
  const headCommitTitle = vi.fn().mockResolvedValue("");

  const tools = {
    git: {
      fetch,
      currentBranch,
      branchExists,
      headSha,
      mergeBase: unexpected("mergeBase"),
      hasCommitsBeyond,
      headCommitTitle,
      isDirty: vi.fn().mockResolvedValue(false),
      isAncestor: unexpected("isAncestor"),
      createBranch: unexpected("createBranch"),
      checkout,
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
      headSha,
      findMergedPR,
      findOpenPR,
      checkout,
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

/** Parses the single JSON document a `--json` status run emits. */
function parseJson(
  stdout: string,
): { success: boolean; result: { taskStatus: TaskStatus; fixed: boolean } } {
  const lines = stdout.trim().split("\n");
  const doc = JSON.parse(lines[lines.length - 1]) as {
    success: boolean;
    result: { taskStatus: TaskStatus; fixed: boolean };
  };
  return doc;
}

describe("status --fix: branch switch on mismatch (§3.6)", () => {
  it("checks out the derived canonical branch when the current branch differs", async () => {
    const { tools, mocks } = buildTools("AAA-123", {
      // Caller sits on test/AAA-123 while the merged Build Gate PR makes
      // build/AAA-123 canonical — a genuine mismatch.
      currentBranch: vi.fn().mockResolvedValue("test/AAA-123"),
      // spec/test exist in both forms; build/AAA-123 is absent locally
      // (the merged-pending-pull §3.1 shape).
      branchExists: vi.fn().mockImplementation((name: string, opts?: { remote?: boolean }) => {
        if (name === "build/AAA-123") {
          return opts?.remote === true;
        }
        return name === "spec/AAA-123" || name === "test/AAA-123";
      }),
      headSha: vi.fn().mockImplementation((branch: string) => {
        if (branch !== "origin/test/AAA-123") {
          throw new Error(`unexpected headSha call: ${branch}`);
        }
        return TEST_HEAD;
      }),
    });
    const cap = captureStdout();
    const code = await run(["node", "cli.js", "status", "--fix", "--json"], tools);
    const stdout = cap.stdout();
    cap.restore();

    expect(code).toBe(0);

    // The mismatch is real: current test/AAA-123 vs canonical build/AAA-123.
    const json = parseJson(stdout);
    expect(json.result.taskStatus.canonicalBranch).toBe("build/AAA-123");
    expect(json.result.taskStatus.currentBranch).toBe("test/AAA-123");
    expect(json.result.taskStatus.branchMismatch).toBe(true);

    // --fix switches to the canonical branch and reports it.
    expect(mocks.checkout).toHaveBeenCalledWith("build/AAA-123");
    expect(json.result.fixed).toBe(true);

    // fetch runs first (§1.1), and the merged Build Gate PR drove the
    // derivation.
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.findMergedPR).toHaveBeenCalledWith("build/AAA-123", "test/AAA-123");
  });
});

describe("status --fix: no-op when already canonical (§3.7)", () => {
  it("does not check out anything when the current branch already is the canonical branch", async () => {
    const { tools, mocks } = buildTools("AAA-124", {
      currentBranch: vi.fn().mockResolvedValue("build/AAA-124"),
      // build/AAA-124 exists locally and equals origin — the merged PR no
      // longer drives state, but canonical stays build/AAA-124.
      branchExists: existsOnly("spec/AAA-124", "test/AAA-124", "build/AAA-124"),
      headSha: vi.fn().mockImplementation((branch: string) => {
        if (branch === "origin/test/AAA-124") {
          return TEST_HEAD;
        }
        if (branch === "build/AAA-124" || branch === "origin/build/AAA-124") {
          return CAUGHT_UP_HEAD;
        }
        throw new Error(`unexpected headSha call: ${branch}`);
      }),
    });
    const cap = captureStdout();
    const code = await run(["node", "cli.js", "status", "--fix", "--json"], tools);
    const stdout = cap.stdout();
    cap.restore();

    expect(code).toBe(0);

    // No mismatch — current branch already equals canonical.
    const json = parseJson(stdout);
    expect(json.result.taskStatus.canonicalBranch).toBe("build/AAA-124");
    expect(json.result.taskStatus.currentBranch).toBe("build/AAA-124");
    expect(json.result.taskStatus.branchMismatch).toBe(false);

    // --fix is a no-op: nothing checked out, and the result says so.
    expect(mocks.checkout).not.toHaveBeenCalled();
    expect(json.result.fixed).toBe(false);
  });
});
