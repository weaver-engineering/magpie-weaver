/**
 * Command-level system tests for `pnpm task status [--ref <ref>]` deriving
 * `phase: "build", state: "merged-pending-pull"` once `github.findMergedPR`
 * confirms the Build Gate PR (`test/{ref}` -> `build/{ref}`) merged but
 * local `build/{ref}` doesn't yet reflect it (task-MAG-46-12-status-merged-
 * pending-pull-spec.md, LLD §3.2).
 *
 * Four behaviors under test, kept separate per §3.1-§3.4:
 *   1. Merged Build Gate PR + no local `build/{ref}` at all -> phase
 *      `build`, state `merged-pending-pull` (§3.1).
 *   2. Merged Build Gate PR + local `build/{ref}` behind
 *      `origin/build/{ref}` -> phase `build`, state `merged-pending-pull`
 *      (§3.2).
 *   3. Merged Build Gate PR + local `build/{ref}` already caught up with
 *      `origin/build/{ref}` -> **not** `merged-pending-pull`; the state
 *      falls through to MAG-46-06's ordinary derivation (not-started /
 *      work-in-progress / ready?) applied to the build phase (§3.3).
 *   4. Merged Build Gate PR + local `build/{ref}` carrying its own commit
 *      AND `origin/build/{ref}` independently advanced past the same fork
 *      point -> genuine divergence: falls through to the ordinary
 *      derivation same as §3.3, but *also* surfaces `taskStatus.rebase`
 *      as a build-phase trunk-drift trigger (§3.4, MAG-49 task/MAG-49
 *      prerequisite — new behavior, not previously derivable at all).
 *
 * Two §2.1 contracts asserted explicitly:
 *   - The derivation compares `test/{ref}`'s current HEAD against the
 *     merged PR's recorded `headRefOid` — `git.headSha("origin/test/{ref}")`
 *     is read and compared, not just "a merged PR exists". This is what
 *     distinguishes an ordinary merge from the superseded-merge case (§3.5,
 *     MAG-46-13/14's concern, not this one's).
 *   - `status` only ever *reports* this state, never resolves it: no
 *     `git.pullFastForward`/`git.rebase`/`git.checkout` call happens
 *     anywhere in these scenarios (resolving is `promote`-only, MAG-46-14).
 *
 * **Correction (architect fix, build-phase review):** the `headSha` calls
 * below originally used the bare local form (`"test/{ref}"`), matching
 * what the first build-commit attempt actually called. Real e2e testing
 * against a genuinely merged PR (disposable ref, fresh clone with no
 * local `test/{ref}` branch — exactly what `fetch()` alone produces)
 * crashed for real: `fetch()` only ever updates the remote-tracking ref,
 * never creates or checks out a local branch, so nothing guarantees
 * `test/{ref}` exists locally. Corrected to `origin/test/{ref}` — the
 * same reasoning already applied to `build/{ref}` vs `origin/build/{ref}`
 * in these same scenarios, and to `origin/main` in the trunk-drift check
 * elsewhere in this file's production code. Mocked tests alone could not
 * have caught this: the mock was internally consistent with the
 * (buggy) implementation it was written against, which is exactly what
 * this project's e2e-testing discipline exists to catch.
 *
 * Same in-process pattern as every prior chunk: `run(argv, tools)` is
 * called directly with an injected `ExternalTools` whose `git`/`github`
 * members are test doubles — no real git/gh/fs/gate-check anywhere. Every
 * mutating tool method is a throw-mock so that "no action taken" is
 * enforced structurally, not merely asserted. `hasCommitsBeyond`/
 * `headCommitTitle` are resolving mocks — never called in the two
 * merged-pending-pull cases (PR-driven derivation, the branch-exists chain
 * is never reached), and consulted for §3.3's fall-through to the ordinary
 * build-phase derivation.
 *
 * Every one of these tests fails against the pre-implementation codebase:
 * `lib/repo-state.ts`'s `derivePrState` still throws "not implemented" the
 * moment a merged PR is found on the Build Gate pair (spec 06.01's
 * unconditional gate-PR deferral, replaced for this pair by this chunk per
 * §2.1), so `status` cannot yet report `merged-pending-pull` — it exits 1
 * with "not implemented" instead. (The still-deferred merged Main Gate
 * pairs remain in defers-when-gate-pr-exists.test.ts, owned by MAG-46-15.)
 *
 * **Correction (architect fix, task/MAG-49 prerequisite):** §3.2's
 * local-behind-origin distinction was originally driven by a plain
 * `headSha` inequality, which cannot tell "local trails origin" apart from
 * "local carries its own commit(s) beyond origin" — a distinction that
 * didn't matter until MAG-49 introduced the second case (build-implementer
 * committing straight to `build/{ref}`). `derivePrState` now resolves the
 * direction via `git.isAncestor`, so §3.2's fixture needs an `isAncestor`
 * double that actually represents "behind" (origin not reachable from
 * local, local reachable from origin) rather than the file's prior
 * unconditional-`true` default, which happened to be irrelevant only
 * because nothing consulted it yet. §3.1 and §3.3 are unaffected: §3.1
 * never reaches the branch (no local `build/{ref}` at all), and §3.3's
 * "caught up" scenario is still correctly `true` under the default (an
 * equal SHA is its own ancestor). See task-MAG-49.md §3 correction for the
 * full derivation and why the equality check made `build::ready`
 * unreachable.
 *
 * §3.4 is new coverage, not a fixture correction: genuine build-phase
 * trunk drift (`taskStatus.rebase` populated for `phase: "build"`) was
 * not derivable *at all* before the same fix — `derivePrState`'s old
 * equality check had no way to distinguish "diverged" from "behind", so
 * every scenario that should surface drift instead reported
 * `merged-pending-pull`. Added as a system-level `status` test (not a
 * unit test reaching for line coverage) because the observable contract
 * that matters is `taskStatus.rebase`'s shape through the real CLI
 * dispatch path, the same thing §3.1-§3.3 already assert on.
 */

// Implements: task-MAG-46-12-status-merged-pending-pull-spec.md
// System behaviors: 1.5.7 (merged-pending-pull), 3.9 (report
//   merged-pending-pull read-only — no action taken)
// Spec sections: §3.1, §3.2, §3.3

import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { run } from "../../../../packages/task-phases/src/cli.js";
import type {
  ExternalTools,
  MergedPullRequestSummary,
  TaskStatus,
} from "../../../../packages/task-phases/src/types.js";

/** A mock that fails the test loudly if the command under test calls a tool
 *  method that must not be touched on the merged-pending-pull read path. */
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

/** A `branchExists` double for §3.1's local/remote distinction: `build/{ref}`
 *  exists on origin (the merged PR landed there) but not locally, while the
 *  spec/test branches exist in both forms. */
function buildAbsentLocally(ref: string): Mock {
  return vi.fn().mockImplementation((name: string, opts?: { remote?: boolean }) => {
    if (name === `build/${ref}`) {
      return opts?.remote === true;
    }
    return name === `spec/${ref}` || name === `test/${ref}`;
  });
}

/** A `headSha` double returning a value for exactly the given branches and
 *  failing the test loudly for any other — enforces that the implementation
 *  only consults the HEADs the spec's Given clauses set up. */
function headShaFor(map: Record<string, string>): Mock {
  return vi.fn().mockImplementation((branch: string) => {
    if (!(branch in map)) {
      throw new Error(`unexpected headSha call: ${branch}`);
    }
    return map[branch];
  });
}

/** An `isAncestor` double resolving `true` for exactly the given
 *  (ancestor, descendant) pairs and `false` for everything else — the
 *  MAG-49 correction's direction-sensitive replacement for the file's
 *  former unconditional-`true` default, needed wherever a scenario must
 *  represent a genuine "local behind origin" relationship rather than
 *  "equal" (which a blanket `true` still models correctly). */
function isAncestorFor(truePairs: ReadonlyArray<readonly [string, string]>): Mock {
  return vi.fn().mockImplementation((ancestor: string, descendant: string) =>
    truePairs.some(([a, d]) => a === ancestor && d === descendant),
  );
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

/** The test/{ref} HEAD the merged Build Gate PR's `headRefOid` records —
 *  shared by every scenario so the ordinary-merge comparison matches. */
const TEST_HEAD = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

/** §3.2's local-vs-origin build HEADs — deliberately different, since local
 *  `build/{ref}` is behind `origin/build/{ref}`. */
const LOCAL_BUILD_HEAD = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const ORIGIN_BUILD_HEAD = "cccccccccccccccccccccccccccccccccccccccc";

/** A fully-shaped `MergedPullRequestSummary` (gh.ts §4.9) recording
 *  `headRefOid` == the test branch's current HEAD (the ordinary-merge case
 *  this chunk owns). */
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
    hasCommitsBeyond: Mock;
    headCommitTitle: Mock;
    isAncestor: Mock;
    findMergedPR: Mock;
    findOpenPR: Mock;
    gateRun: Mock;
    pullFastForward: Mock;
    rebase: Mock;
    checkout: Mock;
  };
}

/**
 * Builds a full `ExternalTools` test double for the merged-pending-pull read
 * path. Defaults: the caller sits on `build/{ref}` (the derived phase's
 * canonical branch), no commits beyond origin/build/{ref} (so §3.3's
 * fall-through yields `not-started`), and the merged Build Gate PR for
 * `build/{ref}` <- `test/{ref}` is present with `headRefOid` ==
 * `headSha("test/{ref}")`. Every mutating git method is a throw-mock,
 * `github.createPR` is a throw-mock, and `gateChecks.run` is a throw-mock —
 * a `status` read must touch none of them. `branchExists`/`headSha` are
 * scenario-specific and therefore required overrides.
 */
function buildTools(
  ref: string,
  overrides: {
    branchExists: Mock;
    headSha: Mock;
    currentBranch?: Mock;
    findMergedPR?: Mock;
    hasCommitsBeyond?: Mock;
    isAncestor?: Mock;
  },
): MockSet {
  const fetch = vi.fn().mockResolvedValue(undefined);
  const currentBranch = overrides.currentBranch ?? vi.fn().mockResolvedValue(`build/${ref}`);
  const branchExists = overrides.branchExists;
  const headSha = overrides.headSha;
  const hasCommitsBeyond = overrides.hasCommitsBeyond ?? vi.fn().mockResolvedValue(false);
  const headCommitTitle = vi.fn().mockResolvedValue("");
  // Default true correctly models "equal" (a commit is its own ancestor) —
  // only a genuinely-behind scenario (§3.2) needs a direction-sensitive
  // override (MAG-49 correction, see file header).
  const isAncestor = overrides.isAncestor ?? vi.fn().mockResolvedValue(true);
  const findMergedPR =
    overrides.findMergedPR ?? mergedPRFor([`build/${ref}`, `test/${ref}`], mergedBuildGatePR());
  const findMergedPRs = vi.fn().mockResolvedValue([]);
  const findOpenPR = vi.fn().mockResolvedValue(null);
  const gateRun = unexpected("gateChecks.run");
  const pullFastForward = unexpected("git.pullFastForward");
  const rebase = unexpected("git.rebase");
  const checkout = unexpected("git.checkout");

  const tools = {
    git: {
      fetch,
      currentBranch,
      branchExists,
      headSha,
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
      headSha,
      hasCommitsBeyond,
      headCommitTitle,
      isAncestor,
      findMergedPR,
      findOpenPR,
      gateRun,
      pullFastForward,
      rebase,
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

describe("status: merged Build Gate PR with no local build/{ref} yet (§3.1)", () => {
  it("derives phase build / state merged-pending-pull, comparing test/{ref}'s HEAD to the merged PR's headRefOid", async () => {
    const { tools, mocks } = buildTools("AAA-123", {
      branchExists: buildAbsentLocally("AAA-123"),
      headSha: headShaFor({
        "origin/test/AAA-123": TEST_HEAD,
        "origin/build/AAA-123": ORIGIN_BUILD_HEAD,
      }),
    });
    const { code, stdout } = await runStatus(["status", "--ref", "AAA-123", "--json"], tools);

    // A successfully-derived merged-pending-pull read is a successful run.
    expect(code).toBe(0);
    expect(stdout).toContain("Task::Phase::State AAA-123::build::merged-pending-pull");

    const json = parseJson(stdout);
    expect(json.success).toBe(true);
    expect(json.result.taskStatus.phase).toBe("build");
    expect(json.result.taskStatus.state).toBe("merged-pending-pull");

    // fetch runs unconditionally first (§1.1), and the Build Gate pair was
    // consulted.
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.findMergedPR).toHaveBeenCalledWith("build/AAA-123", "test/AAA-123");

    // §2.1: the headRefOid comparison is actually made — test/{ref}'s
    // current HEAD is read via the remote-tracking ref (fetch() updates
    // origin/test/{ref}, never a local branch, which may not exist), not
    // just "a merged PR exists".
    expect(mocks.headSha).toHaveBeenCalledWith("origin/test/AAA-123");

    // Local build/{ref} absence is what pushes this to merged-pending-pull.
    expect(mocks.branchExists).toHaveBeenCalledWith("build/AAA-123", { remote: false });

    // PR-driven: the branch-exists derivation (`hasCommitsBeyond`/
    // `headCommitTitle`) is never reached for merged-pending-pull, and a
    // plain read never touches gate-check.
    expect(mocks.hasCommitsBeyond).not.toHaveBeenCalled();
    expect(mocks.headCommitTitle).not.toHaveBeenCalled();
    expect(mocks.gateRun).not.toHaveBeenCalled();

    // status only reports; it never resolves (§2.1/§3.1 Then): no
    // pullFastForward/rebase/checkout (each is a throw-mock — reaching any
    // would have thrown and failed this test).
    expect(mocks.pullFastForward).not.toHaveBeenCalled();
    expect(mocks.rebase).not.toHaveBeenCalled();
    expect(mocks.checkout).not.toHaveBeenCalled();
  });
});

describe("status: merged Build Gate PR with local build/{ref} behind origin (§3.2)", () => {
  it("derives phase build / state merged-pending-pull when local build/{ref} trails origin/build/{ref}", async () => {
    const { tools, mocks } = buildTools("AAA-124", {
      branchExists: existsOnly("spec/AAA-124", "test/AAA-124", "build/AAA-124"),
      headSha: headShaFor({
        "origin/test/AAA-124": TEST_HEAD,
        "build/AAA-124": LOCAL_BUILD_HEAD,
        "origin/build/AAA-124": ORIGIN_BUILD_HEAD,
      }),
      // Genuinely behind, not diverged and not ahead (MAG-49 correction):
      // origin/build/AAA-124 is NOT reachable from build/AAA-124, but
      // build/AAA-124 IS reachable from origin/build/AAA-124.
      isAncestor: isAncestorFor([["build/AAA-124", "origin/build/AAA-124"]]),
    });
    const { code, stdout } = await runStatus(["status", "--ref", "AAA-124", "--json"], tools);

    expect(code).toBe(0);
    expect(stdout).toContain("Task::Phase::State AAA-124::build::merged-pending-pull");

    const json = parseJson(stdout);
    expect(json.success).toBe(true);
    expect(json.result.taskStatus.phase).toBe("build");
    expect(json.result.taskStatus.state).toBe("merged-pending-pull");

    // The headRefOid comparison is still made (§2.1), via the
    // remote-tracking ref...
    expect(mocks.headSha).toHaveBeenCalledWith("origin/test/AAA-124");

    // ...and the local-vs-origin direction is now resolved via isAncestor
    // (MAG-49 correction), not a plain headSha comparison: local behind
    // origin means the merge is pending a pull.
    expect(mocks.isAncestor).toHaveBeenCalledWith("origin/build/AAA-124", "build/AAA-124");
    expect(mocks.isAncestor).toHaveBeenCalledWith("build/AAA-124", "origin/build/AAA-124");

    // PR-driven: ordinary branch-exists derivation is never reached.
    expect(mocks.hasCommitsBeyond).not.toHaveBeenCalled();
    expect(mocks.headCommitTitle).not.toHaveBeenCalled();
    expect(mocks.gateRun).not.toHaveBeenCalled();

    // status only reports; it never resolves.
    expect(mocks.pullFastForward).not.toHaveBeenCalled();
    expect(mocks.rebase).not.toHaveBeenCalled();
    expect(mocks.checkout).not.toHaveBeenCalled();
  });
});

describe("status: merged Build Gate PR with local build/{ref} already caught up (§3.3)", () => {
  it("does not report merged-pending-pull — falls through to the ordinary build-phase derivation", async () => {
    const { tools, mocks } = buildTools("AAA-125", {
      branchExists: existsOnly("spec/AAA-125", "test/AAA-125", "build/AAA-125"),
      headSha: headShaFor({
        "origin/test/AAA-125": TEST_HEAD,
      }),
      // Caught up (equal) — origin IS an ancestor of local (MAG-49
      // correction: default `true` already models this correctly).
    });
    const { code, stdout } = await runStatus(["status", "--ref", "AAA-125", "--json"], tools);

    expect(code).toBe(0);
    expect(stdout).toContain("Task::Phase::State AAA-125::build::not-started");

    const json = parseJson(stdout);
    expect(json.success).toBe(true);
    expect(json.result.taskStatus.phase).toBe("build");
    // The caught-up case is NOT merged-pending-pull — it falls through to
    // MAG-46-06's ordinary derivation, now applied to the build phase.
    expect(json.result.taskStatus.state).not.toBe("merged-pending-pull");
    expect(json.result.taskStatus.state).toBe("not-started");

    // The headRefOid comparison is still made (§2.1), via the
    // remote-tracking ref...
    expect(mocks.headSha).toHaveBeenCalledWith("origin/test/AAA-125");

    // ...and the local-vs-origin direction is resolved via isAncestor
    // (MAG-49 correction), not headSha: origin is an ancestor of local
    // (equal), so this is not merged-pending-pull.
    expect(mocks.isAncestor).toHaveBeenCalledWith("origin/build/AAA-125", "build/AAA-125");

    // The fall-through runs the ordinary build-phase derivation against the
    // build phase's own parent (origin/build/{ref}); with no commits beyond
    // it (hasCommitsBeyond false), the state is not-started.
    expect(mocks.hasCommitsBeyond).toHaveBeenCalledWith("build/AAA-125", "origin/build/AAA-125");
    expect(mocks.headCommitTitle).not.toHaveBeenCalled();
    expect(mocks.gateRun).not.toHaveBeenCalled();

    // status only reports; it never resolves — even in the fall-through case.
    expect(mocks.pullFastForward).not.toHaveBeenCalled();
    expect(mocks.rebase).not.toHaveBeenCalled();
    expect(mocks.checkout).not.toHaveBeenCalled();
  });
});

describe("status: merged Build Gate PR with local build/{ref} diverged from origin (§3.4)", () => {
  it("falls through to the ordinary build-phase derivation AND surfaces a build-phase trunk-drift rebase trigger", async () => {
    const { tools, mocks } = buildTools("AAA-126", {
      branchExists: existsOnly("spec/AAA-126", "test/AAA-126", "build/AAA-126"),
      headSha: headShaFor({
        "origin/test/AAA-126": TEST_HEAD,
      }),
      // Genuine divergence, not "behind" (§3.2) and not "ahead/equal"
      // (§3.3): NEITHER direction is an ancestor of the other — local
      // carries its own commit beyond a shared fork point, and
      // origin/build/AAA-126 has independently advanced past that same
      // fork point (a second Build Gate PR merged cleanly while this
      // session was open, task-MAG-49.md §3).
      isAncestor: isAncestorFor([]),
      // Local carries its own commit relative to the build phase's
      // parent (origin/build/{ref}) — the ordinary derivation this falls
      // through to must still see real work, not not-started.
      hasCommitsBeyond: vi.fn().mockResolvedValue(true),
    });
    const { code, stdout } = await runStatus(["status", "--ref", "AAA-126", "--json"], tools);

    expect(code).toBe(0);
    expect(stdout).toContain("Task::Phase::State AAA-126::build::ready?");

    const json = parseJson(stdout);
    expect(json.success).toBe(true);
    expect(json.result.taskStatus.phase).toBe("build");
    // Divergence is NOT merged-pending-pull — it falls through to the same
    // ordinary derivation §3.3 does.
    expect(json.result.taskStatus.state).not.toBe("merged-pending-pull");
    expect(json.result.taskStatus.state).toBe("ready?");

    // The headRefOid comparison is still made (§2.1)...
    expect(mocks.headSha).toHaveBeenCalledWith("origin/test/AAA-126");

    // ...and BOTH isAncestor directions were checked — neither alone
    // distinguishes "diverged" from "behind" (§3.2) or "ahead" (§3.3);
    // only checking both does.
    expect(mocks.isAncestor).toHaveBeenCalledWith("origin/build/AAA-126", "build/AAA-126");
    expect(mocks.isAncestor).toHaveBeenCalledWith("build/AAA-126", "origin/build/AAA-126");

    // The fall-through runs the ordinary build-phase derivation against
    // the build phase's own parent (origin/build/{ref}).
    expect(mocks.hasCommitsBeyond).toHaveBeenCalledWith("build/AAA-126", "origin/build/AAA-126");
    expect(mocks.gateRun).not.toHaveBeenCalled();

    // The real new behavior this scenario exists to prove: divergence
    // surfaces as a build-phase trunk-drift rebase trigger, in the exact
    // shape the existing generic rebase-forward mechanism (spec/quick's
    // own trunk drift) already consumes.
    expect(json.result.taskStatus.rebase).toEqual({
      branch: "build/AAA-126",
      onto: "origin/build/AAA-126",
    });

    // status only reports; it never resolves — divergence is surfaced,
    // not silently rebased by a plain status read.
    expect(mocks.pullFastForward).not.toHaveBeenCalled();
    expect(mocks.rebase).not.toHaveBeenCalled();
    expect(mocks.checkout).not.toHaveBeenCalled();
  });
});
