/**
 * Command-level system tests for `pnpm task <ref> [--wip [title] [message]]
 * [--json]` — the `ref` switch command: `<ref>` derives `<ref>`'s current
 * canonical branch via the shared `deriveRepoState()` pipeline and checks it
 * out, optionally committing work in progress on the branch being left first
 * (task-MAG-46-17-switch-spec.md, LLD §3.13).
 *
 * Behaviors under test, per the spec:
 *   1. `<ref>` checks out the derived canonical branch for that ref,
 *      reporting the branch switched from/to (§3.1).
 *   2. `--wip [title] [message]` commits work in progress on the current
 *      branch BEFORE switching — `commitAll` precedes `checkout`, the SHA it
 *      resolves to is reported as `wipCommitSha`, and the switch still
 *      happens afterward (§3.2).
 *   3. A bare subcommand name is never misinterpreted as a ref — `pnpm task
 *      status` routes to `status`'s own handler, not the `<ref>` switch path,
 *      so no canonical branch is ever derived for a ref literally named
 *      `"status"` (§3.3).
 *   4. An invalid ref format is rejected before dispatch, exit 2, with no
 *      git action of any kind (§3.4).
 *   5. Without `--wip`, a switch that hits a real checkout conflict surfaces
 *      that conflict rather than silently discarding it or the uncommitted
 *      changes, and does not report the switch as complete (§3.5).
 *
 * Same in-process pattern as every prior chunk: `run(argv, tools)` is called
 * directly with an injected `ExternalTools` whose `git`/`github` members are
 * test doubles — no real git/gh/fs/gate-check anywhere. `checkout`/`commitAll`
 * are tracked (the assertions target them); every tool method that must not
 * be touched on the path under test is a throw-mock, so an over-reaching
 * implementation fails loudly in addition to failing the assertions.
 *
 * The default fixture encodes the §3.1/§3.2/§3.5 Given: `AAA-234`'s derived
 * canonical branch is `test/AAA-234` (the test branch exists locally, no
 * spec branch, no gate PR — merged or open — and commits beyond its parent),
 * while the caller sits on `task/AAA-123`.
 *
 * Fail-then-pass: `commands/task.ts`'s `ref()` is an untested placeholder
 * throwing `new Error("not implemented")` (spec 17 builds on open ground,
 * per the pre-sequencing review), so every invocation that routes to the
 * `ref` handler (§3.1/§3.2/§3.5) fails against the pre-implementation
 * codebase. §3.3/§3.4 exercise `cli.ts`'s pre-existing dispatch routing
 * (subcommand-vs-ref discrimination and the invalid-format exit-2 bucket)
 * and pass immediately — same precedent class as spec 13's malformed-JSON
 * case and spec 15's not-initialised post-condition.
 */

// Implements: task-MAG-46-17-switch-spec.md
// System behaviors: 3.1 (switch to another task's canonical branch), 3.2
//   (--wip commits before switching), 3.3 (subcommand names are never
//   treated as a ref), 3.4 (invalid ref format rejected before dispatch),
//   3.5 (a real checkout conflict is surfaced, not swallowed)
// Spec sections: §3.1, §3.2, §3.3, §3.4, §3.5, §2.1 (without --wip a switch
//   under uncommitted changes is allowed to proceed and can fail on a real
//   merge conflict)

import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { run } from "../../../../packages/task-phases/src/cli.js";
import type { ExternalTools } from "../../../../packages/task-phases/src/types.js";

/** A mock that fails the test loudly if the command under test calls a tool
 *  method that must not be touched on the path being exercised. */
function unexpected(method: string): Mock {
  return vi.fn().mockImplementation(() => {
    throw new Error(`unexpected call: ${method}`);
  });
}

/** A `branchExists` double reporting exactly the given branches as existing,
 *  in both the local and `{ remote: true }` namespaces — these scenarios
 *  never depend on the local/remote distinction. */
function existsOnly(...branches: string[]): Mock {
  return vi.fn().mockImplementation((name: string) => branches.includes(name));
}

/** The SHA `git.commitAll` resolves to in the §3.2 fixture. */
const WIP_SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";

interface MockSet {
  tools: ExternalTools;
  mocks: {
    fetch: Mock;
    currentBranch: Mock;
    branchExists: Mock;
    hasCommitsBeyond: Mock;
    headCommitTitle: Mock;
    isDirty: Mock;
    checkout: Mock;
    commitAll: Mock;
    findMergedPR: Mock;
    findOpenPR: Mock;
  };
}

/**
 * Builds a full `ExternalTools` test double for the `ref` switch path.
 * Defaults encode the §3.1 Given: `AAA-234` derives `phase: "test"` with
 * canonical branch `test/AAA-234` (`test/AAA-234` exists locally, no
 * `spec/AAA-234`, no gate PR — merged or open — and it has commits beyond
 * its parent with a non-WIP head), the caller sits on `task/AAA-123`, the
 * worktree is clean, and both `checkout` and `commitAll` resolve cleanly.
 *
 * Every other tool method is a throw-mock: `ref` is a derivation-read plus
 * at most `isDirty`/`commitAll`/`checkout` — nothing else on `git`,
 * `github`, `gateChecks` or `fileSystem` may be touched.
 */
function buildTools(
  overrides: {
    currentBranch?: Mock;
    branches?: string[];
    hasCommitsBeyond?: Mock;
    headCommitTitle?: Mock;
    isDirty?: Mock;
    checkout?: Mock;
    commitAll?: Mock;
    findMergedPR?: Mock;
    findOpenPR?: Mock;
  } = {},
): MockSet {
  const fetch = vi.fn().mockResolvedValue(undefined);
  const currentBranch = overrides.currentBranch ?? vi.fn().mockResolvedValue("task/AAA-123");
  const branchExists = existsOnly(...(overrides.branches ?? ["test/AAA-234"]));
  const hasCommitsBeyond = overrides.hasCommitsBeyond ?? vi.fn().mockResolvedValue(true);
  const headCommitTitle =
    overrides.headCommitTitle ?? vi.fn().mockResolvedValue("AAA-234: add switch tests");
  const isDirty = overrides.isDirty ?? vi.fn().mockResolvedValue(false);
  const checkout = overrides.checkout ?? vi.fn().mockResolvedValue(undefined);
  const commitAll = overrides.commitAll ?? vi.fn().mockResolvedValue(WIP_SHA);
  const findMergedPR = overrides.findMergedPR ?? vi.fn().mockResolvedValue(null);
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
      isDirty,
      isAncestor: unexpected("isAncestor"),
      createBranch: unexpected("createBranch"),
      createRemoteBranch: unexpected("createRemoteBranch"),
      checkout,
      commitAll,
      push: vi.fn().mockResolvedValue(undefined),
      pullFastForward: unexpected("pullFastForward"),
      rebase: unexpected("rebase"),
      deleteBranch: unexpected("deleteBranch"),
      listBranches: unexpected("listBranches"),
      changedFiles: unexpected("changedFiles"),
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

  return {
    tools,
    mocks: {
      fetch,
      currentBranch,
      branchExists,
      hasCommitsBeyond,
      headCommitTitle,
      isDirty,
      checkout,
      commitAll,
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

/** The `result` shape serialised under the `--json` doc for a `ref` run —
 *  the base `TaskPhasingCommandResult` fields plus `switchedFrom`/
 *  `switchedTo`/`wipCommitSha`. Every field is optional: the exit-1
 *  error path (writeCommandError) serialises a bare failure result with
 *  none of the command-specific fields. */
interface JsonRefDoc {
  command: string;
  success?: boolean;
  result: {
    success?: boolean;
    switchedFrom?: string | null;
    switchedTo?: string;
    wipCommitSha?: string;
  };
}

/** Parses the single JSON document a `--json` `ref` run emits. */
function parseJson(stdout: string): JsonRefDoc {
  const lines = stdout.trim().split("\n");
  return JSON.parse(lines[lines.length - 1]) as JsonRefDoc;
}

/** Runs an in-process `task <ref> ...` invocation to completion. */
async function runRef(
  tools: ExternalTools,
  tokens: string[],
): Promise<{ code: number; stdout: string; doc: JsonRefDoc }> {
  const cap = captureStdout();
  const code = await run(["node", "cli.js", ...tokens], tools);
  const stdout = cap.stdout();
  cap.restore();
  return { code, stdout, doc: parseJson(stdout) };
}

describe("task <ref>: switches to another task's canonical branch (§3.1)", () => {
  it("derives AAA-234's canonical branch and checks it out, reporting the switch", async () => {
    const { tools, mocks } = buildTools();
    const { code, doc } = await runRef(tools, ["AAA-234", "--json"]);

    // A successful switch is exit 0, routed through the `ref` handler —
    // `pnpm task AAA-234` is never misinterpreted as a subcommand named
    // "AAA-234" (the §3 top-level "vice versa" of §3.3).
    expect(code).toBe(0);
    expect(doc.command).toBe("ref");
    expect(doc.success).toBe(true);

    // The canonical branch came from the shared derivation pipeline
    // (deriveRepoState), not a fresh lookup — the same branch-exists/PR
    // mocks `status`/`promote`/`list` all drive.
    expect(mocks.checkout).toHaveBeenCalledWith("test/AAA-234");

    // The RefCommandResult reports the branch switched from and to.
    expect(doc.result.switchedFrom).toBe("task/AAA-123");
    expect(doc.result.switchedTo).toBe("test/AAA-234");

    // The derivation read fresh state first, matching every other command
    // that runs the pipeline (§1 — deriveRepoState's own contract requires
    // callers to fetch first).
    expect(mocks.fetch).toHaveBeenCalled();

    // A clean worktree with no `--wip` commits nothing.
    expect(mocks.commitAll).not.toHaveBeenCalled();
  });
});

describe("task <ref> --wip: commits before switching (§3.2)", () => {
  it("commits WIP on the current branch first, reports the SHA, and still switches", async () => {
    const { tools, mocks } = buildTools({
      isDirty: vi.fn().mockResolvedValue(true),
    });
    const { code, doc } = await runRef(tools, ["AAA-234", "--wip", "pausing here", "--json"]);

    expect(code).toBe(0);
    expect(doc.result.success).toBe(true);

    // The WIP commit happened BEFORE the checkout — commitAll precedes
    // checkout, never after.
    expect(mocks.commitAll).toHaveBeenCalled();
    expect(mocks.checkout).toHaveBeenCalledWith("test/AAA-234");
    expect(mocks.commitAll.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.checkout.mock.invocationCallOrder[0],
    );

    // The --wip title is actually used in the commit.
    expect(mocks.commitAll.mock.calls[0][0] as string).toContain("pausing here");

    // The result carries the SHA commitAll resolved to.
    expect(doc.result.wipCommitSha).toBe(WIP_SHA);

    // The switch to the derived canonical branch still happened.
    expect(doc.result.switchedFrom).toBe("task/AAA-123");
    expect(doc.result.switchedTo).toBe("test/AAA-234");
  });
});

describe("task: subcommand names are never treated as a ref (§3.3)", () => {
  it("routes `pnpm task status` to status's own handler, never the ref switch path", async () => {
    const { tools } = buildTools({
      // The caller sits on `main` — no task ref is derivable from it, so
      // status's own not-initialised base case runs. checkout is a
      // throw-mock: the ref switch path is the only code that ever calls
      // it, so any misrouting of the `status` token fails loudly.
      currentBranch: vi.fn().mockResolvedValue("main"),
      checkout: unexpected("checkout"),
    });
    const cap = captureStdout();
    const code = await run(["node", "cli.js", "status", "--json"], tools);
    const stdout = cap.stdout();
    cap.restore();

    // status's own handler ran — the doc's command field is `status`, and
    // the invocation succeeded (exit 0). Had the `status` token been
    // misrouted to the `<ref>` switch path, no canonical branch would be
    // derivable for a ref literally named "status" — and with the
    // placeholder implementation that path throws "not implemented".
    expect(code).toBe(0);
    const doc = parseJson(stdout);
    expect(doc.command).toBe("status");
    expect(doc.success).toBe(true);
  });
});

describe("task: an invalid ref format is rejected before dispatch (§3.4)", () => {
  it("rejects `not-a-valid-ref` with exit 2 and no git action", async () => {
    const { tools, mocks } = buildTools();
    const cap = captureStdout();
    const code = await run(["node", "cli.js", "not-a-valid-ref"], tools);
    const stdout = cap.stdout();
    cap.restore();

    // `not-a-valid-ref` fails TaskRef's /^[A-Z]+-[0-9]+$/ pattern, so it
    // is neither a subcommand name nor a ref — rejected before any command
    // logic (and any git action) runs.
    expect(code).toBe(2);
    expect(stdout).toContain("Unknown command");
    expect(stdout).toContain("not-a-valid-ref");
    expect(mocks.checkout).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

describe("task <ref>: a real checkout conflict is surfaced, not swallowed (§3.5)", () => {
  it("reports the conflict and does not claim the switch completed when no --wip was given", async () => {
    // Given: dirty worktree, no --wip, and checkout rejects with git's own
    // merge-conflict wording — uncommitted changes on task/AAA-123 collide
    // with test/AAA-234's content. Per §2.1, without --wip the switch is
    // allowed to proceed and may fail on the real conflict — no bespoke
    // blocking logic, but no silent discarding either.
    const { tools, mocks } = buildTools({
      isDirty: vi.fn().mockResolvedValue(true),
      checkout: vi
        .fn()
        .mockRejectedValue(
          new Error(
            "error: Your local changes to the following files would be overwritten by checkout:\n\tpackages/a/lib.ts\nPlease commit your changes or stash them before you switch branches.",
          ),
        ),
    });
    const { code, stdout, doc } = await runRef(tools, ["AAA-234", "--json"]);

    // A failed switch is exit 1.
    expect(code).toBe(1);

    // No --wip was given, so no commit was attempted — the conflict is the
    // uncommitted work's own, not something WIP was meant to pack away.
    expect(mocks.commitAll).not.toHaveBeenCalled();

    // The real conflict error is surfaced in the output — git's own
    // wording, not reworded into a generic failure.
    expect(stdout).toContain("would be overwritten by checkout");

    // The switch did not actually complete, so it is not reported as such.
    expect(doc.result.switchedTo ?? "").not.toBe("test/AAA-234");
  });
});
