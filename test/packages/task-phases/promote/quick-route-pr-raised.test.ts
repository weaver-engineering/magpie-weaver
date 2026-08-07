/**
 * Command-level system tests for `pnpm task promote [--json]`'s quick-route
 * `ready -> pr-raised` action — raising the Main Gate PR directly
 * (`task/{ref}` -> `main`) and the `awaiting-pr` no-op
 * (task-MAG-46-11-01-promote-quick-route-pr-raised-spec.md, LLD §3.11).
 *
 * This closes the gap MAG-46-11 left open: that chunk only proved the
 * test-phase PR-raise (`test/{ref}` -> `build/{ref}`); the quick route's
 * own promote-to-PR action had no spec at all. `promote` here operates on
 * `phase: "quick"` (canonical branch `task/{ref}`) — NOT `phase: "build"`
 * — even though the destination gate name is the same string
 * ("main-gate") as the regular route's final gate (§2.1: don't conflate
 * the two phases just because the gate name matches).
 *
 * Three behaviors under test, separated per §3:
 *   1. Finding `task/{ref}` resolved `ready` (via `resolveReady()`), the
 *      quick route's `promote` raises the Main Gate PR through
 *      `github.createPR("main", "task/{ref}", ...)` and reports
 *      `action: "pr-raised"` with the PR's number/url (§3.1). Unlike the
 *      test-phase route, NO branch-publish precedes the PR: the base
 *      `main` already exists, so `git.createRemoteBranch`/
 *      `createBranch`/`checkout` are never touched.
 *   2. Finding `task/{ref}` `blocked`, `promote` takes no git action and
 *      relays `main-gate`'s own violations verbatim (§3.2) — same
 *      treatment as every other blocked case, just against `main-gate`
 *      instead of `test-gate`/`build-gate`.
 *   3. Once that Main Gate PR is open (`awaiting-pr` on the `quick`
 *      phase), a repeated `promote` call is the same safe, idempotent
 *      no-op as the test-phase case: `action: "none"`,
 *      `github.createPR` NOT called again, the reported message re-states
 *      the existing PR's number (§3.3).
 *
 * Same in-process pattern as every prior chunk: `run(argv, tools)` is
 * called directly with an injected `ExternalTools` whose `git`/`github`/
 * `gateChecks` members are test doubles — no real git/gh/fs/gate-check
 * anywhere. `git.currentBranch` returns `task/AAA-234` (the quick route's
 * canonical branch); `branchExists` reports exactly `task/AAA-234`
 * existing; `hasCommitsBeyond("task/AAA-234", "main")` resolves `true`
 * (the ready? precondition), `isAncestor("origin/main", "task/AAA-234")`
 * resolves `true` (no trunk-drift rebase trigger), and `gateChecks.run`
 * resolves a passing `main-gate`. `github.findOpenPR("main",
 * "task/AAA-234")` is stateful so the post-createPR re-derivation reports
 * `awaiting-pr` rather than re-raising; `git.createRemoteBranch`/
 * `createBranch`/`checkout`/`push` are throw-mocks — the quick route
 * publishes nothing and forks nothing.
 *
 * Every one of these tests fails against the pre-implementation codebase:
 * `promote` only implements the spec-spec fork (`action: "forked"`), the
 * test-phase Build Gate raise (`action: "pr-raised"`), and the blocked
 * relay — a `quick`-phase `ready` falls through to `new Error("not
 * implemented")` (commands/promote.ts). On the `awaiting-pr` side,
 * `deriveRepoState`'s `assertNoGatePR`/`derivePrState` (lib/repo-state.ts)
 * still throws `"not implemented"` the moment an open PR is found on any
 * pair other than the Build Gate pair, so the quick route's open Main Gate
 * PR cannot yet produce `phase: "quick", state: "awaiting-pr"` (or the
 * §3.3 no-op that re-states its number). None of the three scenarios can
 * produce `action: "pr-raised"` — or a "none" that re-states a Main Gate
 * PR — yet.
 *
 * **Correction (MAG-50):** §3.2's blocked case originally asserted exit 0 /
 * `success: true`. Corrected: `promote`'s whole job is to promote — a
 * `blocked` state means that did not happen, so it's a failed invocation
 * (exit 1 / `success: false`) even though no systematic error occurred
 * determining it. No git-action or violation-relay behavior changed.
 */

// Implements: task-MAG-46-11-01-promote-quick-route-pr-raised-spec.md
// System behaviors: quick::ready -> pr-raised (Main Gate PR, task/{ref} ->
//   main), quick::blocked -> none (relay main-gate violations), repeated
//   promote while awaiting-pr -> idempotent none
// Spec sections: §3.1, §3.2, §3.3

import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { run } from "../../../../packages/task-phases/src/cli.js";
import type {
  ExternalTools,
  GateCheckResult,
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

/** The Main Gate PR §3.1's `github.createPR` resolves to, and §3.3's open
 *  PR carries. */
const OPEN_PR: PullRequestSummary = {
  number: 52,
  url: "https://github.com/weaver-engineering/magpie-weaver/pull/52",
};

/** The suite's `ExternalTools` fixtures plus the individual test doubles. */
interface QuickRoutePrSet {
  tools: ExternalTools;
  mocks: {
    fetch: Mock;
    currentBranch: Mock;
    branchExists: Mock;
    hasCommitsBeyond: Mock;
    headCommitTitle: Mock;
    isAncestor: Mock;
    gateRun: Mock;
    createPR: Mock;
    findOpenPR: Mock;
  };
}

/**
 * Builds a full `ExternalTools` test double for the quick route's
 * `ready -> pr-raised` path. Defaults encode the §3.1 scenario:
 * `task/AAA-234` exists (and is the only phase branch), `hasCommitsBeyond`
 * against its parent `main` resolves `true` (`ready?`) with a non-WIP
 * head, `isAncestor("origin/main", "task/AAA-234")` resolves `true` (no
 * trunk-drift rebase trigger), and `gateChecks.run("quick", {ref})`
 * resolves a passing `main-gate` (-> `ready`). The caller sits on the
 * canonical `task/AAA-234`.
 *
 * `findOpenPR` is **stateful**: it reports no open Main Gate PR while
 * `github.createPR` hasn't run, and the PR §3.1's `createPR` returns once
 * it has — so the post-action re-derivation (the §2.1 consequence surfaced
 * by `promote`, mirroring the fork path's) correctly reports `awaiting-pr`
 * instead of re-raising. `git.createRemoteBranch`/`createBranch`/
 * `checkout`/`push` are throw-mocks — the quick route publishes no base
 * branch (its base `main` already exists) and forks nothing. Set
 * `prAlreadyOpen: true` for the §3.3 scenario (the PR is open from the
 * start), and override `gateRun` for the §3.2 blocked scenario.
 */
function buildTools(
  overrides: {
    prAlreadyOpen?: boolean;
    gateRun?: Mock;
    hasCommitsBeyond?: Mock;
  } = {},
): QuickRoutePrSet {
  const prOpen: { value: PullRequestSummary | null } = {
    value: overrides.prAlreadyOpen === true ? OPEN_PR : null,
  };

  const fetch = vi.fn().mockResolvedValue(undefined);
  const currentBranch = vi.fn().mockResolvedValue("task/AAA-234");
  const branchExists = vi.fn().mockImplementation((name: string) => {
    if (name === "task/AAA-234") return true;
    return false;
  });
  const hasCommitsBeyond =
    overrides.hasCommitsBeyond ??
    vi.fn().mockImplementation((branch: string) => Promise.resolve(branch === "task/AAA-234"));
  const headCommitTitle = vi.fn().mockResolvedValue("AAA-234: add tests to promote");
  const isAncestor = vi.fn().mockResolvedValue(true);
  const findMergedPR = vi.fn().mockResolvedValue(null);
  const findMergedPRs = vi.fn().mockResolvedValue([]);
  const findOpenPR = vi
    .fn()
    .mockImplementation((base: string, head: string) =>
      base === "main" && head === "task/AAA-234" ? prOpen.value : null,
    );
  const runGate = overrides.gateRun ?? gateRun({ passed: true, check: "main-gate" });

  const createPR = vi.fn().mockImplementation(async () => {
    prOpen.value = OPEN_PR;
    return OPEN_PR;
  });

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
      hasCommitsBeyond,
      headCommitTitle,
      isAncestor,
      gateRun: runGate,
      createPR,
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

/** Runs an in-process `promote --json` invocation to completion. */
async function runPromote(
  tools: ExternalTools,
): Promise<{ code: number; doc: { command: string; result: JsonPromoteResult; success: boolean } }> {
  const cap = captureStdout();
  const code = await run(["node", "cli.js", "promote", "--json"], tools);
  const stdout = cap.stdout();
  cap.restore();
  return { code, doc: parseJson(stdout) };
}

describe("promote: raises the Main Gate PR from the quick route (§3.1)", () => {
  it("calls createPR with base main / head task/{ref} and reports action pr-raised, without any branch work", async () => {
    const { tools, mocks } = buildTools();
    const { code, doc } = await runPromote(tools);

    // promote resolves ready? unconditionally, passing the derived quick
    // phase and ref to the gate (§2.1: the phase is "quick", not "build").
    expect(mocks.gateRun).toHaveBeenCalledTimes(1);
    expect(mocks.gateRun).toHaveBeenCalledWith("quick", { ref: "AAA-234" });

    // The Main Gate PR is raised exactly once, base main / head task/{ref}.
    expect(mocks.createPR).toHaveBeenCalledTimes(1);
    expect(mocks.createPR).toHaveBeenCalledWith(
      "main",
      "task/AAA-234",
      expect.objectContaining({ title: expect.any(String) }),
    );

    // The quick route publishes no base branch: `main` already exists, so
    // createRemoteBranch / createBranch / checkout / push are never called
    // (all throw-mocks — any call would fail the test loudly).
    expect(mocks.branchExists).toHaveBeenCalledWith("task/AAA-234", { remote: true });

    // Result contract: action pr-raised with the PR's number/url, exit 0.
    expect(doc.result.action).toBe("pr-raised");
    expect(doc.result.prNumber).toBe(52);
    expect(doc.result.prUrl).toBe(OPEN_PR.url);
    expect(doc.result.success).toBe(true);
    expect(doc.success).toBe(true);
    expect(code).toBe(0);
  });
});

describe("promote: quick::blocked performs no action (§3.2)", () => {
  it("takes no git action, reports action none, and relays main-gate's own violation verbatim", async () => {
    const { tools, mocks } = buildTools({
      gateRun: gateRun({
        passed: false,
        check: "main-gate",
        violations: ["task doc missing"],
      }),
    });
    const { code, doc } = await runPromote(tools);

    // The gate was still consulted — promote always resolves ready?. The
    // derived phase for the gate is "quick", agreeing with §3.1.
    expect(mocks.gateRun).toHaveBeenCalledTimes(1);
    expect(mocks.gateRun).toHaveBeenCalledWith("quick", { ref: "AAA-234" });

    // No git action and no PR were performed.
    expect(mocks.createPR).not.toHaveBeenCalled();

    // MAG-50: blocked means promote did not do what was asked - action
    // none, exit 1, success false (was exit 0 / success true).
    expect(doc.result.action).toBe("none");
    expect(code).toBe(1);
    expect(doc.result.success).toBe(false);

    // The gate's own violation text is surfaced directly, not reworded.
    expect(doc.result.violation).toBe("task doc missing");
  });
});

describe("promote: idempotent no-op while the Main Gate PR is open (§3.3)", () => {
  it("does not call createPR again and re-reports the existing PR's number as action none", async () => {
    // §3.3 Given: the Main Gate PR is already open (prAlreadyOpen), so the
    // initial derivation is awaiting-pr on the quick phase, not ready.
    const { tools, mocks } = buildTools({ prAlreadyOpen: true });
    const { code, doc } = await runPromote(tools);

    // github.createPR is NOT called again — the existing PR is re-reported.
    expect(mocks.createPR).not.toHaveBeenCalled();

    // Result contract: action none, exit 0, and the PR's number is
    // re-stated (not a generic "nothing to do").
    expect(doc.result.action).toBe("none");
    expect(doc.result.success).toBe(true);
    expect(doc.success).toBe(true);
    expect(code).toBe(0);
    const joined = doc.result.messages.join("\n");
    expect(joined).toContain("52");
  });
});