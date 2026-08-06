/**
 * Command-level system tests for `pnpm task init <ref> --doc <path> |
 * --specs <path>... | --wip [title] [message]` — the flag-variant forms
 * deferred from MAG-46-05 and landed here
 * (task-MAG-46-18-init-status-ref-flag-variants-spec.md, LLD §3.8): copying
 * a given doc in as the task doc instead of scaffolding from the template
 * (§3.1), copying given spec docs in with the `task-{ref}-{nn}-spec.md`
 * naming convention (§3.2), carrying pre-existing WIP forward on the
 * current branch before the new branch is created rather than blocking
 * (§3.3), and the two graceful-degradation cases — a bad `--doc`/`--specs`
 * path warns and continues (§3.4), and a missing `.task-phases.json` warns
 * and falls back to every documented default (§3.5).
 *
 * Same in-process pattern as spec 05's `init/create.test.ts`: `run(argv,
 * tools)` is called directly with an injected `ExternalTools` whose
 * `git`/`fileSystem` members are test doubles — no real git/gh/fs calls
 * anywhere. Every interaction with `ExternalTools` is asserted explicitly
 * (Guard Rails), including `git.fetch()` running first (§1.1) and the
 * documented default layout `docs/tasks/{ref}/task-{ref}.md` being produced
 * from the loaded config. The `copyFile` double is a benign mock here
 * (spec 05's fixture threw on it — these tests are the first to exercise
 * the copy path), and `commitAll` a benign mock (spec 05's `--commit`
 * tests already made it one).
 *
 * Every one of these tests fails against the pre-implementation codebase:
 * `init`/`lib/task-doc.ts` still ignore `--doc`/`--specs`/`--wip` entirely
 * — `copyFile` is never called, `--wip` on a dirty worktree hits the hard
 * §3.3 block from spec 05 instead of committing forward, and a missing
 * config propagates `loadConfig()`'s throw up to an exit-1 command error
 * rather than warning and continuing.
 */

// Implements: task-MAG-46-18-init-status-ref-flag-variants-spec.md
// System behaviors: 2.3, 2.4, 2.6, 2.8, 2.9

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
    branchExists: Mock;
    createBranch: Mock;
    commitAll: Mock;
    push: Mock;
    loadConfig: Mock;
    exists: Mock;
    readFile: Mock;
    writeFile: Mock;
    copyFile: Mock;
    mkdir: Mock;
  };
}

/** Builds a full `ExternalTools` test double for the init flag-variant
 * paths. Defaults: clean worktree on `main`, `main` up to date with
 * `origin`, no branch or task dir of any kind existing, config/docs
 * doubles returning the fixtures above, and `--doc`/`--specs` source paths
 * resolved via the `exists` double (default: only `templates/` and whatever
 * `exists` overrides name exist). Every other tool method throws if
 * called. */
function buildTools(
  overrides: {
    currentBranch?: Mock;
    isDirty?: Mock;
    headSha?: Mock;
    branchExists?: Mock;
    loadConfig?: Mock;
    exists?: Mock;
  } = {},
): MockSet {
  const fetch = vi.fn().mockResolvedValue(undefined);
  const currentBranch = overrides.currentBranch ?? vi.fn().mockResolvedValue("main");
  const isDirty = overrides.isDirty ?? vi.fn().mockResolvedValue(false);
  const headSha = overrides.headSha ?? vi.fn().mockResolvedValue("sha-main");
  const branchExists = overrides.branchExists ?? vi.fn().mockResolvedValue(false);
  const createBranch = vi.fn().mockResolvedValue(undefined);
  const commitAll = vi.fn().mockResolvedValue("new-commit-sha");
  const push = vi.fn().mockResolvedValue(undefined);

  const loadConfig = overrides.loadConfig ?? vi.fn().mockResolvedValue(CONFIG);
  const exists = overrides.exists ?? vi.fn().mockImplementation((path: string) =>
    Promise.resolve(path.startsWith("templates/")),
  );
  const readFile = vi.fn().mockResolvedValue(TEMPLATE);
  const writeFile = vi.fn().mockResolvedValue(undefined);
  const copyFile = vi.fn().mockResolvedValue(undefined);
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
      isAncestor: unexpected("isAncestor"),
      createBranch,
      checkout: unexpected("checkout"),
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
      copyFile,
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
      branchExists,
      createBranch,
      commitAll,
      push,
      loadConfig,
      exists,
      readFile,
      writeFile,
      copyFile,
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

describe("init: --doc / --specs / --wip flag variants", () => {
  it("--doc copies a given path in as the task doc instead of scaffolding from the template (§3.1)", async () => {
    const { tools, mocks } = buildTools({
      exists: vi.fn().mockImplementation((path: string) =>
        Promise.resolve(
          path.startsWith("templates/") || path === "path/to/custom-note.md",
        ),
      ),
    });
    const cap = captureStdout();
    const code = await run(
      ["node", "cli.js", "init", "AAA-003", "--doc", "path/to/custom-note.md"],
      tools,
    );
    cap.restore();

    expect(code).toBe(0);

    // The branch is still created off main — --doc replaces only the doc
    // source, not the rest of the init flow.
    expect(mocks.createBranch).toHaveBeenCalledWith("spec/AAA-003", "main");

    // The doc path is copied in to the task dir as the task doc...
    expect(mocks.copyFile).toHaveBeenCalledWith(
      "path/to/custom-note.md",
      "docs/tasks/AAA-003/task-AAA-003.md",
    );

    // ...and the template-scaffolding path from MAG-46-05 is not used: no
    // template is ever read or written.
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(mocks.writeFile).not.toHaveBeenCalled();
  });

  it("--specs copies each given spec doc in with the task-{ref}-{nn}-spec.md naming convention (§3.2)", async () => {
    const { tools, mocks } = buildTools();
    const cap = captureStdout();
    const code = await run(
      [
        "node", "cli.js", "init", "AAA-003", "--title", "x",
        "--specs", "a-spec.md", "b-spec.md", "--json",
      ],
      tools,
    );
    const stdout = cap.stdout();
    cap.restore();

    expect(code).toBe(0);

    // One copyFile call per given path, into the task dir with the
    // documented spec-naming convention (LLD §3.8.1: `spec-1-scaffolding.md
    // -> task-AAA-001-01-spec.md`), numbered in the order given.
    expect(mocks.copyFile).toHaveBeenCalledTimes(2);
    expect(mocks.copyFile).toHaveBeenCalledWith(
      "a-spec.md",
      "docs/tasks/AAA-003/task-AAA-003-01-spec.md",
    );
    expect(mocks.copyFile).toHaveBeenCalledWith(
      "b-spec.md",
      "docs/tasks/AAA-003/task-AAA-003-02-spec.md",
    );

    // The result reports both copied spec docs.
    const lines = stdout.trim().split("\n");
    expect(lines).toHaveLength(1);
    const doc = JSON.parse(lines[0]) as {
      result: { specDocPaths: string[] };
      success: boolean;
    };
    expect(doc.result.specDocPaths).toHaveLength(2);
    expect(doc.success).toBe(true);
  });

  it("--wip commits pre-existing WIP on the current branch before the new branch is created (§3.3)", async () => {
    const { tools, mocks } = buildTools({
      currentBranch: vi.fn().mockResolvedValue("build/ABC-123"),
      isDirty: vi.fn().mockResolvedValue(true),
    });
    const cap = captureStdout();
    const code = await run(
      [
        "node", "cli.js", "init", "AAA-003",
        "--wip", "A PoC", "No longer required", "--title", "x", "--json",
      ],
      tools,
    );
    const stdout = cap.stdout();
    cap.restore();

    // Contrast with MAG-46-05 §3.3: identical dirty state with no --wip
    // fails outright; --wip turns it into a success.
    expect(code).toBe(0);

    // The WIP commit happens BEFORE the branch is created (§2.1 — assert
    // the ordering, not just that both happened).
    expect(mocks.commitAll).toHaveBeenCalled();
    expect(mocks.createBranch).toHaveBeenCalledWith("spec/AAA-003", "main");
    expect(mocks.commitAll.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createBranch.mock.invocationCallOrder[0],
    );

    // The commit follows the documented WIP convention (wip.ts §3.12):
    // `{ref}: {title} - WIP` with the given message passed through.
    const wipTitle = mocks.commitAll.mock.calls[0][0] as string;
    const wipMessage = mocks.commitAll.mock.calls[0][1] as string;
    expect(wipTitle).toContain("ABC-123");
    expect(wipTitle).toContain("A PoC");
    expect(wipTitle).toContain("WIP");
    expect(wipMessage).toContain("No longer required");

    // The result reports the carry-forward.
    const lines = stdout.trim().split("\n");
    expect(lines).toHaveLength(1);
    const doc = JSON.parse(lines[0]) as {
      result: { wipCarriedForward: boolean };
      success: boolean;
    };
    expect(doc.result.wipCarriedForward).toBe(true);
  });

  it("a bad --doc path warns and continues — branch created, template fallback runs, exit 0 (§3.4)", async () => {
    const { tools, mocks } = buildTools();
    const cap = captureStdout();
    const code = await run(
      ["node", "cli.js", "init", "AAA-004", "--doc", "missing.md", "--title", "x"],
      tools,
    );
    const stdout = cap.stdout();
    cap.restore();

    expect(code).toBe(0);

    // init still completes — the branch is created.
    expect(mocks.createBranch).toHaveBeenCalledWith("spec/AAA-004", "main");

    // A warning names the missing path.
    expect(stdout).toContain("missing.md");

    // Since --title was also given, the template-scaffolding fallback runs
    // instead of the copy — the doc is still produced.
    expect(mocks.readFile).toHaveBeenCalledWith("templates/task-template.md");
    expect(mocks.writeFile).toHaveBeenCalledWith(
      "docs/tasks/AAA-004/task-AAA-004.md",
      "# x\n\nRef: AAA-004\n",
    );
    expect(mocks.copyFile).not.toHaveBeenCalled();
  });

  it("a bad --specs path warns and continues — the remaining specs still copy, exit 0 (§3.4)", async () => {
    const { tools, mocks } = buildTools();
    const cap = captureStdout();
    const code = await run(
      [
        "node", "cli.js", "init", "AAA-009", "--title", "x",
        "--specs", "good-spec.md", "missing-spec.md",
      ],
      tools,
    );
    const stdout = cap.stdout();
    cap.restore();

    expect(code).toBe(0);
    expect(mocks.createBranch).toHaveBeenCalledWith("spec/AAA-009", "main");

    // A warning names the missing path...
    expect(stdout).toContain("missing-spec.md");

    // ...and the valid spec still copies in — one failure doesn't abort
    // the rest of the copy loop.
    expect(mocks.copyFile).toHaveBeenCalledWith(
      "good-spec.md",
      "docs/tasks/AAA-009/task-AAA-009-01-spec.md",
    );
    expect(mocks.copyFile).not.toHaveBeenCalledWith(
      "missing-spec.md",
      expect.anything(),
    );
  });

  it("missing .task-phases.json warns and falls back to documented defaults, exit 0 (§3.5)", async () => {
    const { tools, mocks } = buildTools({
      loadConfig: vi.fn().mockRejectedValue(
        new Error("No .task-phases.json found from \"/tmp/repo\" up to the filesystem root"),
      ),
    });
    const cap = captureStdout();
    const code = await run(
      ["node", "cli.js", "init", "AAA-005", "--title", "x"],
      tools,
    );
    const stdout = cap.stdout();
    cap.restore();

    expect(code).toBe(0);

    // A warning states no config file was found — the failure to load is
    // surfaced, never silently swallowed.
    expect(stdout).toMatch(/no \.task-phases\.json/i);

    // The branch is still created...
    expect(mocks.createBranch).toHaveBeenCalledWith("spec/AAA-005", "main");

    // ...and the documented default layout is used: task dir at
    // `docs/tasks/` named `task-{ref}` per the default `dirName` pattern
    // (LLD §2) — not the fixture config's `${ref}` dirName, which proves
    // the defaults rather than the config drove the layout.
    expect(mocks.mkdir).toHaveBeenCalledWith("docs/tasks/task-AAA-005");
  });
});
