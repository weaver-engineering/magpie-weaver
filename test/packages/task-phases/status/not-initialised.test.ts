/**
 * Command-level system tests for `pnpm task status` reporting
 * `not-initialised` — the base case of the §3.2 derivation pipeline
 * (task-MAG-46-04-dev-testing-status-not-initialised-spec.md, LLD §3.9).
 *
 * Unlike the real-world execution specs (01–03), this chunk is exercised
 * in-process: `run(argv, tools)` is called directly with an injected
 * `ExternalTools` whose `git`/`github` members are test doubles — no real
 * git/gh/fs calls anywhere. Every interaction with `ExternalTools` is
 * asserted explicitly (Guard Rails), including `git.fetch()` being called
 * unconditionally before any derivation (§2.1).
 *
 * Also proves the `cli.ts` exit-code contract (§4.1) as a cross-cutting
 * property: `0` iff `success === true`, `1` for every other unsuccessful
 * result, `2` for invalid-argument errors caught before command logic runs.
 */

// Implements: task-MAG-46-04-status-not-initialised-spec.md

import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { run } from "../../../../packages/task-phases/src/cli.js";
import type { ExternalTools } from "../../../../packages/task-phases/src/types.js";

const REF = "AAA-001";

/** A mock that fails the test loudly if the command under test calls a tool
 * method it must not touch in the not-initialised path. */
function unexpected(method: string): Mock {
  return vi.fn().mockImplementation(() => {
    throw new Error(`unexpected call: ${method}`);
  });
}

interface MockSet {
  tools: ExternalTools;
  mocks: {
    fetch: Mock;
    currentBranch: Mock;
    branchExists: Mock;
    findMergedPR: Mock;
    findOpenPR: Mock;
  };
}

/** Builds a full `ExternalTools` test double. Defaults: fetch resolves,
 * currentBranch "main", branchExists false for everything; every other tool
 * method throws if called. */
function buildTools(
  overrides: { fetch?: Mock; currentBranch?: Mock; branchExists?: Mock } = {},
): MockSet {
  const fetch = overrides.fetch ?? vi.fn().mockResolvedValue(undefined);
  const currentBranch = overrides.currentBranch ?? vi.fn().mockResolvedValue("main");
  const branchExists = overrides.branchExists ?? vi.fn().mockResolvedValue(false);
  const findMergedPR = unexpected("findMergedPR");
  const findOpenPR = unexpected("findOpenPR");

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
    },
    github: {
      createPR: unexpected("createPR"),
      findMergedPRs: unexpected("findMergedPRs"),
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

  return { tools, mocks: { fetch, currentBranch, branchExists, findMergedPR, findOpenPR } };
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

describe("status: not-initialised", () => {
  it("reports not-initialised when no branch of any kind exists (§3.1)", async () => {
    const { tools, mocks } = buildTools();
    const cap = captureStdout();
    const code = await run(["node", "cli.js", "status", "--ref", REF], tools);
    const stdout = cap.stdout();
    cap.restore();

    expect(code).toBe(0);

    // Human-readable report: ref::phase::state with null phase shown as `-`
    expect(stdout).toContain(`Task::Phase::State ${REF}::-::not-initialised`);

    // `git.fetch()` is called unconditionally, exactly once, before any
    // derivation (§2.1) — its result isn't even needed here.
    expect(mocks.fetch).toHaveBeenCalledTimes(1);

    // Every phase branch is checked, local and remote, and all are absent.
    for (const name of [`spec/${REF}`, `test/${REF}`, `build/${REF}`, `task/${REF}`]) {
      expect(mocks.branchExists).toHaveBeenCalledWith(name);
      expect(mocks.branchExists).toHaveBeenCalledWith(name, { remote: true });
    }

    // With no branch of any kind there is nothing to check a PR for.
    expect(mocks.findMergedPR).not.toHaveBeenCalled();
    expect(mocks.findOpenPR).not.toHaveBeenCalled();
  });

  it("reports not-initialised from the checked-out branch when no ref is derivable (§3.2)", async () => {
    const { tools, mocks } = buildTools({ currentBranch: vi.fn().mockResolvedValue("main") });
    const cap = captureStdout();
    const code = await run(["node", "cli.js", "status"], tools);
    const stdout = cap.stdout();
    cap.restore();

    expect(code).toBe(0);

    // No ref can be derived from `main` itself — both ref and phase render
    // as `-`; no attempt is made to treat `main` as a task ref.
    expect(stdout).toContain("Task::Phase::State -::-::not-initialised");

    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.currentBranch).toHaveBeenCalled();
    expect(mocks.findMergedPR).not.toHaveBeenCalled();
    expect(mocks.findOpenPR).not.toHaveBeenCalled();
  });

  it("emits a single JSON document with taskStatus and top-level success (§3.3)", async () => {
    const { tools } = buildTools();
    const cap = captureStdout();
    const code = await run(["node", "cli.js", "status", "--ref", REF, "--json"], tools);
    const stdout = cap.stdout();
    cap.restore();

    expect(code).toBe(0);

    // One JSON document and nothing else — no human-readable prose mixed in.
    const lines = stdout.trim().split("\n");
    expect(lines).toHaveLength(1);

    const doc = JSON.parse(lines[0]) as {
      result: { taskStatus: { ref: string; phase: string | null; state: string } };
      success: boolean;
    };
    expect(doc.result.taskStatus.ref).toBe(REF);
    expect(doc.result.taskStatus.phase).toBeNull();
    expect(doc.result.taskStatus.state).toBe("not-initialised");
    expect(doc.success).toBe(true);
  });
});

describe("exit code is a strict, mechanical function of success (LLD §4.1)", () => {
  it("exits 0 when the command result has success: true (§3.4)", async () => {
    // Reusing the §3.1 fixture: a successful not-initialised read.
    const { tools } = buildTools();
    const code = await run(["node", "cli.js", "status", "--ref", REF], tools);
    expect(code).toBe(0);
  });

  it("exits 1 for every other unsuccessful result — ran but didn't deliver (§3.4)", async () => {
    // A blocked/refused-style outcome: the unconditional fetch fails, so the
    // command cannot answer authoritatively. Command logic still ran (fetch
    // was reached), which is what distinguishes this from the exit-2 case.
    const { tools, mocks } = buildTools({
      fetch: vi.fn().mockRejectedValue(new Error("fetch failed")),
    });
    const code = await run(["node", "cli.js", "status", "--ref", REF], tools);
    expect(code).toBe(1);
    expect(mocks.fetch).toHaveBeenCalled();
  });

  it("exits 2 for an invalid argument caught before any command logic runs (§3.4)", async () => {
    const { tools, mocks } = buildTools();
    const cap = captureStdout();
    const code = await run(["node", "cli.js", "not-a-command"], tools);
    const stdout = cap.stdout();
    cap.restore();

    expect(code).toBe(2);
    expect(stdout).toContain("Unknown command");

    // The unrecognised command never reached any tool interaction — this is
    // the "never validly ran at all" bucket, distinct from the exit-1 case.
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
