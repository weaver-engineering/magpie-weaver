/**
 * Command-level system tests for `pnpm task promote [--json]`'s
 * `build::ready -> pr-raised` action — the missing regular-route hop that
 * creates `ready/{ref}` from local `build/{ref}`'s HEAD, pushes it, and
 * raises the Main Gate PR (`ready/{ref}` -> `main`)
 * (task-MAG-49-01-spec.md, task-MAG-49.md).
 *
 * This closes the gap `promote.ts`'s own fallthrough comment names: *"the
 * test->build / build->main ready hops belong to a later chunk."* `promote`
 * here operates on `phase: "build"` (canonical branch `build/{ref}`) with
 * local commits beyond `origin/build/{ref}` — the build gate resolves
 * `ready` WITHOUT any push first, matching `main-gate.ts`'s existing
 * local-`build/{ref}`-equals-`ready/{ref}` self-verification design (§2.1).
 * The action is modeled on `quick::ready -> pr-raised` (its destination
 * `main` always exists, so there is no branch-publish step) plus one step
 * neither template needs: create `ready/{ref}` from `build/{ref}`'s HEAD
 * before pushing (the actual accumulated build commits, not an empty
 * branch off `origin/main`).
 *
 * Six behaviors under test, kept separate per §3.1–§3.6:
 *   1. `build/{ref}` resolves `ready` -> `createBranch("ready/{ref}",
 *      "build/{ref}")` THEN `push("ready/{ref}")` THEN
 *      `github.createPR("main", "ready/{ref}", { title })`, `action:
 *      "pr-raised"` with the PR's number/url, exit 0 (§3.1).
 *   2. The starting branch (`build/{ref}`) is checked back out AFTER
 *      createBranch/push/createPR — `createBranch` checks the new branch
 *      out, so an explicit restore is required (branch-restoration
 *      invariant, §3.2).
 *   3. A `blocked` build-phase gate result (ready? resolved to blocked
 *      with a real violation) is relayed by the existing generic branch:
 *      no git mutation, `action: "none"`, the gate's own violation text
 *      verbatim, exit 0 (§3.3 — regression, no new logic expected).
 *   4. Genuine build-phase trunk drift (BOTH `isAncestor` directions
 *      false — local carries its own commit AND `origin/build/{ref}`
 *      advanced past the fork point) surfaces `taskStatus.rebase` and
 *      resolves via the existing generic rebase-forward mechanism:
 *      `--confirm-rebase` -> `rebase` + force-push, `action: "rebased"`
 *      (§3.4); without it, no git action and a message naming the flag
 *      (the generic refusal contract, now confirmed to fire for build).
 *   5. A pre-existing, UNMERGED `ready/{ref}` (a stale leftover) is
 *      discarded first — `deleteBranch("ready/{ref}")` before
 *      `createBranch` — then the happy path proceeds unchanged; the
 *      discard is what makes the later `createPR` never collide with a
 *      stale PR on the old branch (§3.5).
 *   6. A pre-existing `ready/{ref}` whose content is ALREADY merged into
 *      `main` (`isAncestor("origin/ready/{ref}", "origin/main")` true) is
 *      refused cleanly: `success: false`, `action: "none"`, no git
 *      mutation of any kind, an explanatory message, exit 1 (§3.6).
 *
 * Same in-process pattern as every prior chunk: `run(argv, tools)` is
 * called directly with an injected `ExternalTools` whose `git`/`github`/
 * `gateChecks` members are test doubles — no real git/gh/fs/gate-check
 * anywhere. The derivation fixture mirrors the MAG-49-corrected
 * `status/merged-pending-pull.test.ts`/`promote/pulled-and-rebased.test.ts`
 * shape: a confirmed-merged Build Gate PR whose `headRefOid` matches
 * `origin/test/{ref}`'s HEAD, local `build/{ref}` present, and an
 * `isAncestor` double that is direction-sensitive — `isAncestor
 * ("origin/build/{ref}", "build/{ref}")` resolves `true` (ahead, no
 * drift) for §3.1/§3.2/§3.3/§3.5/§3.6, and BOTH directions resolve
 * `false` for §3.4's divergence (an unconditional-`true` default would
 * misroute the drift scenario into the ordinary ready? derivation — see
 * task-MAG-49.md §3 correction). The caller sits on the canonical
 * `build/{ref}` so the `branchMismatch` guard passes. `gateChecks.run`
 * resolves a passing `main-gate` by default (-> `ready`), a failing one
 * for §3.3. `github.createPR` resolves a concrete PR summary; mutating
 * methods a scenario must NOT reach (`deleteBranch` except §3.5,
 * `rebase` except §3.4, `pullFastForward`/`createRemoteBranch`/
 * `isDirty`/`commitAll`/`mergeBase` everywhere) are throw-mocks, so "no
 * action" is enforced structurally.
 *
 * Every one of these tests fails against the pre-implementation codebase:
 * `promote` currently implements `spec::ready -> forked`, the
 * `test::ready`/`quick::ready -> pr-raised` actions, the generic
 * rebase-forward and blocked-relay paths (commands/promote.ts) — but a
 * `build`-phase `ready` falls through to `new Error("not implemented")`.
 * §3.1/§3.2/§3.5/§3.6 therefore cannot produce `action: "pr-raised"` (or
 * §3.6's refusal) yet. §3.3 and §3.4 are regression-style confirmations:
 * the blocked relay and the rebase-forward mechanism are already generic
 * and already work for `build` (the drift detection itself landed as the
 * task/MAG-49 prerequisite, PR #155) — they pass unmodified both before
 * and after, which is exactly the spec's stated intent for them.
 *
 * **Correction (MAG-50):** §3.3's blocked case originally asserted exit 0 /
 * `success: true` (mirroring the — now corrected — generic blocked-relay
 * branch this test only regression-confirms, not implements). Corrected
 * to exit 1 / `success: false`: `promote`'s job is to promote, and a
 * `blocked` state means that did not happen. No git-action or
 * violation-relay behavior changed.
 */

// Implements: task-MAG-49-01-spec.md
// Spec sections: §3.1, §3.2, §3.3, §3.4, §3.5, §3.6

import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { run } from "../../../../packages/task-phases/src/cli.js";
import type { RebaseOutcome } from "../../../../packages/task-phases/src/deps/git.js";
import type {
  ExternalTools,
  GateCheckResult,
  MergedPullRequestSummary,
  PullRequestSummary,
} from "../../../../packages/task-phases/src/types.js";

/** A mock that fails the test loudly if the command under test calls a tool
 *  method that must not be touched on the path being exercised. */
function unexpected(method: string): Mock {
  return vi.fn().mockImplementation(() => {
    throw new Error(`unexpected call: ${method}`);
  });
}

/** A fully-shaped `GateCheckResult` with the given overrides folded in. */
function gateCheckResult(overrides: Partial<GateCheckResult> = {}): GateCheckResult {
  return {
    check: "main-gate",
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

/** The Main Gate PR §3.1/§3.5's `github.createPR` resolves to. */
const OPEN_PR: PullRequestSummary = {
  number: 61,
  url: "https://github.com/weaver-engineering/magpie-weaver/pull/61",
};

/** A fully-shaped `MergedPullRequestSummary` (gh.ts §4.9) recording
 *  `headRefOid` == the test branch's current HEAD (the ordinary-merge case
 *  every `build`-phase scenario's derivation runs through). */
function mergedBuildGatePR(): MergedPullRequestSummary {
  return {
    number: 42,
    url: "https://github.com/weaver-engineering/magpie-weaver/pull/42",
    mergedAt: "2026-08-01T00:00:00Z",
    headRefOid: TEST_HEAD,
    mergeCommitOid: "2222222222222222222222222222222222222222",
  };
}

/** The suite's `ExternalTools` fixtures plus the individual test doubles. */
interface BuildReadySet {
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
    createBranch: Mock;
    push: Mock;
    checkout: Mock;
    deleteBranch: Mock;
    createPR: Mock;
    rebase: Mock;
  };
}

/**
 * Builds a full `ExternalTools` test double for the `build::ready` paths.
 * Defaults encode the §3.1 happy path for `build/{ref}` with a local commit
 * beyond `origin/build/{ref}`: the merged Build Gate PR (`build/{ref}` <-
 * `test/{ref}`) is present with `headRefOid` == `origin/test/{ref}`'s HEAD,
 * local `build/{ref}` exists, `isAncestor("origin/build/{ref}",
 * "build/{ref}")` resolves `true` (ahead, no drift), `hasCommitsBeyond`
 * resolves `true` with a non-WIP head (-> `ready?`), and `gateChecks.run
 * ("build", {ref})` resolves a passing `main-gate` (-> `ready`). The caller
 * sits on the canonical `build/{ref}` (branchMismatch guard passes).
 *
 * The three mutating primitives the happy path calls — `createBranch`/
 * `push`/`checkout` — are resolving mocks (asserted below); `github.createPR`
 * resolves `OPEN_PR`. `deleteBranch` is a throw-mock by default (only §3.5's
 * stale-discard calls it) and `rebase` is a throw-mock by default (only
 * §3.4's drift resolves it) — any other path reaching them fails loudly.
 * `pullFastForward`/`createRemoteBranch`/`isDirty`/`commitAll`/`mergeBase`
 * are throw-mocks everywhere: the build::ready action publishes no base
 * branch (its destination `main` always exists) and never pulls.
 *
 * Scenario switches: `readyOnOrigin` makes `ready/{ref}` exist (the §3.5/
 * §3.6 pre-existing-branch Given), `readyMerged` makes
 * `isAncestor("origin/ready/{ref}", "origin/main")` resolve `true` (§3.6's
 * already-merged refusal) versus `false` (§3.5's safe-to-discard leftover),
 * and `diverged` makes BOTH build ancestry directions resolve `false`
 * (§3.4's genuine trunk drift — local carries its own commit AND origin
 * advanced past the fork point; neither is an ancestor of the other).
 */
function buildTools(
  overrides: {
    readyOnOrigin?: boolean;
    readyMerged?: boolean;
    diverged?: boolean;
    gateRun?: Mock;
    createBranch?: Mock;
    push?: Mock;
    checkout?: Mock;
    deleteBranch?: Mock;
    createPR?: Mock;
    rebase?: Mock;
  } = {},
): BuildReadySet {
  const ref = "AAA-123";
  const readyOnOrigin = overrides.readyOnOrigin === true;
  const diverged = overrides.diverged === true;

  const fetch = vi.fn().mockResolvedValue(undefined);
  const currentBranch = vi.fn().mockResolvedValue(`build/${ref}`);
  const branchExists = vi.fn().mockImplementation((name: string) => {
    if (name === `ready/${ref}`) return readyOnOrigin;
    return name === `spec/${ref}` || name === `test/${ref}` || name === `build/${ref}`;
  });
  const headSha = headShaFor({ [`origin/test/${ref}`]: TEST_HEAD });
  const hasCommitsBeyond = vi
    .fn()
    .mockImplementation((branch: string) => Promise.resolve(branch === `build/${ref}`));
  const headCommitTitle = vi.fn().mockResolvedValue("AAA-123: build the promote action");
  // MAG-49 direction-sensitivity: origin/build/{ref} is an ancestor of local
  // build/{ref} in the "ahead, no drift" scenarios (§3.1/§3.2/§3.3/§3.5/§3.6)
  // and is NOT in §3.4's divergence (where the reverse direction resolves
  // false too — local is not an ancestor of origin either, since origin
  // independently advanced past the fork point). The ready/{ref} ancestry
  // check (§3.5/§3.6) is consulted only when `origin/ready/{ref}` exists.
  const isAncestor = vi.fn().mockImplementation((ancestor: string, descendant: string) => {
    if (ancestor === `origin/build/${ref}` && descendant === `build/${ref}`) return !diverged;
    if (ancestor === `build/${ref}` && descendant === `origin/build/${ref}`) return false;
    if (ancestor === `origin/ready/${ref}` && descendant === "origin/main") {
      return overrides.readyMerged === true;
    }
    return false;
  });
  const findMergedPR = mergedPRFor([`build/${ref}`, `test/${ref}`], mergedBuildGatePR());
  const findMergedPRs = vi.fn().mockResolvedValue([]);
  const findOpenPR = vi.fn().mockResolvedValue(null);
  const runGate = overrides.gateRun ?? gateRun({ passed: true, check: "main-gate" });

  const createBranch = overrides.createBranch ?? vi.fn().mockResolvedValue(undefined);
  const push = overrides.push ?? vi.fn().mockResolvedValue(undefined);
  const checkout = overrides.checkout ?? vi.fn().mockResolvedValue(undefined);
  const deleteBranch = overrides.deleteBranch ?? unexpected("deleteBranch");
  const createPR = overrides.createPR ?? vi.fn().mockResolvedValue(OPEN_PR);
  const rebase = overrides.rebase ?? unexpected("rebase");

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
      createBranch,
      checkout,
      commitAll: unexpected("commitAll"),
      push,
      pullFastForward: unexpected("pullFastForward"),
      rebase,
      deleteBranch,
      createRemoteBranch: unexpected("createRemoteBranch"),
    },
    github: {
      createPR,
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
      headSha,
      hasCommitsBeyond,
      headCommitTitle,
      isAncestor,
      findMergedPR,
      findOpenPR,
      gateRun: runGate,
      createBranch,
      push,
      checkout,
      deleteBranch,
      createPR,
      rebase,
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

/** The `result` shape serialised under the `--json` doc for a promote run —
 *  the base `TaskPhasingCommandResult` fields plus `action`, `prNumber`, and
 *  `prUrl` (set when the action is `"pr-raised"`). */
interface JsonPromoteResult {
  action: string;
  messages: string[];
  violation?: string;
  success: boolean;
  prNumber?: number;
  prUrl?: string;
  rebaseOutcome?: RebaseOutcome;
}

/** Parses the single JSON document a `--json` promote run emits. */
function parseJson(
  stdout: string,
): { command: string; result: JsonPromoteResult; success: boolean } {
  const lines = stdout.trim().split("\n");
  expect(lines).toHaveLength(1);
  const doc = JSON.parse(lines[0]) as {
    command: string;
    result: JsonPromoteResult;
    success: boolean;
  };
  return doc;
}

/** Runs an in-process `promote --json` invocation to completion, with the
 *  given extra CLI flags (e.g. `--confirm-rebase`) appended afterward. */
async function runPromote(
  tools: ExternalTools,
  extraFlags: string[] = [],
): Promise<{ code: number; doc: { command: string; result: JsonPromoteResult; success: boolean } }> {
  const cap = captureStdout();
  const code = await run(["node", "cli.js", "promote", "--json", ...extraFlags], tools);
  const stdout = cap.stdout();
  cap.restore();
  return { code, doc: parseJson(stdout) };
}

describe("promote: build::ready creates ready/{ref}, pushes, and raises the Main Gate PR (§3.1)", () => {
  it("creates ready/{ref} from build/{ref}'s HEAD, pushes it, then raises the PR against main, in that order", async () => {
    const { tools, mocks } = buildTools();
    const { code, doc } = await runPromote(tools);

    // promote resolves ready? unconditionally — the derived phase for the
    // gate is "build" (never "quick"/"test", even though the destination
    // gate name "main-gate" is shared with the quick route).
    expect(mocks.gateRun).toHaveBeenCalledTimes(1);
    expect(mocks.gateRun).toHaveBeenCalledWith("build", { ref: "AAA-123" });

    // The derivation: merged Build Gate PR consumed (the headRefOid
    // comparison is actually made), local build/{ref} ahead of origin.
    expect(mocks.findMergedPR).toHaveBeenCalledWith("build/AAA-123", "test/AAA-123");
    expect(mocks.headSha).toHaveBeenCalledWith("origin/test/AAA-123");
    expect(mocks.isAncestor).toHaveBeenCalledWith("origin/build/AAA-123", "build/AAA-123");

    // The action itself: create ready/{ref} carrying build/{ref}'s actual
    // accumulated commits (not an empty branch off origin/main).
    expect(mocks.createBranch).toHaveBeenCalledWith("ready/AAA-123", "build/AAA-123");

    // Push of the new branch, ordered after its creation.
    expect(mocks.push).toHaveBeenCalledWith("ready/AAA-123");
    const createOrder = mocks.createBranch.mock.invocationCallOrder[0];
    const pushOrder = mocks.push.mock.invocationCallOrder[0];
    expect(pushOrder).toBeGreaterThan(createOrder);

    // The Main Gate PR against main, ordered after the push — the PR title
    // names the ref and the build::ready promotion (the existing convention
    // `Task {ref}: promote {ref}::{phase}::ready to {destination} ({gate
    // name})`, §3.1).
    expect(mocks.createPR).toHaveBeenCalledTimes(1);
    expect(mocks.createPR).toHaveBeenCalledWith(
      "main",
      "ready/AAA-123",
      expect.objectContaining({ title: expect.any(String) }),
    );
    const prOrder = mocks.createPR.mock.invocationCallOrder[0];
    expect(prOrder).toBeGreaterThan(pushOrder);
    const title = mocks.createPR.mock.calls[0][2].title as string;
    expect(title).toContain("AAA-123");
    expect(title).toContain("build::ready");

    // Result contract: action pr-raised with the PR's number/url, exit 0.
    expect(doc.result.action).toBe("pr-raised");
    expect(doc.result.prNumber).toBe(OPEN_PR.number);
    expect(doc.result.prUrl).toBe(OPEN_PR.url);
    expect(doc.result.success).toBe(true);
    expect(doc.success).toBe(true);
    expect(code).toBe(0);
  });
});

describe("promote: the starting branch is restored after raising the PR (§3.2)", () => {
  it("checks build/{ref} back out last, after createBranch/push/createPR", async () => {
    const { tools, mocks } = buildTools();
    const { code, doc } = await runPromote(tools);

    // Branch-restoration invariant (§2.1): createBranch checks the new
    // branch out (`git checkout -b`), so the caller's starting branch is
    // explicitly checked back out AFTERWARD — assert the ordering, not
    // merely that both ran.
    expect(mocks.checkout).toHaveBeenCalledWith("build/AAA-123");
    const checkoutOrder = mocks.checkout.mock.invocationCallOrder[0];
    const createOrder = mocks.createBranch.mock.invocationCallOrder[0];
    const pushOrder = mocks.push.mock.invocationCallOrder[0];
    const prOrder = mocks.createPR.mock.invocationCallOrder[0];
    expect(checkoutOrder).toBeGreaterThan(createOrder);
    expect(checkoutOrder).toBeGreaterThan(pushOrder);
    expect(checkoutOrder).toBeGreaterThan(prOrder);

    // The caller is not left parked on the transient ready/{ref}.
    expect(mocks.currentBranch).toHaveBeenCalled();

    expect(doc.result.action).toBe("pr-raised");
    expect(code).toBe(0);
  });
});

describe("promote: a blocked build-phase gate result is relayed, not swallowed (§3.3)", () => {
  it("takes no git action and relays main-gate's own violation verbatim, exit 1 (MAG-50)", async () => {
    const { tools, mocks } = buildTools({
      gateRun: gateRun({
        passed: false,
        check: "main-gate",
        violations: ["build commit does not exist"],
      }),
      createBranch: unexpected("createBranch"),
      push: unexpected("push"),
      checkout: unexpected("checkout"),
      createPR: unexpected("createPR"),
      deleteBranch: unexpected("deleteBranch"),
    });
    const { code, doc } = await runPromote(tools);

    // The gate was still consulted — promote always resolves ready?. The
    // derived phase for the gate is "build" (§2.1: the blocked relay is
    // generic, but only proves it still covers build when reached via the
    // build phase).
    expect(mocks.gateRun).toHaveBeenCalledTimes(1);
    expect(mocks.gateRun).toHaveBeenCalledWith("build", { ref: "AAA-123" });

    // No git mutation of any kind (createBranch/push/checkout/createPR/
    // deleteBranch are throw-mocks — any call would fail the test loudly).
    expect(mocks.createBranch).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.checkout).not.toHaveBeenCalled();
    expect(mocks.createPR).not.toHaveBeenCalled();
    expect(mocks.deleteBranch).not.toHaveBeenCalled();

    // MAG-50: blocked means promote did not do what was asked - action
    // none, exit 1, success false (was exit 0 / success true).
    expect(doc.result.action).toBe("none");
    expect(code).toBe(1);
    expect(doc.result.success).toBe(false);

    // The gate's own violation text is surfaced directly, not reworded.
    expect(doc.result.violation).toBe("build commit does not exist");
  });
});

describe("promote: trunk drift on the build phase resolves via the existing rebase-forward mechanism (§3.4)", () => {
  it("with --confirm-rebase, rebases build/{ref} onto origin/build/{ref} and force-pushes, reporting rebased", async () => {
    // §3.4 Given: genuine divergence — local build/AAA-123 carries its own
    // commit AND origin/build/AAA-123 has independently advanced past the
    // fork point (a second Build Gate PR merged cleanly while this session
    // was open). BOTH isAncestor directions resolve false; a fixture that
    // left the reverse direction unmocked/defaulted true would be read as
    // "local behind origin, needs a plain pull" (merged-pending-pull) and
    // never reach this test's intended rebase-forward path.
    const rebase = vi.fn().mockResolvedValue({ status: "ok" });
    const { tools, mocks } = buildTools({
      diverged: true,
      rebase,
      createPR: unexpected("createPR"),
    });
    const { code, doc } = await runPromote(tools, ["--confirm-rebase"]);

    // The derivation surfaced the drift trigger in the exact shape the
    // generic rebase-forward mechanism (spec/quick's own trunk drift)
    // already consumes — promote's rebase block runs first and returns its
    // own result, so the build::ready branch is never even reached.
    expect(mocks.isAncestor).toHaveBeenCalledWith("origin/build/AAA-123", "build/AAA-123");
    expect(mocks.isAncestor).toHaveBeenCalledWith("build/AAA-123", "origin/build/AAA-123");
    expect(mocks.rebase).toHaveBeenCalledWith("build/AAA-123", "origin/build/AAA-123");

    // Force-push of the rewritten branch, ordered after the rebase.
    expect(mocks.push).toHaveBeenCalledWith("build/AAA-123", { force: true });
    const rebaseOrder = mocks.rebase.mock.invocationCallOrder[0];
    const pushOrder = mocks.push.mock.invocationCallOrder[0];
    expect(pushOrder).toBeGreaterThan(rebaseOrder);

    // The branch being rebased IS the currently-checked-out branch, so
    // rebase()'s internal checkout is a no-op — no restoration call
    // (mirrors rebased-forward.test.ts §3.2).
    expect(mocks.checkout).not.toHaveBeenCalled();

    // No PR was raised — this invocation only rebased (createPR is a
    // throw-mock); a second, separate promote call completes the
    // build::ready -> pr-raised action afterward.
    expect(mocks.createPR).not.toHaveBeenCalled();

    // Result contract: action rebased (never pr-raised), exit 0.
    expect(doc.result.action).toBe("rebased");
    expect(doc.result.rebaseOutcome).toEqual({ status: "ok" });
    expect(doc.result.success).toBe(true);
    expect(doc.success).toBe(true);
    expect(code).toBe(0);
  });

  it("without --confirm-rebase, takes no git action and names the required flag", async () => {
    const { tools, mocks } = buildTools({
      diverged: true,
      rebase: unexpected("rebase"),
      push: unexpected("push"),
      createPR: unexpected("createPR"),
    });
    const { code, doc } = await runPromote(tools);

    // No git mutation of any kind — the refusal is evaluated before the
    // rebase even begins (rebase/push/createPR are throw-mocks).
    expect(mocks.rebase).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.createPR).not.toHaveBeenCalled();

    // The generic refusal contract: a message states a rebase is required
    // and --confirm-rebase must be supplied — the exact flag is named.
    const joined = doc.result.messages.join("\n");
    expect(joined).toContain("--confirm-rebase");

    // Refusal contract: action none, exit 1.
    expect(doc.result.action).toBe("none");
    expect(doc.result.success).toBe(false);
    expect(code).toBe(1);
  });
});

describe("promote: a pre-existing, unmerged ready/{ref} is discarded and recreated (§3.5)", () => {
  it("deletes the stale ready/{ref} before creating the fresh one, then proceeds through the happy path", async () => {
    // §3.5 Given: origin/ready/AAA-123 already exists (a stale leftover from
    // the old raw-git workflow or an interrupted promote attempt) and is NOT
    // yet merged into main (isAncestor(origin/ready/AAA-123, origin/main)
    // resolves false).
    const deleteBranch = vi.fn().mockResolvedValue(undefined);
    const { tools, mocks } = buildTools({
      readyOnOrigin: true,
      readyMerged: false,
      deleteBranch,
    });
    const { code, doc } = await runPromote(tools);

    // The safety check is actually consulted: is the pre-existing
    // ready/{ref} already part of main's history?
    expect(mocks.isAncestor).toHaveBeenCalledWith("origin/ready/AAA-123", "origin/main");

    // The stale attempt is discarded FIRST — deleteBranch before
    // createBranch (assert the ordering). Deleting also auto-closes any
    // stale open PR against the old branch on GitHub, so the subsequent
    // createPR never collides with a leftover PR.
    expect(mocks.deleteBranch).toHaveBeenCalledWith("ready/AAA-123");
    const deleteOrder = mocks.deleteBranch.mock.invocationCallOrder[0];
    const createOrder = mocks.createBranch.mock.invocationCallOrder[0];
    expect(deleteOrder).toBeGreaterThan(0);
    expect(createOrder).toBeGreaterThan(deleteOrder);

    // The happy-path tail is unchanged: createBranch/push/createPR exactly
    // as in §3.1.
    expect(mocks.createBranch).toHaveBeenCalledWith("ready/AAA-123", "build/AAA-123");
    expect(mocks.push).toHaveBeenCalledWith("ready/AAA-123");
    expect(mocks.createPR).toHaveBeenCalledWith(
      "main",
      "ready/AAA-123",
      expect.objectContaining({ title: expect.any(String) }),
    );
    const pushOrder = mocks.push.mock.invocationCallOrder[0];
    const prOrder = mocks.createPR.mock.invocationCallOrder[0];
    expect(prOrder).toBeGreaterThan(pushOrder);

    // The starting branch is still restored afterward (§3.2's invariant).
    expect(mocks.checkout).toHaveBeenCalledWith("build/AAA-123");

    // Result contract: same shape as §3.1, exit 0.
    expect(doc.result.action).toBe("pr-raised");
    expect(doc.result.prNumber).toBe(OPEN_PR.number);
    expect(doc.result.success).toBe(true);
    expect(code).toBe(0);
  });
});

describe("promote: a pre-existing ready/{ref} already merged into main is refused, never overwritten (§3.6)", () => {
  it("takes no git action and reports the refusal with an explanatory message, exit 1", async () => {
    // §3.6 Given: origin/ready/AAA-123 already exists AND its content is
    // already part of main's history (isAncestor(origin/ready/AAA-123,
    // origin/main) resolves true) — touching it would clobber merged
    // history.
    const { tools, mocks } = buildTools({
      readyOnOrigin: true,
      readyMerged: true,
      deleteBranch: unexpected("deleteBranch"),
      createBranch: unexpected("createBranch"),
      push: unexpected("push"),
      checkout: unexpected("checkout"),
      createPR: unexpected("createPR"),
    });
    const { code, doc } = await runPromote(tools);

    // The safety check is actually consulted before anything is touched.
    expect(mocks.isAncestor).toHaveBeenCalledWith("origin/ready/AAA-123", "origin/main");

    // No git mutation of any kind (deleteBranch/createBranch/push/checkout/
    // createPR are throw-mocks — any call would fail the test loudly).
    expect(mocks.deleteBranch).not.toHaveBeenCalled();
    expect(mocks.createBranch).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.checkout).not.toHaveBeenCalled();
    expect(mocks.createPR).not.toHaveBeenCalled();

    // Refusal contract: success false, action none, exit 1.
    expect(doc.result.action).toBe("none");
    expect(doc.result.success).toBe(false);
    expect(doc.success).toBe(false);
    expect(code).toBe(1);

    // The message clearly explains why: ready/{ref} already exists and is
    // already merged into main.
    const joined = doc.result.messages.join("\n");
    expect(joined).toContain("ready/AAA-123");
    expect(joined).toContain("merged");
    expect(joined).toContain("main");
  });
});
