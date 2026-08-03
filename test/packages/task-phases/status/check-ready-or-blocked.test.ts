/**
 * Command-level system tests for `pnpm task status [--ref <ref>] [--check]`
 * making `ready?` reachable and resolvable — extending the §3.2 derivation
 * with the `ready?`/`ready`/`blocked` branch (task-MAG-46-09-status-check-
 * ready-or-blocked-spec.md, LLD §3.2/§3.9).
 *
 * Three distinct changes are under test, kept separate per §2.1:
 *   1. `lib/repo-state.ts`'s `deriveState()` WIP-marker check — a phase
 *      branch with commits and a non-`WIP` head reports `ready?` instead of
 *      `work-in-progress` (§3.1, §3.7), while a `WIP`-marked head stays
 *      `work-in-progress` (§3.5).
 *   2. `status.ts`'s `--check` opt-in: runs `gateChecks.run(status.phase,
 *      {ref})` only when the derived state is `ready?`, and reshapes the
 *      result into `ready`/`blocked` (§3.2, §3.3, §3.7).
 *   3. The `--ref <other> --check` refusal: `--check` is only valid when
 *      `<ref>` names the currently checked-out task. A mismatch is a
 *      `success: false` failure (exit 1), not a crash — the `taskStatus`
 *      for `<ref>` is still fully derived (§3.4, LLD §3.9).
 *
 * Same in-process pattern as specs 04/06/06.01: `run(argv, tools)` is
 * called directly with an injected `ExternalTools` test double — no real
 * git/gh/fs/gate-check anywhere. `gateChecks.run` is a real double
 * (resolves to a fixed `GateCheckResult`), and every derivation-relevant
 * `git`/`github` interaction is asserted explicitly. §3.6 (the pure
 * pass-through guard on `resolveReady` — the guarantee `promote` will
 * depend on) is direct unit coverage via a lazy dynamic import, since the
 * function does not exist in the pre-implementation codebase and so cannot
 * be a top-level named import without aborting module load.
 *
 * Every one of these tests fails against the pre-implementation codebase:
 * `deriveState()` currently returns `"work-in-progress"` for any branch
 * with commits (the `ready?` state is unreachable), `status.ts` has no
 * `--check` handling, and `resolveReady` doesn't exist yet — so `ready` /
 * `blocked` / `checked` / `checkRefused` can't be produced. The §3.5
 * WIP-marked branch already reads `work-in-progress`, but its `--check`
 * negative assertion fails anyway (there is no `--check` yet). The rest of
 * the file is a regression guard once implementation lands.
 */

// Implements: task-MAG-46-09-status-check-ready-or-blocked-spec.md
// System behaviors: 1.5.4, 1.5.5

import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { run } from "../../../../packages/task-phases/src/cli.js";
import type {
  ExternalTools,
  GateCheckResult,
  TaskStatus,
} from "../../../../packages/task-phases/src/types.js";

/** A mock that fails the test loudly if the command under test calls a tool
 *  method that must not be touched on the `ready?` path. */
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

/** A fully-shaped `GateCheckResult` with the given overrides folded in. */
function gateCheckResult(overrides: Partial<GateCheckResult> = {}): GateCheckResult {
  return {
    check: "build-gate",
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

/** The suite's `ExternalTools` fixture plus the individual test doubles. */
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
 * Builds a full `ExternalTools` test double for the `ready?`-resolution
 * path. Defaults configure the regular-route §3.1 fixture: `test/AAA-001`
 * exists, `spec/AAA-001` is its ancestor (not stale), it has commits
 * beyond its parent and a non-WIP head, so the pipeline derives
 * `phase: "test"`, `state: "ready?"`. `currentBranch` defaults to the
 * canonical branch. No PR (merged or open) ever raised. `gateChecks.run`
 * resolves a passing result. Every other tool method throws if called.
 */
function buildTools(
  overrides: {
    branchExists?: Mock;
    currentBranch?: Mock;
    hasCommitsBeyond?: Mock;
    headCommitTitle?: Mock;
    isAncestor?: Mock;
    findMergedPR?: Mock;
    findOpenPR?: Mock;
    gateRun?: Mock;
  } = {},
): MockSet {
  const fetch = vi.fn().mockResolvedValue(undefined);
  const currentBranch = overrides.currentBranch ?? vi.fn().mockResolvedValue("test/AAA-001");
  const branchExists = overrides.branchExists ?? existsOnly("test/AAA-001");
  const hasCommitsBeyond = overrides.hasCommitsBeyond ?? vi.fn().mockResolvedValue(true);
  const headCommitTitle = overrides.headCommitTitle ?? vi.fn().mockResolvedValue("AAA-001: add tests");
  const isAncestor = overrides.isAncestor ?? vi.fn().mockResolvedValue(true);
  const findMergedPR = overrides.findMergedPR ?? vi.fn().mockResolvedValue(null);
  const findMergedPRs = vi.fn().mockResolvedValue([]);
  const findOpenPR = overrides.findOpenPR ?? vi.fn().mockResolvedValue(null);
  const runGate = overrides.gateRun ?? gateRun({ passed: true, check: "build-gate" });

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
      findMergedPR,
      findOpenPR,
      gateRun: runGate,
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

/** Runs an in-process `status` invocation to completion and captures its
 *  stdout. `tail` is everything after the leading `["node","cli.js"]`. */
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
): {
  success: boolean;
  result: { checked?: boolean; checkRefused?: boolean; taskStatus: TaskStatus };
} {
  const lines = stdout.trim().split("\n");
  const doc = JSON.parse(lines[lines.length - 1]) as {
    success: boolean;
    result: { checked?: boolean; checkRefused?: boolean; taskStatus: TaskStatus };
  };
  return doc;
}

describe("status: ready? / ready / blocked resolution", () => {
  it("leaves ready? unresolved on a plain read, never calling gateChecks.run (§3.1)", async () => {
    const { tools, mocks } = buildTools();
    const { code, stdout } = await runStatus(["status", "--ref", "AAA-001"], tools);

    expect(code).toBe(0);
    expect(stdout).toContain("Task::Phase::State AAA-001::test::ready?");

    // fetch runs unconditionally first (§1.1).
    expect(mocks.fetch).toHaveBeenCalledTimes(1);

    // The derivation consulted the test branch's commit graph and head.
    expect(mocks.hasCommitsBeyond).toHaveBeenCalledWith("test/AAA-001", expect.anything());
    expect(mocks.headCommitTitle).toHaveBeenCalledWith("test/AAA-001");

    // A plain read never resolves ready? — gateChecks.run is not reached.
    expect(mocks.gateRun).not.toHaveBeenCalled();
  });

  it("resolves ready? to ready via --check, passing the exact derived phase and ref to gateChecks.run (§3.2)", async () => {
    const { tools, mocks } = buildTools({
      gateRun: gateRun({ passed: true, check: "build-gate" }),
    });
    const { code, stdout } = await runStatus(
      ["status", "--ref", "AAA-001", "--check", "--json"],
      tools,
    );

    expect(code).toBe(0);
    expect(stdout).toContain("Task::Phase::State AAA-001::test::ready");
    expect(stdout).not.toContain("::ready?");

    // gateChecks.run was called with the derived phase (test), not a
    // guessed one, and the ref in args (§2.1).
    expect(mocks.gateRun).toHaveBeenCalledTimes(1);
    expect(mocks.gateRun).toHaveBeenCalledWith("test", { ref: "AAA-001" });

    // The --json result reports checked: true and success.
    const json = parseJson(stdout);
    expect(json.success).toBe(true);
    expect(json.result.checked).toBe(true);
  });

  it("resolves ready? to blocked via --check, surfacing the gate's own violation verbatim (§3.3)", async () => {
    const { tools, mocks } = buildTools({
      gateRun: gateRun({
        passed: false,
        violations: ["commit title must start with AAA-001"],
      }),
    });
    const { code, stdout } = await runStatus(["status", "--ref", "AAA-001", "--check"], tools);

    // A successfully-resolved `blocked` read is a successful status run —
    // exit 0, distinct from the §3.4 refusal.
    expect(code).toBe(0);
    expect(stdout).toContain("Task::Phase::State AAA-001::test::blocked");

    // The gate's own violation message is surfaced verbatim, not reworded.
    expect(stdout).toContain("commit title must start with AAA-001");

    expect(mocks.gateRun).toHaveBeenCalledTimes(1);
    expect(mocks.gateRun).toHaveBeenCalledWith("test", { ref: "AAA-001" });
  });

  it("refuses --ref <other> --check without calling gateChecks.run (§3.4)", async () => {
    const { tools, mocks } = buildTools({
      currentBranch: vi.fn().mockResolvedValue("test/AAA-001"),
      branchExists: existsOnly("test/ABC-789"),
    });
    const { code, stdout } = await runStatus(
      ["status", "--check", "--json", "--ref", "ABC-789"],
      tools,
    );

    // A refusal is a failure (exit 1), not a crash.
    expect(code).toBe(1);

    // gateChecks.run never consulted.
    expect(mocks.gateRun).not.toHaveBeenCalled();

    // The message states --check requires ABC-789 to be the checked-out task.
    expect(stdout).toContain("ABC-789");
    expect(stdout).toMatch(/check/i);

    // The result still carries success:false and a fully derived taskStatus
    // for ABC-789, only with ready? left unresolved.
    const json = parseJson(stdout);
    expect(json.success).toBe(false);
    expect(json.result.checkRefused).toBe(true);
    expect(json.result.taskStatus).toBeDefined();
  });

  it("holds a WIP-marked head at work-in-progress, and --check still does not resolve it (§3.5)", async () => {
    const { tools, mocks } = buildTools({
      hasCommitsBeyond: vi.fn().mockResolvedValue(true),
      headCommitTitle: vi.fn().mockResolvedValue("AAA-001: quick fix - WIP"),
    });

    // Plain read: still work-in-progress, never ready?.
    const { code: code1, stdout: stdout1 } = await runStatus(
      ["status", "--ref", "AAA-001"],
      tools,
    );
    expect(code1).toBe(0);
    expect(stdout1).toContain("Task::Phase::State AAA-001::test::work-in-progress");
    expect(stdout1).not.toContain("ready");

    // --check: still work-in-progress, gateChecks.run not consulted.
    const { code: code2, stdout: stdout2 } = await runStatus(
      ["status", "--ref", "AAA-001", "--check"],
      tools,
    );
    expect(code2).toBe(0);
    expect(stdout2).toContain("Task::Phase::State AAA-001::test::work-in-progress");
    expect(stdout2).not.toContain("ready");
    expect(mocks.gateRun).not.toHaveBeenCalled();
  });

  it("returns a non-ready? TaskStatus unchanged from resolveReady, without calling gateChecks.run (§3.6)", async () => {
    // Lazy dynamic import because resolveReady does not exist in the
    // pre-implementation lib — a top-level named import would abort module
    // load for every test in this file.
    const { resolveReady } = await import(
      "../../../../packages/task-phases/src/lib/repo-state.js"
    );

    const { tools, mocks } = buildTools();
    const status: TaskStatus = {
      ref: "AAA-001",
      phase: "test",
      canonicalBranch: "test/AAA-001",
      currentBranch: "test/AAA-001",
      branchMismatch: false,
      state: "work-in-progress",
    };

    const result = await resolveReady(tools, status);

    // Pure pass-through: the exact same object comes back.
    expect(result).toBe(status);
    expect(mocks.gateRun).not.toHaveBeenCalled();
  });

  it("resolves ready? to ready/blocked on the quick route with phase quick (§3.7)", async () => {
    const { tools, mocks } = buildTools({
      currentBranch: vi.fn().mockResolvedValue("task/AAA-234"),
      branchExists: existsOnly("task/AAA-234"),
      hasCommitsBeyond: vi.fn().mockResolvedValue(true),
      headCommitTitle: vi.fn().mockResolvedValue("AAA-234: quick fix"),
      gateRun: gateRun({ passed: true, check: "main-gate" }),
    });

    // Plain read: phase quick, ready? unresolved, gate not consulted.
    const { stdout: stdout1 } = await runStatus(["status", "--ref", "AAA-234"], tools);
    expect(stdout1).toContain("Task::Phase::State AAA-234::quick::ready?");
    expect(mocks.gateRun).not.toHaveBeenCalled();

    // --check resolves to ready, passing phase "quick".
    const { stdout: stdout2 } = await runStatus(["status", "--ref", "AAA-234", "--check"], tools);
    expect(stdout2).toContain("Task::Phase::State AAA-234::quick::ready");
    expect(mocks.gateRun).toHaveBeenCalledTimes(1);
    expect(mocks.gateRun).toHaveBeenCalledWith("quick", { ref: "AAA-234" });

    // Same call resolved against a failing gate -> blocked.
    const failingTools = {
      ...tools,
      gateChecks: { run: gateRun({ passed: false, violations: ["task doc missing"] }) },
    } as unknown as ExternalTools;
    const { stdout: stdout3 } = await runStatus(
      ["status", "--ref", "AAA-234", "--check"],
      failingTools,
    );
    expect(stdout3).toContain("Task::Phase::State AAA-234::quick::blocked");
  });
});