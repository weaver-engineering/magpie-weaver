/**
 * Command-level system tests for `pnpm task wip [title] [message] [--json]`
 * — "wip packs away work in progress" (task-MAG-46-07-wip-commit-spec.md,
 * LLD §3.12).
 *
 * Same in-process pattern as specs 04/06/06.01: `run(argv, tools)` is called
 * directly with an injected `ExternalTools` whose `git` member is a test
 * double — no real git/gh/fs calls anywhere. Unlike `status`'s read paths,
 * `wip` is a pure git write: only `currentBranch` (to derive the ref that
 * prefixes the WIP title), `isDirty`, `changedFiles`, `commitAll`, and
 * `push` are consulted — every other tool method throws if called (§2.1).
 * Staging is `commitAll`'s own `git add -A` concern (deps/git.ts), so
 * asserting `commitAll` is the staging assertion.
 *
 * `changedFiles` is the architect-confirmed `GitTool` addition for this
 * chunk (spec §2.1): `changedFiles(): Promise<{added: string[]; changed:
 * string[]; deleted: string[]}>`, backed by `git status --porcelain`
 * parsing. The real interface declaration, `RealGitTool.changedFiles()`,
 * and the `--dev-testing` wiring land with the build phase; the doubles
 * here carry it through the usual `as unknown as ExternalTools` cast,
 * exactly like every other command test.
 *
 * Every one of these tests fails against the pre-implementation codebase:
 * `wip` currently throws `new Error("not implemented")` (commands/wip.ts),
 * so the WIP-marked title/message formatting, the push, the changed-file
 * result fields, and the exit-0 contract can't be produced yet.
 */

// Implements: task-MAG-46-07-wip-commit-spec.md
// System behaviors: 3.1, 3.2, 3.3 (plus the §3 top-level "never switches
// branches" property, asserted via git.checkout never being called)

import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { run } from "../../../../packages/task-phases/src/cli.js";
import type { ExternalTools } from "../../../../packages/task-phases/src/types.js";

/** A mock that fails the test loudly if the command under test calls a tool
 *  method that must not be touched on the `wip` write path. */
function unexpected(method: string): Mock {
  return vi.fn().mockImplementation(() => {
    throw new Error(`unexpected call: ${method}`);
  });
}

/** The `changedFiles` result shape — the architect-confirmed `GitTool`
 *  addition for this chunk (spec §2.1). */
interface ChangedFiles {
  added: string[];
  changed: string[];
  deleted: string[];
}

interface MockSet {
  tools: ExternalTools;
  mocks: {
    currentBranch: Mock;
    isDirty: Mock;
    changedFiles: Mock;
    commitAll: Mock;
    push: Mock;
    checkout: Mock;
  };
}

/** Builds a full `ExternalTools` test double for the `wip` write path.
 *  Defaults: currentBranch "task/AAA-123", isDirty true, no changed files,
 *  commitAll resolves to a SHA, push resolves. `checkout` is a benign
 *  tracked mock so the "never switches branches" property (§2.1) can be
 *  asserted explicitly rather than by throwing; every other non-git tool
 *  method throws if called — `wip` is a pure git write and must not touch
 *  them. */
function buildTools(
  overrides: {
    currentBranch?: Mock;
    isDirty?: Mock;
    changedFiles?: Mock;
    commitAll?: Mock;
    push?: Mock;
  } = {},
): MockSet {
  const currentBranch = overrides.currentBranch ?? vi.fn().mockResolvedValue("task/AAA-123");
  const isDirty = overrides.isDirty ?? vi.fn().mockResolvedValue(true);
  const changedFiles = overrides.changedFiles ?? vi.fn().mockResolvedValue({ added: [], changed: [], deleted: [] });
  const commitAll =
    overrides.commitAll ?? vi.fn().mockResolvedValue("a1b2c3d4e5f60718293a4b5c6d7e8f9012345678");
  const push = overrides.push ?? vi.fn().mockResolvedValue(undefined);
  const checkout = vi.fn().mockResolvedValue(undefined);

  const tools = {
    git: {
      fetch: vi.fn().mockResolvedValue(undefined),
      currentBranch,
      branchExists: unexpected("branchExists"),
      headSha: unexpected("headSha"),
      mergeBase: unexpected("mergeBase"),
      hasCommitsBeyond: unexpected("hasCommitsBeyond"),
      headCommitTitle: unexpected("headCommitTitle"),
      isDirty,
      isAncestor: unexpected("isAncestor"),
      createBranch: unexpected("createBranch"),
      checkout,
      commitAll,
      push,
      pullFastForward: unexpected("pullFastForward"),
      rebase: unexpected("rebase"),
      deleteBranch: unexpected("deleteBranch"),
      changedFiles,
    },
    github: {
      createPR: unexpected("createPR"),
      findMergedPRs: unexpected("findMergedPRs"),
      findMergedPR: unexpected("findMergedPR"),
      findOpenPR: unexpected("findOpenPR"),
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

  return { tools, mocks: { currentBranch, isDirty, changedFiles, commitAll, push, checkout } };
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

describe("wip: commits and pushes real changes", () => {
  it("stages, commits with the WIP-marked title, pushes, and reports the result (§3.1)", async () => {
    const sha = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
    const { tools, mocks } = buildTools({
      currentBranch: vi.fn().mockResolvedValue("task/AAA-123"),
      isDirty: vi.fn().mockResolvedValue(true),
      changedFiles: vi.fn().mockResolvedValue({
        added: ["packages/a/new.ts", "docs/notes.md"],
        changed: ["packages/a/lib.ts"],
        deleted: ["packages/a/old.ts"],
      }),
      commitAll: vi.fn().mockResolvedValue(sha),
    });
    const cap = captureStdout();
    const code = await run(
      ["node", "cli.js", "wip", "A proof of concept", "parked - depending on AAA-234", "--json"],
      tools,
    );
    const stdout = cap.stdout();
    cap.restore();

    // The WIP-marked title is derived from the current branch's ref and the
    // given title; the message is passed through (§2.1's exact format).
    expect(mocks.currentBranch).toHaveBeenCalled();
    expect(mocks.commitAll).toHaveBeenCalledWith(
      "AAA-123: A proof of concept - WIP",
      expect.stringContaining("parked - depending on AAA-234"),
    );

    // The commit is pushed to the branch it was made on — and `wip` never
    // changes which branch is checked out (§2.1).
    expect(mocks.push).toHaveBeenCalledWith("task/AAA-123");
    expect(mocks.checkout).not.toHaveBeenCalled();

    // The `--json` doc carries the full `WipCommandResult`: the SHA the
    // commit resolved to and the changed-file breakdown.
    const lines = stdout.trim().split("\n");
    expect(lines).toHaveLength(1);
    const doc = JSON.parse(lines[0]) as {
      success: boolean;
      result: {
        success: boolean;
        commitSha: string;
        filesAdded: string[];
        filesChanged: string[];
        filesDeleted: string[];
      };
    };
    expect(doc.success).toBe(true);
    expect(doc.result.success).toBe(true);
    expect(doc.result.commitSha).toBe(sha);
    expect(doc.result.filesAdded).toHaveLength(2);
    expect(doc.result.filesAdded).toContain("packages/a/new.ts");
    expect(doc.result.filesAdded).toContain("docs/notes.md");
    expect(doc.result.filesChanged).toHaveLength(1);
    expect(doc.result.filesChanged).toContain("packages/a/lib.ts");
    expect(doc.result.filesDeleted).toHaveLength(1);
    expect(doc.result.filesDeleted).toContain("packages/a/old.ts");

    expect(code).toBe(0);
  });

  it("pushes a bare `wip` commit with the documented title/message fallbacks (§3.3)", async () => {
    const { tools, mocks } = buildTools({
      currentBranch: vi.fn().mockResolvedValue("task/AAA-124"),
      isDirty: vi.fn().mockResolvedValue(true),
      changedFiles: vi.fn().mockResolvedValue({
        added: ["packages/a/new.ts"],
        changed: [],
        deleted: [],
      }),
    });
    const cap = captureStdout();
    const code = await run(["node", "cli.js", "wip"], tools);
    const stdout = cap.stdout();
    cap.restore();

    // Confirmed bare-`wip` format (spec §2.1/§3.3): `{ref}: - WIP`, with the
    // message falling back to the documented "work in progress".
    expect(mocks.currentBranch).toHaveBeenCalled();
    expect(mocks.commitAll).toHaveBeenCalledWith("AAA-124: - WIP", "work in progress");
    expect(mocks.push).toHaveBeenCalledWith("task/AAA-124");
    expect(mocks.checkout).not.toHaveBeenCalled();

    expect(code).toBe(0);
    expect(stdout).toContain("wip: OK");
  });
});

describe("wip: fails cleanly on a clean worktree", () => {
  it("does not commit or push when there is nothing to pack away (§3.2)", async () => {
    const { tools, mocks } = buildTools({
      isDirty: vi.fn().mockResolvedValue(false),
    });
    const cap = captureStdout();
    const code = await run(["node", "cli.js", "wip"], tools);
    const stdout = cap.stdout();
    cap.restore();

    // The clean check itself was consulted, and it halted the command.
    expect(mocks.isDirty).toHaveBeenCalled();

    // No empty commit is manufactured and nothing is pushed.
    expect(mocks.commitAll).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();

    // A message states there is nothing to pack away; the command reports
    // failure (exit 1).
    expect(stdout).toMatch(/nothing to pack away/i);
    expect(code).toBe(1);
  });
});
