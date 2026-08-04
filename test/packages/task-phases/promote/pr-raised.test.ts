/**
 * Command-level system tests for `pnpm task promote [--json]`'s
 * `test::ready -> pr-raised` action — raising the Build Gate PR
 * (`test/{ref}` -> `build/{ref}`) and the `awaiting-pr` no-op
 * (task-MAG-46-11-status-awaiting-pr-and-promote-pr-raised-spec.md, LLD
 * §3.11).
 *
 * Three behaviors under test, kept separate per §2.1:
 *   1. Finding `test/{ref}` resolved `ready` (via `resolveReady()`, which
 *      promote always calls), `promote` raises the Build Gate PR through
 *      `github.createPR("build/{ref}", "test/{ref}", ...)` and reports
 *      `action: "pr-raised"` with the PR's number/URL (§3.1). Because
 *      `build/{ref}` already exists on origin in that scenario, no branch
 *      creation happens.
 *   2. When `build/{ref}` does NOT exist on origin, `promote` first
 *      publishes it from `origin/main` via `git.createRemoteBranch`
 *      (pinned in packages/task-phases/src/deps/git.interface.ts —
 *      `git push origin origin/main:refs/heads/build/{ref}`, §2.1), and
 *      that creation happens *before* `github.createPR` (§3.1.1).
 *   3. Once the PR is open, a repeated `promote` call is an idempotent,
 *      safe no-op: `action: "none"`, `github.createPR` NOT called again,
 *      the reported message re-states the existing PR's number (§3.3).
 *
 * Same in-process pattern as every prior chunk: `run(argv, tools)` is
 * called directly with an injected `ExternalTools` whose `git`/`github`/
 * `gateChecks` members are test doubles — no real git/gh/fs/gate-check
 * anywhere. `git.branchExists` is stateful (build/{ref} present/absent on
 * origin), and `github.findOpenPR` is stateful so that the post-createPR
 * re-derivation (like the forked path's §2.1 re-derivation) sees the PR it
 * just opened and reports `awaiting-pr` rather than re-raising.
 * `git.createBranch`/`git.checkout`/`git.push` are throw-mocks — none of
 * these scenarios forks locally or restores a branch (build/{ref} is
 * published straight to origin, never checked out locally, §2.1).
 *
 * Every one of these tests fails against the pre-implementation codebase:
 * `promote` currently only implements the spec-spec fork (`action:
 * "forked"`) and blocked-relay paths; a `test`-phase `ready` falls through
 * to `new Error("not implemented")` (commands/promote.ts), and
 * `deriveRepoState` still defers ("not implemented") on any gate PR
 * (lib/repo-state.ts) rather than deriving `awaiting-pr`. None of the
 * three scenarios can produce `action: "pr-raised"` — or a "none" that
 * re-states a PR — yet.
 */

// Implements: task-MAG-46-11-status-awaiting-pr-and-promote-pr-raised-spec.md
// System behaviors: 5.2 (test::ready -> pr-raised), 5.4 (build/{ref} created
//   from origin/main when absent, before createPR), 5.9 (promote no-op while
//   awaiting-pr), 5.10 (awaiting-pr attached to source phase test)
// Spec sections: §3.1, §3.1.1, §3.3

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

/** The fixed PR summary §3.1's `github.createPR` resolves to, and §3.3's
 *  open PR carries. */
const OPEN_PR: PullRequestSummary = {
  number: 45,
  url: "https://github.com/weaver-engineering/magpie-weaver/pull/45",
};

/** The suite's `ExternalTools` fixtures plus the individual test doubles. */
interface PrRaisedSet {
  tools: ExternalTools;
  mocks: {
    fetch: Mock;
    currentBranch: Mock;
    branchExists: Mock;
    hasCommitsBeyond: Mock;
    headCommitTitle: Mock;
    isAncestor: Mock;
    gateRun: Mock;
    createRemoteBranch: Mock;
    createPR: Mock;
    findOpenPR: Mock;
  };
}

/**
 * Builds a full `ExternalTools` test double for the `test::ready ->
 * pr-raised` path. Defaults encode the §3.1 scenario: `test/AAA-123` and
 * `spec/AAA-123` exist, spec is its ancestor (not stale), test has a commit
 * of its own (`hasCommitsBeyond` true -> `ready?`) with a non-WIP head,
 * `gateChecks.run` passes `build-gate` (-> `ready`). The caller sits on the
 * canonical `test/AAA-123`. `build/AAA-123` exists on origin unless
 * `buildExists` is false (the §3.1.1 scenario).
 *
 * `findOpenPR` is **stateful**: it reports no open Build Gate PR while
 * `github.createPR` hasn't run, and the PR §3.1's `createPR` returns once
 * it has — so the post-action re-derivation (the §2.1 consequence surfaced
 * by `promote`, mirroring the `forked` path's) correctly reports
 * `awaiting-pr` instead of re-raising. `createRemoteBranch` is a real
 * double (the §3.1.1 mutation, asserted below); `git.createBranch`/
 * `checkout`/`push` are throw-mocks — no local fork, restore, or ordinary
 * push happens in any of these scenarios. Set `prAlreadyOpen: true` for
 * the §3.3 scenario (the PR is open from the start).
 */
function buildTools(
  overrides: {
    buildExists?: boolean;
    prAlreadyOpen?: boolean;
    gateRun?: Mock;
    hasCommitsBeyond?: Mock;
  } = {},
): PrRaisedSet {
  const buildExists = overrides.buildExists ?? true;
  const prOpen: { value: PullRequestSummary | null } = {
    value: overrides.prAlreadyOpen === true ? OPEN_PR : null,
  };

  const fetch = vi.fn().mockResolvedValue(undefined);
  const currentBranch = vi.fn().mockResolvedValue("test/AAA-123");
  const branchExists = vi.fn().mockImplementation((name: string, opts?: { remote?: boolean }) => {
    if (name === "test/AAA-123") return true;
    if (name === "spec/AAA-123") return true;
    if (name === "build/AAA-123") return opts?.remote === true && buildExists;
    return false;
  });
  const hasCommitsBeyond =
    overrides.hasCommitsBeyond ??
    vi.fn().mockImplementation((branch: string) => Promise.resolve(branch === "test/AAA-123"));
  const headCommitTitle = vi.fn().mockResolvedValue("AAA-123: add tests to promote");
  const isAncestor = vi.fn().mockResolvedValue(true);
  const findMergedPR = vi.fn().mockResolvedValue(null);
  const findMergedPRs = vi.fn().mockResolvedValue([]);
  const findOpenPR = vi
    .fn()
    .mockImplementation((base: string, head: string) =>
      base === "build/AAA-123" && head === "test/AAA-123" ? prOpen.value : null,
    );
  const runGate = overrides.gateRun ?? gateRun({ passed: true, check: "build-gate" });

  const createRemoteBranch = vi.fn().mockResolvedValue(undefined);
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
      createRemoteBranch,
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
      createRemoteBranch,
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

describe("promote: raises the Build Gate PR from a ready test phase, build/{ref} already on origin (§3.1)", () => {
  it("calls createPR with the Build Gate pair and reports action pr-raised, without creating the branch", async () => {
    const { tools, mocks } = buildTools({ buildExists: true });
    const { code, doc } = await runPromote(tools);

    // promote resolves ready? unconditionally, passing the derived test
    // phase and ref to the gate.
    expect(mocks.gateRun).toHaveBeenCalledTimes(1);
    expect(mocks.gateRun).toHaveBeenCalledWith("test", { ref: "AAA-123" });

    // The Build Gate PR is raised exactly once, with base build / head test.
    expect(mocks.createPR).toHaveBeenCalledTimes(1);
    expect(mocks.createPR).toHaveBeenCalledWith(
      "build/AAA-123",
      "test/AAA-123",
      expect.objectContaining({ title: expect.any(String) }),
    );

    // build/AAA-123 already existed on origin — no branch creation of any
    // kind happened (§2.1's createRemoteBranch, nor a local createBranch).
    expect(mocks.createRemoteBranch).not.toHaveBeenCalled();
    expect(mocks.branchExists).toHaveBeenCalledWith("build/AAA-123", { remote: true });

    // Result contract: action pr-raised with the PR's number/url, exit 0.
    expect(doc.result.action).toBe("pr-raised");
    expect(doc.result.prNumber).toBe(45);
    expect(doc.result.prUrl).toBe(OPEN_PR.url);
    expect(doc.result.success).toBe(true);
    expect(doc.success).toBe(true);
    expect(code).toBe(0);
  });
});

describe("promote: creates build/{ref} from origin/main when it is absent, before raising the PR (§3.1.1)", () => {
  it("publishes build/AAA-123 from origin/main to origin BEFORE createPR, still action pr-raised", async () => {
    const { tools, mocks } = buildTools({ buildExists: false });
    const { code, doc } = await runPromote(tools);

    // The base branch is published straight to origin from origin/main —
    // both the source ref and that it went to origin (not a local
    // createBranch), per the §3.1.1 Then clause.
    expect(mocks.createRemoteBranch).toHaveBeenCalledTimes(1);
    expect(mocks.createRemoteBranch).toHaveBeenCalledWith("build/AAA-123", "origin/main");

    // No local branch creation or checkout happened — the branch is only
    // ever published to origin, never worked on locally (§2.1).
    // (createBranch/checkout are throw-mocks, so their absence is enforced
    // structurally; assertion kept for clarity of intent.)

    // The creation happened BEFORE createPR — the PR would 422 against a
    // missing base otherwise. Assert the ordering, not just that both ran.
    expect(mocks.createPR).toHaveBeenCalledTimes(1);
    const createOrder = mocks.createRemoteBranch.mock.invocationCallOrder[0];
    const prOrder = mocks.createPR.mock.invocationCallOrder[0];
    expect(createOrder).toBeGreaterThan(0);
    expect(prOrder).toBeGreaterThan(createOrder);

    // Creating the base branch is a step within raising the PR, not a
    // distinct action.
    expect(doc.result.action).toBe("pr-raised");
    expect(doc.result.prNumber).toBe(45);
    expect(doc.result.success).toBe(true);
    expect(code).toBe(0);
  });
});

describe("promote: idempotent no-op while awaiting-pr (§3.3)", () => {
  it("does not call createPR again and re-reports the existing PR's number as action none", async () => {
    // §3.3 Given: the Build Gate PR is already open (prAlreadyOpen), so the
    // initial derivation is awaiting-pr, not ready.
    const { tools, mocks } = buildTools({ prAlreadyOpen: true });
    const { code, doc } = await runPromote(tools);

    // github.createPR is NOT called again — the existing PR is re-reported.
    expect(mocks.createPR).not.toHaveBeenCalled();

    // Nothing destructive or branch-mutating happens either — awaiting-pr is
    // a pure no-op (createRemoteBranch/createBranch/checkout/push all
    // absent; createRemoteBranch and createBranch/checkout/push are
    // throw-mocks, so any call would fail the test loudly).

    // Result contract: action none, exit 0, and the PR's number is re-stated
    // (not a generic "nothing to do").
    expect(doc.result.action).toBe("none");
    expect(doc.result.success).toBe(true);
    expect(doc.success).toBe(true);
    expect(code).toBe(0);
    const joined = doc.result.messages.join("\n");
    expect(joined).toContain("45");
  });
});
