/**
 * Command-level system tests for `pnpm task list [--json]` — enumerating
 * every active `{ref}` and deriving each one's `TaskStatus` through the same
 * shared pipeline `status` uses (task-MAG-46-16-list-spec.md, LLD §3.10).
 *
 * Behaviors under test, per the spec:
 *   1. `list` lists every ref with an active branch, each with its derived
 *      phase/state, grouped so each ref appears once even when `listBranches`
 *      returns both the local and remote-tracking forms of its branch
 *      (§3.1, LLD §3.10's "group by {ref}"). It marks the currently
 *      checked-out task (§3.1's `currentRef`).
 *   2. `branchMismatch` is surfaced per entry — but only on the current
 *      task's entry is it meaningful, matching LLD §3.10's human output
 *      (the `<==` current-task marker nests the `MISSMATCH` marker): a
 *      non-current task's entry reports `branchMismatch: false` even when
 *      the checked-out branch is a different task's (§3.2).
 *   3. `list` NEVER calls `gateChecks.run` — deriving `ready?` but leaving
 *      it unresolved (no `--check` equivalent), per §2.1's explicit note and
 *      LLD §3.14's parked open question (§3.1's assertions).
 *   4. No active tasks — no branch matching the phase-branch/{ref} pattern on
 *      origin or locally — yields an empty `tasks` array and a `null`
 *      `currentRef` (§3.3).
 *   5. A ref reachable only via `origin/test/{ref}` (never checked out
 *      locally) is exactly as active as one with a local branch (§2.1's
 *      resolved note, added when `GitTool.listBranches` was identified as
 *      the missing enumeration primitive and pinned in
 *      `packages/task-phases/src/deps/git-list.interface.ts`).
 *
 * Same in-process pattern as every prior chunk: `run(argv, tools)` is called
 * directly with an injected `ExternalTools` whose `git`/`github` members are
 * test doubles — no real git/gh/fs/gate-check anywhere. Every mutating tool
 * method is a throw-mock, and `gateChecks.run` is a throw-mock, so "list took
 * no action and resolved no gate" is enforced structurally in addition to
 * being asserted.
 *
 * Every test fails against the pre-implementation codebase:
 * `commands/list.ts` is an untested placeholder throwing
 * `new Error("not implemented")` (spec 16 builds on open ground, per the
 * pre-sequencing review) — so no `pnpm task list` invocation can succeed
 * yet. `lib/repo-state.ts`'s `derivePhase` would additionally throw
 * "not implemented" for the remote-only ref (§2.1's case), which is the
 * pipeline change the build phase must make for `list` to work.
 */

// Implements: task-MAG-46-16-list-spec.md
// System behaviors: 4.1 (enumerate every active ref, grouped, with derived
//   phase/state), 4.2 (mark the currently checked-out task), 4.3 (mark
//   branchMismatch per entry), 4.4 (never resolves ready?), 4.5 (no-active
//   tasks case), plus §2.1's resolved note (remote-only refs are active)
// Spec sections: §3.1, §3.2, §3.3, §2.1 resolved note

import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { run } from "../../../../packages/task-phases/src/cli.js";
import type {
  ExternalTools,
  PullRequestSummary,
  TaskStatus,
} from "../../../../packages/task-phases/src/types.js";

/** A mock that fails the test loudly if the command under test calls a tool
 *  method that must not be touched on the path being exercised. */
function unexpected(method: string): Mock {
  return vi.fn().mockImplementation(() => {
    throw new Error(`unexpected call: ${method}`);
  });
}

/** A `branchExists` double reporting exactly the given branches as existing.
 *  The local and remote-tracking namespaces are distinct: `local` names a
 *  bare branch (`test/AAA-123`); `remote` names the same branch checked on
 *  origin via `{ remote: true }` (`origin/test/AAA-123`'s existence is
 *  `branchExists("test/AAA-123", { remote: true })`). */
function existsOnly(local: string[], remote: string[] = []): Mock {
  return vi.fn().mockImplementation((name: string, opts?: { remote?: boolean }) =>
    opts?.remote === true ? remote.includes(name) : local.includes(name),
  );
}

/** A `findOpenPR` double reporting the given `PullRequestSummary` for exactly
 *  the given base/head pairs and `null` for every other pair. */
function openPRFor(pairs: ReadonlyArray<readonly [base: string, head: string]>): Mock {
  return vi.fn().mockImplementation((base: string, head: string) =>
    pairs.some(([b, h]) => b === base && h === head) ? OPEN_PR : null,
  );
}

/** The open Build Gate PR §3.1's `ABC-789` entry (and §3.2's `AAA-123`) is
 *  derived from — `awaiting-pr` attached to the source phase `test`. */
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
    listBranches: Mock;
    hasCommitsBeyond: Mock;
    headCommitTitle: Mock;
    isAncestor: Mock;
    findMergedPR: Mock;
    findOpenPR: Mock;
    gateRun: Mock;
  };
}

/**
 * Builds a full `ExternalTools` test double for the `task list` read path.
 * Defaults encode the §3.1 scenario: `test/AAA-123` and `test/ABC-789` both
 * exist locally and on origin (so the typical post-fetch `listBranches`
 * output carries both forms of each — grouping must collapse them into one
 * entry per ref), a single commit of its own on `test/AAA-123` with a
 * non-WIP head (so its branch-exists derivation lands on `ready?` and stays
 * there because `list` never resolves it), and an open Build Gate PR for
 * `ABC-789` (so it derives `awaiting-pr` from the PR stage, before the
 * branch-exists chain). The caller sits on the canonical `test/AAA-123`.
 *
 * `gateChecks.run` is a throw-mock — `list` must never touch it. Every
 * mutating git method is a throw-mock, and `github.createPR` is a throw-mock.
 * `listBranches` is a real double (the enumeration primitive this chunk
 * pins); `fetch` is a resolving double (a `status`-style command fetches
 * first, per §1.1/§2.1, before deriving any ref).
 */
function buildTools(
  overrides: {
    currentBranch?: Mock;
    branches?: string[];
    localBranches?: string[];
    remoteBranches?: string[];
    openPRs?: ReadonlyArray<readonly [base: string, head: string]>;
    hasCommitsBeyond?: Mock;
  } = {},
): MockSet {
  const fetch = vi.fn().mockResolvedValue(undefined);
  const currentBranch = overrides.currentBranch ?? vi.fn().mockResolvedValue("test/AAA-123");

  const listBranches = vi
    .fn()
    .mockResolvedValue(
      overrides.branches ??
        ["test/AAA-123", "origin/test/AAA-123", "test/ABC-789", "origin/test/ABC-789"],
    );

  const localBranches = overrides.localBranches ?? ["test/AAA-123", "test/ABC-789"];
  const remoteBranches = overrides.remoteBranches ?? ["test/AAA-123", "test/ABC-789"];
  const branchExists = existsOnly(localBranches, remoteBranches);

  const hasCommitsBeyond = overrides.hasCommitsBeyond ?? vi.fn().mockResolvedValue(true);
  const headCommitTitle = vi.fn().mockResolvedValue("AAA-123: add list tests");
  const isAncestor = vi.fn().mockResolvedValue(true);
  const findMergedPR = vi.fn().mockResolvedValue(null);
  const findMergedPRs = vi.fn().mockResolvedValue([]);
  const findOpenPR = openPRFor(overrides.openPRs ?? [["build/ABC-789", "test/ABC-789"]]);
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
      createRemoteBranch: unexpected("createRemoteBranch"),
      checkout: unexpected("checkout"),
      commitAll: unexpected("commitAll"),
      push: unexpected("push"),
      pullFastForward: unexpected("pullFastForward"),
      rebase: unexpected("rebase"),
      deleteBranch: unexpected("deleteBranch"),
      listBranches,
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
      listBranches,
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

afterEach(() => {
  vi.restoreAllMocks();
});

/** The `result` shape serialised under the `--json` doc for a list run — the
 *  base `TaskPhasingCommandResult` fields plus `tasks` and `currentRef`. */
interface JsonListResult {
  success: boolean;
  result: {
    success: boolean;
    tasks: TaskStatus[];
    currentRef: string | null;
  };
}

/** Parses the single JSON document a `--json` list run emits. */
function parseJson(stdout: string): JsonListResult {
  const lines = stdout.trim().split("\n");
  const doc = JSON.parse(lines[lines.length - 1]) as JsonListResult;
  return doc;
}

/** Runs an in-process `list --json` invocation to completion. */
async function runList(
  tools: ExternalTools,
): Promise<{ code: number; doc: JsonListResult }> {
  const cap = captureStdout();
  const code = await run(["node", "cli.js", "list", "--json"], tools);
  const stdout = cap.stdout();
  cap.restore();
  return { code, doc: parseJson(stdout) };
}

/** Finds the single `tasks` entry for `ref`, failing the test if absent. */
function byRef(tasks: TaskStatus[], ref: string): TaskStatus {
  const entry = tasks.find((t) => t.ref === ref);
  expect(entry).toBeDefined();
  return entry!;
}

describe("list: multiple active tasks, one current (§3.1)", () => {
  it("lists each active ref once with its derived phase/state, marks the current task, and never runs the gate", async () => {
    const { tools, mocks } = buildTools();
    const { code, doc } = await runList(tools);

    // A successful list read is exit 0.
    expect(code).toBe(0);
    expect(doc.result.success).toBe(true);

    // Both forms of each branch (local `test/AAA-123` and remote
    // `origin/test/AAA-123`, etc.) collapse into ONE entry per ref —
    // LLD §3.10's "group by {ref}".
    expect(doc.result.tasks).toHaveLength(2);

    // AAA-123 is derived from the branch-exists chain: phase "test" and a
    // non-ready?-RESOLVED state — here `ready?`, left unresolved because
    // list never calls the gate (no --check equivalent).
    const aaa = byRef(doc.result.tasks, "AAA-123");
    expect(aaa.phase).toBe("test");
    expect(aaa.state).toBe("ready?");
    expect(aaa.branchMismatch).toBe(false); // caller sits on canonical test/AAA-123

    // ABC-789 is derived from the PR stage: an open Build Gate PR is
    // `awaiting-pr` on the source phase `test`.
    const abc = byRef(doc.result.tasks, "ABC-789");
    expect(abc.phase).toBe("test");
    expect(abc.state).toBe("awaiting-pr");

    // The current task (derived from git.currentBranch()) is marked.
    expect(doc.result.currentRef).toBe("AAA-123");

    // list fetched first (§1.1/§2.1) and enumerated via the new primitive.
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.listBranches).toHaveBeenCalledTimes(1);

    // The §2.1/§4.4 assertion: list never resolves ready? — gateChecks.run
    // is a throw-mock, so any call would fail loudly, and it must not have
    // been touched at all.
    expect(mocks.gateRun).not.toHaveBeenCalled();
  });
});

describe("list: branchMismatch surfaced per entry (§3.2)", () => {
  it("flags the current task's entry when the checked-out branch differs from its canonical, leaving other entries unflagged", async () => {
    // §3.2 Given: as §3.1 (both test branches active) but the caller sits on
    // build/AAA-123 while AAA-123's canonical branch is test/AAA-123 (an
    // open Build Gate PR on AAA-123, like ABC-789's).
    const { tools } = buildTools({
      currentBranch: vi.fn().mockResolvedValue("build/AAA-123"),
      branches: [
        "test/AAA-123",
        "origin/test/AAA-123",
        "build/AAA-123",
        "test/ABC-789",
        "origin/test/ABC-789",
      ],
      localBranches: ["test/AAA-123", "build/AAA-123", "test/ABC-789"],
      openPRs: [
        ["build/AAA-123", "test/AAA-123"],
        ["build/ABC-789", "test/ABC-789"],
      ],
    });
    const { code, doc } = await runList(tools);

    expect(code).toBe(0);
    expect(doc.result.tasks).toHaveLength(2);

    // AAA-123's canonical is test/AAA-123, but the caller is on build/AAA-123
    // — the current task's mismatch is surfaced.
    const aaa = byRef(doc.result.tasks, "AAA-123");
    expect(aaa.phase).toBe("test");
    expect(aaa.state).toBe("awaiting-pr");
    expect(aaa.canonicalBranch).toBe("test/AAA-123");
    expect(aaa.branchMismatch).toBe(true);

    // The current task (derived from build/AAA-123) is AAA-123.
    expect(doc.result.currentRef).toBe("AAA-123");

    // ABC-789's entry is NOT flagged as mismatched — the mismatch flag is
    // only meaningful on the current task's entry (LLD §3.10's nested
    // `<==` current-task / `MISSMATCH` markers), so a non-current task
    // reports false even though the checked-out branch differs from it.
    const abc = byRef(doc.result.tasks, "ABC-789");
    expect(abc.branchMismatch).toBe(false);
  });
});

describe("list: no active tasks (§3.3)", () => {
  it("reports an empty tasks array and a null currentRef when no branch matches */{ref}", async () => {
    // Given: no branch on origin or locally matches */{ref} for any ref —
    // here `listBranches` returns only `main`, which the regex filter
    // `/^[A-Z]+-[0-9]+$/` excludes.
    const { tools, mocks } = buildTools({
      branches: ["main"],
      currentBranch: vi.fn().mockResolvedValue("main"),
      localBranches: [],
      remoteBranches: [],
    });
    const { code, doc } = await runList(tools);

    expect(code).toBe(0);
    expect(doc.result.tasks).toEqual([]);
    expect(doc.result.currentRef).toBeNull();
    expect(mocks.gateRun).not.toHaveBeenCalled();
  });
});

describe("list: a ref reachable only via origin/test/{ref} is active (§2.1 resolved note)", () => {
  it("lists a remote-only ref (never checked out locally) exactly as a locally-present one", async () => {
    // Given: `origin/test/XYZ-456` is the only branch matching the ref
    // pattern — XYZ-456 was never checked out locally (only its
    // remote-tracking form exists). The caller sits on `main`.
    const { tools, mocks } = buildTools({
      branches: ["origin/test/XYZ-456", "main"],
      currentBranch: vi.fn().mockResolvedValue("main"),
      localBranches: [],
      remoteBranches: ["test/XYZ-456"],
      hasCommitsBeyond: vi.fn().mockResolvedValue(false),
    });
    const { code, doc } = await runList(tools);

    expect(code).toBe(0);
    expect(mocks.listBranches).toHaveBeenCalledTimes(1);

    // One entry for XYZ-456 — a remote-only ref is exactly as active as a
    // locally-present one, with a derived phase/state.
    expect(doc.result.tasks).toHaveLength(1);
    const xyz = byRef(doc.result.tasks, "XYZ-456");
    expect(xyz.ref).toBe("XYZ-456");
    expect(xyz.phase).toBe("test");
    expect(xyz.state).toBe("not-started");

    // The caller is on `main`, which is no task's canonical branch — no
    // current task.
    expect(doc.result.currentRef).toBeNull();
    expect(mocks.gateRun).not.toHaveBeenCalled();
  });
});
