/**
 * Command-level system tests for `pnpm task init <ref> [--quick] [--title
 * <title>] [--json]` — the happy paths of both branch-creation routes
 * (normal -> `spec/{ref}`, `--quick` -> `task/{ref}`), the hard
 * unconditional block for existing work in progress, and the pre-flight
 * checks that must pass before any branch is created
 * (task-MAG-46-05-init-creates-spec-and-quick-branches-spec.md, LLD §3.8).
 *
 * Exercised in-process: `run(argv, tools)` is called directly with an
 * injected `ExternalTools` whose `git`/`fileSystem` members are test
 * doubles — no real git/gh/fs calls anywhere. Every interaction with
 * `ExternalTools` is asserted explicitly (Guard Rails), including
 * `git.fetch()` running first (§1.1) and the documented default layout
 * `docs/tasks/{ref}/task-{ref}.md` being produced from the loaded config.
 *
 * The fixtures use the spec's documented default layout — task dir named
 * after the ref itself, task doc `task-{ref}.md` inside it — encoded
 * explicitly in the mocked config (`dirName: "${ref}"`) rather than left
 * to whatever the implementation's own defaults happen to be.
 *
 * `commitAll`/`push` were originally `unexpected`/unasserted here — a
 * quick-route task/MAG-46 commit revised that: `init` now supports
 * `--commit` to commit and push the scaffolded doc itself, opt-in rather
 * than automatic, so both are now benign mocks. The happy-path tests
 * (§3.1/§3.2) assert neither is called by default; separate tests below
 * cover `--commit` actually triggering them.
 */

// Implements: task-MAG-46-05-init-creates-spec-and-quick-branches-spec.md
// System behaviors: 2.1, 2.2, 2.5, 2.7, 2.10

import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { run } from "../../../../packages/task-phases/src/cli.js";
import type {
  ExternalTools,
  TaskPhasesConfig,
} from "../../../../packages/task-phases/src/types.js";

/** The task template the `fileSystem.readFile` double returns — contains
 * the `${ref}`/`${title}` placeholders `init` must substitute. */
const TEMPLATE = "# ${title}\n\nRef: ${ref}\n";

/** The config the `fileSystem.loadConfig` double returns. */
const CONFIG: TaskPhasesConfig = {
  templates: { task: "templates/task-template.md" },
  tasks: {
    docs: "docs/tasks/",
    dirName: "${ref}",
    taskDocName: "task-${ref}",
    specDocNames: "task-${ref}-${nn}-spec.md",
  },
};

/** A mock that fails the test loudly if the command under test calls a tool
 * method it must not touch on the path being exercised. */
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
    isDirty: Mock;
    headSha: Mock;
    isAncestor: Mock;
    branchExists: Mock;
    createBranch: Mock;
    commitAll: Mock;
    push: Mock;
    loadConfig: Mock;
    exists: Mock;
    readFile: Mock;
    writeFile: Mock;
    mkdir: Mock;
  };
}

/** Builds a full `ExternalTools` test double. Defaults: clean worktree on
 * `main`, `main` up to date with `origin`, no branch or task dir of any
 * kind existing, config/docs doubles returning the fixtures above. Every
 * other tool method throws if called. */
function buildTools(
  overrides: {
    currentBranch?: Mock;
    isDirty?: Mock;
    headSha?: Mock;
    isAncestor?: Mock;
    branchExists?: Mock;
    exists?: Mock;
  } = {},
): MockSet {
  const fetch = vi.fn().mockResolvedValue(undefined);
  const currentBranch = overrides.currentBranch ?? vi.fn().mockResolvedValue("main");
  const isDirty = overrides.isDirty ?? vi.fn().mockResolvedValue(false);
  const headSha = overrides.headSha ?? vi.fn().mockResolvedValue("sha-main");
  const isAncestor = overrides.isAncestor ?? vi.fn().mockResolvedValue(true);
  const branchExists = overrides.branchExists ?? vi.fn().mockResolvedValue(false);
  const createBranch = vi.fn().mockResolvedValue(undefined);
  const commitAll = vi.fn().mockResolvedValue("new-commit-sha");
  const push = vi.fn().mockResolvedValue(undefined);

  const loadConfig = vi.fn().mockResolvedValue(CONFIG);
  const exists = overrides.exists ?? vi.fn().mockImplementation((path: string) =>
    Promise.resolve(path.startsWith("templates/")),
  );
  const readFile = vi.fn().mockResolvedValue(TEMPLATE);
  const writeFile = vi.fn().mockResolvedValue(undefined);
  const mkdir = vi.fn().mockResolvedValue(undefined);

  const tools = {
    git: {
      fetch,
      currentBranch,
      branchExists,
      headSha,
      mergeBase: unexpected("mergeBase"),
      hasCommitsBeyond: unexpected("hasCommitsBeyond"),
      headCommitTitle: unexpected("headCommitTitle"),
      isDirty,
      isAncestor,
      createBranch,
      // `createBranch` already checks out (§4.8); whether the build calls
      // `checkout` on top is left unasserted — the spec pins neither.
      checkout: vi.fn().mockResolvedValue(undefined),
      commitAll,
      push,
      pullFastForward: unexpected("pullFastForward"),
      rebase: unexpected("rebase"),
      deleteBranch: unexpected("deleteBranch"),
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
      loadConfig,
      exists,
      readFile,
      writeFile,
      copyFile: unexpected("fileSystem.copyFile"),
      mkdir,
      readDir: unexpected("fileSystem.readDir"),
    },
  } as unknown as ExternalTools;

  return {
    tools,
    mocks: {
      fetch,
      currentBranch,
      isDirty,
      headSha,
      isAncestor,
      branchExists,
      createBranch,
      commitAll,
      push,
      loadConfig,
      exists,
      readFile,
      writeFile,
      mkdir,
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

describe("init: creates spec and quick branches", () => {
  it("creates spec/{ref} off main and scaffolds the task doc from the template (§3.1)", async () => {
    const { tools, mocks } = buildTools();
    const cap = captureStdout();
    const code = await run(
      ["node", "cli.js", "init", "AAA-001", "--title", "Do a thing", "--json"],
      tools,
    );
    const stdout = cap.stdout();
    cap.restore();

    expect(code).toBe(0);

    // `git.fetch()` runs first, exactly once, before anything is derived (§1.1).
    expect(mocks.fetch).toHaveBeenCalledTimes(1);

    // Pre-flight checks all passed: clean worktree, and the target branch
    // is available both locally and on origin.
    expect(mocks.isDirty).toHaveBeenCalled();
    expect(mocks.branchExists).toHaveBeenCalledWith("spec/AAA-001");
    expect(mocks.branchExists).toHaveBeenCalledWith("spec/AAA-001", { remote: true });

    // The branch is created off main, then the config-driven doc layout is
    // scaffolded: mkdir docs/tasks/{ref}, write task-{ref}.md from the
    // template with ${ref} and ${title} substituted.
    expect(mocks.createBranch).toHaveBeenCalledWith("spec/AAA-001", "main");
    expect(mocks.loadConfig).toHaveBeenCalled();
    expect(mocks.exists).toHaveBeenCalledWith("docs/tasks/AAA-001");
    expect(mocks.mkdir).toHaveBeenCalledWith("docs/tasks/AAA-001");
    expect(mocks.readFile).toHaveBeenCalledWith("templates/task-template.md");
    expect(mocks.writeFile).toHaveBeenCalledWith(
      "docs/tasks/AAA-001/task-AAA-001.md",
      "# Do a thing\n\nRef: AAA-001\n",
    );

    // Without --commit, nothing is committed or pushed — the scaffold is
    // left for the caller to inspect and commit by hand.
    expect(mocks.commitAll).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();

    // --json reports the created canonical branch in the result object.
    const lines = stdout.trim().split("\n");
    expect(lines).toHaveLength(1);
    const doc = JSON.parse(lines[0]) as {
      result: { canonicalBranch: string; committed: boolean };
      success: boolean;
    };
    expect(doc.result.canonicalBranch).toBe("spec/AAA-001");
    expect(doc.result.committed).toBe(false);
    expect(doc.success).toBe(true);
  });

  it("--quick creates task/{ref} off main instead of spec/{ref} (§3.2)", async () => {
    const { tools, mocks } = buildTools();
    const cap = captureStdout();
    const code = await run(
      ["node", "cli.js", "init", "AAA-002", "--quick", "--title", "Do a small thing", "--json"],
      tools,
    );
    const stdout = cap.stdout();
    cap.restore();

    expect(code).toBe(0);

    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.branchExists).toHaveBeenCalledWith("task/AAA-002");
    expect(mocks.branchExists).toHaveBeenCalledWith("task/AAA-002", { remote: true });

    // Only the quick-route branch is created — the normal route must not run.
    expect(mocks.createBranch).toHaveBeenCalledWith("task/AAA-002", "main");
    expect(mocks.createBranch).not.toHaveBeenCalledWith("spec/AAA-002", expect.anything());

    // Without --commit, nothing is committed or pushed on the quick route
    // either — same default as the normal route.
    expect(mocks.commitAll).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();

    const lines = stdout.trim().split("\n");
    expect(lines).toHaveLength(1);
    const doc = JSON.parse(lines[0]) as {
      result: { canonicalBranch: string; committed: boolean };
      success: boolean;
    };
    expect(doc.result.canonicalBranch).toBe("task/AAA-002");
    expect(doc.result.committed).toBe(false);
    expect(doc.success).toBe(true);
  });

  it("--commit commits and pushes the scaffolded doc", async () => {
    const { tools, mocks } = buildTools();
    const cap = captureStdout();
    const code = await run(
      ["node", "cli.js", "init", "AAA-006", "--title", "Do a thing", "--commit", "--json"],
      tools,
    );
    const stdout = cap.stdout();
    cap.restore();

    expect(code).toBe(0);

    expect(mocks.commitAll).toHaveBeenCalledWith(
      "AAA-006: Do a thing",
      expect.stringContaining("docs/tasks/AAA-006/task-AAA-006.md"),
    );
    expect(mocks.push).toHaveBeenCalledWith("spec/AAA-006");

    const lines = stdout.trim().split("\n");
    const doc = JSON.parse(lines[0]) as {
      result: { committed: boolean };
      success: boolean;
    };
    expect(doc.result.committed).toBe(true);
    expect(doc.success).toBe(true);
  });

  it("--commit works on the --quick route too", async () => {
    const { tools, mocks } = buildTools();
    const cap = captureStdout();
    const code = await run(
      ["node", "cli.js", "init", "AAA-007", "--quick", "--title", "Do a small thing", "--commit"],
      tools,
    );
    cap.restore();

    expect(code).toBe(0);
    expect(mocks.commitAll).toHaveBeenCalledWith(
      "AAA-007: Do a small thing",
      expect.stringContaining("docs/tasks/AAA-007/task-AAA-007.md"),
    );
    expect(mocks.push).toHaveBeenCalledWith("task/AAA-007");
  });

  it("never overwrites an existing task doc — creates the branch but leaves the doc untouched", async () => {
    const existsWithDoc = vi.fn().mockImplementation((path: string) =>
      Promise.resolve(
        path.startsWith("templates/") ||
          path === "docs/tasks/AAA-008" ||
          path === "docs/tasks/AAA-008/task-AAA-008.md",
      ),
    );
    const { tools, mocks } = buildTools({ exists: existsWithDoc });
    const cap = captureStdout();
    const code = await run(
      ["node", "cli.js", "init", "AAA-008", "--title", "Do a thing", "--commit", "--json"],
      tools,
    );
    const stdout = cap.stdout();
    cap.restore();

    expect(code).toBe(0);

    // The branch is still created — only the doc write is skipped.
    expect(mocks.createBranch).toHaveBeenCalledWith("spec/AAA-008", "main");
    expect(mocks.mkdir).not.toHaveBeenCalled();
    expect(mocks.writeFile).not.toHaveBeenCalled();

    // Nothing to commit either — the branch alone needs no commit, and
    // --commit is a no-op here rather than an empty/no-op commit attempt.
    expect(mocks.commitAll).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();

    const lines = stdout.trim().split("\n");
    const doc = JSON.parse(lines[0]) as {
      result: { taskDocPath: string; committed: boolean };
      success: boolean;
    };
    expect(doc.result.taskDocPath).toBe("docs/tasks/AAA-008/task-AAA-008.md");
    expect(doc.result.committed).toBe(false);
    expect(doc.success).toBe(true);
  });

  it("refuses init outright when there is work in progress and no --wip (§3.3)", async () => {
    const { tools, mocks } = buildTools({
      currentBranch: vi.fn().mockResolvedValue("build/ABC-123"),
      isDirty: vi.fn().mockResolvedValue(true),
    });
    const cap = captureStdout();
    const code = await run(
      ["node", "cli.js", "init", "AAA-003", "--title", "Do a thing"],
      tools,
    );
    const stdout = cap.stdout();
    cap.restore();

    expect(code).toBe(1);

    // Nothing was created and nothing was scaffolded — the pre-existing
    // build/ABC-123 state is untouched.
    expect(mocks.createBranch).not.toHaveBeenCalled();
    expect(mocks.mkdir).not.toHaveBeenCalled();
    expect(mocks.writeFile).not.toHaveBeenCalled();
    expect(mocks.commitAll).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();

    // The refusal names both facts: work in progress, and no --wip given.
    expect(stdout).toMatch(/work in progress/i);
    expect(stdout).toMatch(/--wip/i);

    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.isDirty).toHaveBeenCalled();
  });

  it("refuses init when main is not up to date with origin (§3.4)", async () => {
    const { tools, mocks } = buildTools({
      // Local main's HEAD differs from origin/main's HEAD after fetch().
      // The currency check must fail whichever way the build reads it:
      // differing HEAD SHAs, and origin/main not being an ancestor of main.
      headSha: vi.fn().mockImplementation((branch: string) =>
        Promise.resolve(branch === "origin/main" ? "sha-origin" : "sha-local"),
      ),
      isAncestor: vi.fn().mockResolvedValue(false),
    });
    const cap = captureStdout();
    const code = await run(
      ["node", "cli.js", "init", "AAA-004", "--title", "Do a thing"],
      tools,
    );
    const stdout = cap.stdout();
    cap.restore();

    expect(code).toBe(1);

    // The refusal happens before any branch or doc creation.
    expect(mocks.createBranch).not.toHaveBeenCalled();
    expect(mocks.commitAll).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();

    // The message states main is not up to date with origin.
    expect(stdout).toMatch(/not up to date/i);
    expect(stdout).toContain("origin");

    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("requires at least one of --title/--doc, exiting 2 before any branch creation (§3.5)", async () => {
    const { tools, mocks } = buildTools();
    const cap = captureStdout();
    const code = await run(["node", "cli.js", "init", "AAA-005"], tools);
    const stdout = cap.stdout();
    cap.restore();

    expect(code).toBe(2);

    // Invalid argument — caught before any branch/doc creation is attempted.
    expect(mocks.createBranch).not.toHaveBeenCalled();
    expect(mocks.commitAll).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();

    // The message states one of --title/--doc is required.
    expect(stdout).toContain("--title");
    expect(stdout).toContain("--doc");
    expect(stdout).toMatch(/required/i);
  });
});
