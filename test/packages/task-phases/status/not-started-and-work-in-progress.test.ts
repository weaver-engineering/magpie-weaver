/**
 * Command-level system tests for `pnpm task status --ref <ref>` deriving
 * `not-started` / `work-in-progress` — the branch-exists case of the §3.2
 * derivation pipeline (task-MAG-46-06-status-not-started-and-work-
 * progress-spec.md, LLD §3.9).
 *
 * Same in-process pattern as spec 04: `run(argv, tools)` is called directly
 * with an injected `ExternalTools` whose `git`/`github` members are test
 * doubles — no real git/gh/fs calls anywhere. `findMergedPR`/`findOpenPR`
 * report "no PR ever raised" (permitted to be consulted, never asserted
 * pair-by-pair), and every derivation-relevant `git` interaction is
 * asserted explicitly (Guard Rails): `hasCommitsBeyond` and
 * `headCommitTitle` with exact branch arguments (§2.1), `isAncestor` for
 * the ancestry-staleness fallback (§3.5), and `fetch()` unconditionally
 * first (§1.1).
 *
 * Every one of these tests fails against the pre-implementation codebase:
 * `status` currently throws "not implemented" whenever any phase branch
 * exists, so the derived `not-started`/`work-in-progress` result — and the
 * exit-0 contract — can't be produced yet.
 */

// Implements: task-MAG-46-06-status-not-started-and-work-in-progress-spec.md
// System behaviors: 1.5.2, 1.5.3, 1.5.10, 1.6, 1.10

import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { run } from "../../../../packages/task-phases/src/cli.js";
import type { ExternalTools } from "../../../../packages/task-phases/src/types.js";

/** A mock that fails the test loudly if the command under test calls a tool
 *  method that must not be touched on the no-PR branch-exists path. */
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

/** Builds a full `ExternalTools` test double for the no-PR branch-exists
 *  path. Defaults: fetch resolves, currentBranch "main", no branch exists,
 *  no commits beyond main (not-started), no PR (merged or open) ever
 *  raised; every other tool method throws if called. */
function buildTools(
  overrides: {
    fetch?: Mock;
    currentBranch?: Mock;
    branchExists?: Mock;
    hasCommitsBeyond?: Mock;
    headCommitTitle?: Mock;
    isAncestor?: Mock;
  } = {},
): MockSet {
  const fetch = overrides.fetch ?? vi.fn().mockResolvedValue(undefined);
  const currentBranch = overrides.currentBranch ?? vi.fn().mockResolvedValue("main");
  const branchExists = overrides.branchExists ?? vi.fn().mockResolvedValue(false);
  const hasCommitsBeyond = overrides.hasCommitsBeyond ?? vi.fn().mockResolvedValue(false);
  const headCommitTitle = overrides.headCommitTitle ?? vi.fn().mockResolvedValue("");
  const isAncestor = overrides.isAncestor ?? vi.fn().mockResolvedValue(false);
  const findMergedPR = vi.fn().mockResolvedValue(null);
  const findMergedPRs = vi.fn().mockResolvedValue([]);
  const findOpenPR = vi.fn().mockResolvedValue(null);

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

/** The `taskStatus` shape serialised under `result` in the `--json` doc. */
interface JsonTaskStatus {
  ref: string;
  phase: string | null;
  canonicalBranch: string | null;
  currentBranch: string | null;
  branchMismatch: boolean;
  state: string;
}

function parseJsonStatus(stdout: string): JsonTaskStatus {
  const lines = stdout.trim().split("\n");
  expect(lines).toHaveLength(1);
  const doc = JSON.parse(lines[0]) as {
    success: boolean;
    result: { taskStatus: JsonTaskStatus };
  };
  expect(doc.success).toBe(true);
  return doc.result.taskStatus;
}

describe("status: not-started / work-in-progress", () => {
  it("reports spec/not-started when spec/{ref} exists with no commits beyond main (§3.1)", async () => {
    const { tools, mocks } = buildTools({
      branchExists: existsOnly("spec/AAA-001"),
    });
    const cap = captureStdout();
    const code = await run(["node", "cli.js", "status", "--ref", "AAA-001"], tools);
    const stdout = cap.stdout();
    cap.restore();

    expect(code).toBe(0);
    expect(stdout).toContain("Task::Phase::State AAA-001::spec::not-started");

    // fetch runs unconditionally first (§1.1).
    expect(mocks.fetch).toHaveBeenCalledTimes(1);

    // The spec-phase state is derived against `main`, and with no commits
    // beyond it there is nothing to check a title on (§2.1).
    expect(mocks.hasCommitsBeyond).toHaveBeenCalledWith("spec/AAA-001", "main");
    expect(mocks.headCommitTitle).not.toHaveBeenCalled();
  });

  it("reports spec/work-in-progress when spec/{ref} has commits, head not WIP (§3.2)", async () => {
    const { tools, mocks } = buildTools({
      branchExists: existsOnly("spec/AAA-002"),
      hasCommitsBeyond: vi.fn().mockResolvedValue(true),
      headCommitTitle: vi.fn().mockResolvedValue("Draft the interface"),
    });
    const cap = captureStdout();
    const code = await run(["node", "cli.js", "status", "--ref", "AAA-002"], tools);
    const stdout = cap.stdout();
    cap.restore();

    expect(code).toBe(0);
    expect(stdout).toContain("Task::Phase::State AAA-002::spec::work-in-progress");

    expect(mocks.hasCommitsBeyond).toHaveBeenCalledWith("spec/AAA-002", "main");
    expect(mocks.headCommitTitle).toHaveBeenCalledWith("spec/AAA-002");
  });

  it("reports quick/not-started for the task/{ref} route with no commits (§3.3)", async () => {
    const { tools, mocks } = buildTools({
      branchExists: existsOnly("task/AAA-003"),
    });
    const cap = captureStdout();
    const code = await run(["node", "cli.js", "status", "--ref", "AAA-003"], tools);
    const stdout = cap.stdout();
    cap.restore();

    expect(code).toBe(0);
    expect(stdout).toContain("Task::Phase::State AAA-003::quick::not-started");

    expect(mocks.hasCommitsBeyond).toHaveBeenCalledWith("task/AAA-003", "main");
    expect(mocks.headCommitTitle).not.toHaveBeenCalled();
  });

  it("reports quick/work-in-progress for the task/{ref} route with commits (§3.4)", async () => {
    const { tools, mocks } = buildTools({
      branchExists: existsOnly("task/AAA-004"),
      hasCommitsBeyond: vi.fn().mockResolvedValue(true),
      headCommitTitle: vi.fn().mockResolvedValue("AAA-004: first pass"),
    });
    const cap = captureStdout();
    const code = await run(["node", "cli.js", "status", "--ref", "AAA-004"], tools);
    const stdout = cap.stdout();
    cap.restore();

    expect(code).toBe(0);
    expect(stdout).toContain("Task::Phase::State AAA-004::quick::work-in-progress");

    expect(mocks.hasCommitsBeyond).toHaveBeenCalledWith("task/AAA-004", "main");
    expect(mocks.headCommitTitle).toHaveBeenCalledWith("task/AAA-004");
  });

  it("falls back to phase=spec when test/{ref} exists but spec/{ref} is not its ancestor (§3.5)", async () => {
    const { tools, mocks } = buildTools({
      // Both branches exist: test/AAA-006 forked from spec/AAA-006, which
      // was amended afterwards (so the ancestry check fails).
      branchExists: existsOnly("test/AAA-006", "spec/AAA-006"),
      isAncestor: vi.fn().mockResolvedValue(false),
      hasCommitsBeyond: vi.fn().mockResolvedValue(true),
      headCommitTitle: vi.fn().mockResolvedValue("AAA-006: revise interface"),
    });
    const cap = captureStdout();
    const code = await run(["node", "cli.js", "status", "--ref", "AAA-006"], tools);
    const stdout = cap.stdout();
    cap.restore();

    expect(code).toBe(0);
    // phase is `spec`, not `test`, even though test/AAA-006 exists.
    expect(stdout).toContain("Task::Phase::State AAA-006::spec::work-in-progress");

    // The fallback trigger is the failed ancestry check spec -> test.
    expect(mocks.isAncestor).toHaveBeenCalledWith("spec/AAA-006", "test/AAA-006");

    // State derivation ran against spec/AAA-006 and never against
    // test/AAA-006 — confirming test/{ref} genuinely wasn't consulted.
    expect(mocks.hasCommitsBeyond).toHaveBeenCalledWith("spec/AAA-006", "main");
    expect(mocks.hasCommitsBeyond).not.toHaveBeenCalledWith("test/AAA-006", expect.anything());
    expect(mocks.headCommitTitle).toHaveBeenCalledWith("spec/AAA-006");
    expect(mocks.headCommitTitle).not.toHaveBeenCalledWith("test/AAA-006");
  });

  it("reports branchMismatch true when currentBranch differs from the canonical branch (§3.6)", async () => {
    const { tools } = buildTools({
      branchExists: existsOnly("spec/AAA-007"),
      currentBranch: vi.fn().mockResolvedValue("build/XYZ-999"),
    });
    const cap = captureStdout();
    const code = await run(
      ["node", "cli.js", "status", "--ref", "AAA-007", "--json"],
      tools,
    );
    const stdout = cap.stdout();
    cap.restore();

    expect(code).toBe(0);
    const taskStatus = parseJsonStatus(stdout);
    expect(taskStatus.canonicalBranch).toBe("spec/AAA-007");
    expect(taskStatus.currentBranch).toBe("build/XYZ-999");
    expect(taskStatus.branchMismatch).toBe(true);
    expect(taskStatus.phase).toBe("spec");
    expect(taskStatus.state).toBe("not-started");
  });

  it("reports branchMismatch false when currentBranch matches the canonical branch (§3.6)", async () => {
    const { tools } = buildTools({
      branchExists: existsOnly("spec/AAA-001"),
      currentBranch: vi.fn().mockResolvedValue("spec/AAA-001"),
    });
    const cap = captureStdout();
    const code = await run(
      ["node", "cli.js", "status", "--ref", "AAA-001", "--json"],
      tools,
    );
    const stdout = cap.stdout();
    cap.restore();

    expect(code).toBe(0);
    const taskStatus = parseJsonStatus(stdout);
    expect(taskStatus.canonicalBranch).toBe("spec/AAA-001");
    expect(taskStatus.currentBranch).toBe("spec/AAA-001");
    expect(taskStatus.branchMismatch).toBe(false);
  });

  it("holds a WIP-marked head commit at work-in-progress, never ready? (§3.7)", async () => {
    const { tools, mocks } = buildTools({
      branchExists: existsOnly("spec/AAA-008"),
      hasCommitsBeyond: vi.fn().mockResolvedValue(true),
      headCommitTitle: vi.fn().mockResolvedValue("AAA-008: - WIP"),
    });
    const cap = captureStdout();
    const code = await run(["node", "cli.js", "status", "--ref", "AAA-008"], tools);
    const stdout = cap.stdout();
    cap.restore();

    expect(code).toBe(0);
    // Commits exist beyond main, but the head is WIP-marked — still
    // work-in-progress, not advanced to ready? (ready? is MAG-46-09's
    // scope, not resolved here).
    expect(stdout).toContain("Task::Phase::State AAA-008::spec::work-in-progress");

    expect(mocks.headCommitTitle).toHaveBeenCalledWith("spec/AAA-008");
  });
});
