/**
 * System tests for `--dev-testing git <method>` real-world execution of the
 * five `GitTool` methods with no coverage elsewhere in the backlog:
 * `isDirty`, `hasCommitsBeyond`, `headCommitTitle`, `pullFastForward`,
 * `deleteBranch`.
 *
 * Every test spawns the built CLI as a subprocess against a real (temporary)
 * git repository — never calls into `cli.ts` exports directly. Fixtures use
 * a local bare repo as `origin` (spec-01 precedent), so no network is
 * involved.
 *
 * Spec: MAG-46-05.01  §3.1 isDirty, §3.2 hasCommitsBeyond, §3.3
 * headCommitTitle, §3.4 pullFastForward, §3.5 deleteBranch.
 *
 * All five `RealGitTool` methods throw "not implemented" during the test
 * phase, so every test that reaches a real git call fails as required.
 */

// Implements: task-MAG-46-05-01-dev-testing-git-status-and-cleanup-spec.md

import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const cliPath = resolve(__dirname, "../../../../packages/task-phases/dist/cli.js");

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Create a temporary directory that is cleaned up after the suite. */
function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "mag-test-"));
}

/** Initialise a non-bare git repository at `dir` and return `dir`.
 *  The default branch is renamed to `main` after the first commit so
 *  pushing to `main` works regardless of the host's default branch name
 *  config (older git versions do not support `--initial-branch`). */
function initRepo(dir: string): string {
  mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "test@test"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir, stdio: "pipe" });
  _renameDefaultBranchToMain(dir);
  return dir;
}

/** Create an empty initial commit and rename whatever default branch git
 *  created (e.g. `master`) to `main`.  Idempotent — safe to call on a
 *  repo that already has commits and `main` checked out. */
function _renameDefaultBranchToMain(repo: string): void {
  // If main already exists, we are done
  const branches = execFileSync("git", ["branch"], { cwd: repo, encoding: "utf-8", stdio: "pipe" });
  if (branches.includes("main")) return;
  // Create an initial commit so there is something to rename
  try {
    execFileSync("git", ["commit", "--allow-empty", "-m", "init"], {
      cwd: repo,
      stdio: "pipe",
    });
    execFileSync("git", ["branch", "-m", "main"], { cwd: repo, stdio: "pipe" });
  } catch {
    // Race-free: if branch rename already happened between our check and now, carry on
  }
}

/** Initialise a bare git repository at `dir` and return `dir`. */
function initBareRepo(dir: string): string {
  mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "--bare"], { cwd: dir, stdio: "pipe" });
  return dir;
}

/** Create a commit on the current branch with one new file, and return the
 *  new commit's SHA. */
function createCommit(
  repo: string,
  fileName: string,
  content: string,
  msg: string,
): string {
  writeFileSync(join(repo, fileName), content, "utf-8");
  execFileSync("git", ["add", fileName], { cwd: repo, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", msg], {
    cwd: repo,
    stdio: "pipe",
  });
  return getSha(repo, "HEAD");
}

/** Create a branch (without switching to it). */
function createBranch(repo: string, branch: string, fromRef = "HEAD"): void {
  execFileSync("git", ["branch", branch, fromRef], { cwd: repo, stdio: "pipe" });
}

/** Checkout a branch. */
function checkout(repo: string, branch: string): void {
  execFileSync("git", ["checkout", branch], { cwd: repo, stdio: "pipe" });
}

/** Return the current SHA of a given ref. */
function getSha(repo: string, ref: string): string {
  return execFileSync("git", ["rev-parse", ref], {
    cwd: repo,
    encoding: "utf-8",
    stdio: "pipe",
  }).trim();
}

/** True if the local branch exists. */
function branchExistsLocal(repo: string, branch: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], {
      cwd: repo,
      encoding: "utf-8",
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

/** True if the branch exists on `origin`. */
function branchExistsRemote(repo: string, branch: string): boolean {
  const refs = execFileSync("git", ["ls-remote", "origin", branch], {
    cwd: repo,
    encoding: "utf-8",
    stdio: "pipe",
  }).trim();
  return refs !== "";
}

/** Add an `origin` remote pointing at `bareUrl`. */
function addOrigin(repo: string, bareUrl: string): void {
  execFileSync("git", ["remote", "add", "origin", bareUrl], {
    cwd: repo,
    stdio: "pipe",
  });
}

/** Push a branch to origin (with upstream). */
function gitPush(repo: string, branch: string): void {
  execFileSync("git", ["push", "-u", "origin", branch], {
    cwd: repo,
    stdio: "pipe",
  });
}

// ---------------------------------------------------------------------------
// CLI runner
// ---------------------------------------------------------------------------

function runCli(
  cwd: string,
  args: string[],
  stdin?: string,
): { stdout: string; stderr: string; status: number } {
  const options: ExecFileSyncOptions = {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    input: stdin,
  };
  try {
    const stdout = execFileSync("node", [cliPath, ...args], options);
    return { stdout: stdout.toString(), stderr: "", status: 0 };
  } catch (e: unknown) {
    const err = e as {
      stdout?: Buffer | string;
      stderr?: Buffer | string;
      status?: number;
    };
    return {
      stdout: (err.stdout ?? "").toString(),
      stderr: (err.stderr ?? "").toString(),
      status: err.status ?? 1,
    };
  }
}

// ---------------------------------------------------------------------------
// Build the CLI before all tests
// ---------------------------------------------------------------------------

beforeAll(() => {
  // Ensure the CLI is built — this must succeed or none of the tests can run
  try {
    execFileSync("pnpm", ["--filter", "@magpieweaver/task-phases", "build"], {
      cwd: resolve(__dirname, "../../../.."),
      stdio: "pipe",
    });
  } catch {
    // If build fails, the CLI won't exist — let the first test catch it
  }
}, 30000);

// ---------------------------------------------------------------------------
// §3.1 isDirty
// ---------------------------------------------------------------------------

describe("§3.1 isDirty", () => {
  it("reports false for a clean worktree (§3.1.1)", () => {
    const dir = tempDir();
    try {
      // Given: test/AAA-201 checked out with no changes of any kind
      const repo = initRepo(dir);
      createCommit(repo, "init.txt", "init", "init");
      execFileSync("git", ["checkout", "-b", "test/AAA-201"], {
        cwd: repo,
        stdio: "pipe",
      });

      // When
      const { stdout, status } = runCli(repo, ["--dev-testing", "git", "isDirty"]);

      // Then — exits 0 and reports false
      expect(status).toBe(0);
      expect(stdout).toContain("--dev-testing git isDirty: OK");
      const lines = stdout.trim().split("\n");
      expect(lines[1]).toBe("false");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports true when a tracked file has an unstaged edit (§3.1.2)", () => {
    const dir = tempDir();
    try {
      // Given: test/AAA-202 checked out with an unstaged modification
      const repo = initRepo(dir);
      createCommit(repo, "tracked.txt", "original", "init");
      execFileSync("git", ["checkout", "-b", "test/AAA-202"], {
        cwd: repo,
        stdio: "pipe",
      });
      writeFileSync(join(repo, "tracked.txt"), "modified", "utf-8");

      // When
      const { stdout, status } = runCli(repo, ["--dev-testing", "git", "isDirty"]);

      // Then — exits 0 and reports true
      expect(status).toBe(0);
      expect(stdout).toContain("--dev-testing git isDirty: OK");
      const lines = stdout.trim().split("\n");
      expect(lines[1]).toBe("true");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports true when an untracked file exists (§3.1.3)", () => {
    const dir = tempDir();
    try {
      // Given: test/AAA-203 checked out, otherwise clean, with a new
      // untracked file
      const repo = initRepo(dir);
      createCommit(repo, "tracked.txt", "content", "init");
      execFileSync("git", ["checkout", "-b", "test/AAA-203"], {
        cwd: repo,
        stdio: "pipe",
      });
      writeFileSync(join(repo, "untracked.txt"), "new file", "utf-8");

      // When
      const { stdout, status } = runCli(repo, ["--dev-testing", "git", "isDirty"]);

      // Then — exits 0 and reports true
      expect(status).toBe(0);
      expect(stdout).toContain("--dev-testing git isDirty: OK");
      const lines = stdout.trim().split("\n");
      expect(lines[1]).toBe("true");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// §3.2 hasCommitsBeyond
// ---------------------------------------------------------------------------

describe("§3.2 hasCommitsBeyond", () => {
  it("reports true when branch has commits parentBranch doesn't (§3.2.1)", () => {
    const dir = tempDir();
    try {
      // Given: test/AAA-204 has one commit that spec/AAA-204 doesn't
      const repo = initRepo(dir);
      createCommit(repo, "init.txt", "init", "init");
      createBranch(repo, "spec/AAA-204");
      execFileSync("git", ["checkout", "-b", "test/AAA-204"], {
        cwd: repo,
        stdio: "pipe",
      });
      createCommit(repo, "test.txt", "test work", "test commit");

      // When
      const { stdout, status } = runCli(
        repo,
        ["--dev-testing", "git", "hasCommitsBeyond", "-i"],
        JSON.stringify({ branch: "test/AAA-204", parentBranch: "spec/AAA-204" }),
      );

      // Then — exits 0 and reports true
      expect(status).toBe(0);
      expect(stdout).toContain("--dev-testing git hasCommitsBeyond: OK");
      const lines = stdout.trim().split("\n");
      expect(lines[1]).toBe("true");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports false when branch is level with parentBranch (§3.2.2)", () => {
    const dir = tempDir();
    try {
      // Given: spec/AAA-205 and test/AAA-205 point at the same commit
      const repo = initRepo(dir);
      createCommit(repo, "init.txt", "init", "init");
      createBranch(repo, "spec/AAA-205");
      execFileSync("git", ["checkout", "-b", "test/AAA-205"], {
        cwd: repo,
        stdio: "pipe",
      });

      // When
      const { stdout, status } = runCli(
        repo,
        ["--dev-testing", "git", "hasCommitsBeyond", "-i"],
        JSON.stringify({ branch: "test/AAA-205", parentBranch: "spec/AAA-205" }),
      );

      // Then — exits 0 and reports false
      expect(status).toBe(0);
      expect(stdout).toContain("--dev-testing git hasCommitsBeyond: OK");
      const lines = stdout.trim().split("\n");
      expect(lines[1]).toBe("false");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// §3.3 headCommitTitle
// ---------------------------------------------------------------------------

describe("§3.3 headCommitTitle", () => {
  it("reports the tip commit's exact subject line (§3.3.1)", () => {
    const dir = tempDir();
    try {
      // Given: build/AAA-206's tip commit has exactly this subject
      const repo = initRepo(dir);
      createCommit(repo, "init.txt", "init", "init");
      execFileSync("git", ["checkout", "-b", "build/AAA-206"], {
        cwd: repo,
        stdio: "pipe",
      });
      createCommit(repo, "impl.txt", "impl", "AAA-206: implement the thing");

      // When
      const { stdout, status } = runCli(
        repo,
        ["--dev-testing", "git", "headCommitTitle", "-i"],
        JSON.stringify({ branch: "build/AAA-206" }),
      );

      // Then — exits 0 and reports exactly the subject (no body lines)
      expect(status).toBe(0);
      expect(stdout).toContain("--dev-testing git headCommitTitle: OK");
      const lines = stdout.trim().split("\n");
      expect(JSON.parse(lines[1])).toBe("AAA-206: implement the thing");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// §3.4 pullFastForward
// ---------------------------------------------------------------------------

describe("§3.4 pullFastForward", () => {
  it("creates a missing local branch from origin without checking it out (§3.4.1)", () => {
    const bareDir = tempDir();
    const dir = tempDir();
    try {
      const upstream = initBareRepo(bareDir);
      const repo = initRepo(dir);
      addOrigin(repo, upstream);
      createCommit(repo, "init.txt", "init", "init");
      gitPush(repo, "main");

      // Given: origin/build/AAA-207 exists, but the local branch was
      // already deleted; main is checked out
      execFileSync("git", ["checkout", "-b", "build/AAA-207"], {
        cwd: repo,
        stdio: "pipe",
      });
      createCommit(repo, "build.txt", "build work", "build commit");
      gitPush(repo, "build/AAA-207");
      checkout(repo, "main");
      execFileSync("git", ["branch", "-D", "build/AAA-207"], {
        cwd: repo,
        stdio: "pipe",
      });
      expect(branchExistsLocal(repo, "build/AAA-207")).toBe(false);
      expect(branchExistsRemote(repo, "build/AAA-207")).toBe(true);

      // When
      const { stdout, status } = runCli(
        repo,
        ["--dev-testing", "git", "pullFastForward", "-i"],
        JSON.stringify({ branch: "build/AAA-207" }),
      );

      // Then — exits 0 and the local branch exists at origin's SHA
      expect(status).toBe(0);
      expect(stdout).toContain("--dev-testing git pullFastForward: OK");
      expect(branchExistsLocal(repo, "build/AAA-207")).toBe(true);
      expect(getSha(repo, "build/AAA-207")).toBe(getSha(repo, "origin/build/AAA-207"));

      // Then — the currently checked-out branch is unchanged
      const currentBranch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd: repo,
        encoding: "utf-8",
        stdio: "pipe",
      }).trim();
      expect(currentBranch).toBe("main");
    } finally {
      rmSync(bareDir, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fast-forwards an existing, non-diverged local branch (§3.4.2)", () => {
    const bareDir = tempDir();
    const dir = tempDir();
    try {
      const upstream = initBareRepo(bareDir);
      const repo = initRepo(dir);
      addOrigin(repo, upstream);
      createCommit(repo, "init.txt", "init", "init");
      gitPush(repo, "main");

      // Given: build/AAA-208 pushed at the init commit
      execFileSync("git", ["checkout", "-b", "build/AAA-208"], {
        cwd: repo,
        stdio: "pipe",
      });
      gitPush(repo, "build/AAA-208");
      const localBefore = getSha(repo, "build/AAA-208");
      checkout(repo, "main");

      // Given: origin/build/AAA-208 advances with a new commit (via a
      // temporary branch, so the local build/AAA-208 stays genuinely behind)
      execFileSync("git", ["branch", "tmp-advance", "build/AAA-208"], {
        cwd: repo,
        stdio: "pipe",
      });
      checkout(repo, "tmp-advance");
      createCommit(repo, "advance.txt", "advance", "advance commit");
      execFileSync("git", ["push", "origin", "tmp-advance:build/AAA-208"], {
        cwd: repo,
        stdio: "pipe",
      });
      checkout(repo, "main");
      execFileSync("git", ["fetch", "origin"], { cwd: repo, stdio: "pipe" });

      const originSha = getSha(repo, "origin/build/AAA-208");
      expect(originSha).not.toBe(localBefore);

      // When
      const { stdout, status } = runCli(
        repo,
        ["--dev-testing", "git", "pullFastForward", "-i"],
        JSON.stringify({ branch: "build/AAA-208" }),
      );

      // Then — local now matches origin
      expect(status).toBe(0);
      expect(stdout).toContain("--dev-testing git pullFastForward: OK");
      expect(getSha(repo, "build/AAA-208")).toBe(originSha);
    } finally {
      rmSync(bareDir, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a diverged local branch, leaving it unchanged (§3.4.3)", () => {
    const bareDir = tempDir();
    const dir = tempDir();
    try {
      const upstream = initBareRepo(bareDir);
      const repo = initRepo(dir);
      addOrigin(repo, upstream);
      createCommit(repo, "init.txt", "init", "init");
      gitPush(repo, "main");

      // Given: build/AAA-209 has a genuine local-only commit
      execFileSync("git", ["checkout", "-b", "build/AAA-209"], {
        cwd: repo,
        stdio: "pipe",
      });
      createCommit(repo, "local.txt", "local work", "local-only commit");
      const localSha = getSha(repo, "build/AAA-209");
      gitPush(repo, "build/AAA-209");
      checkout(repo, "main");

      // Given: origin/build/AAA-209 is rewritten to a different commit
      // (forced in the fixture, not by the CLI under test)
      execFileSync("git", ["branch", "tmp-diverge", "main"], {
        cwd: repo,
        stdio: "pipe",
      });
      checkout(repo, "tmp-diverge");
      createCommit(repo, "remote.txt", "remote work", "remote-only commit");
      execFileSync("git", ["push", "--force", "origin", "tmp-diverge:build/AAA-209"], {
        cwd: repo,
        stdio: "pipe",
      });
      checkout(repo, "main");
      execFileSync("git", ["fetch", "origin"], { cwd: repo, stdio: "pipe" });

      // Sanity: the branches have genuinely diverged
      expect(localSha).not.toBe(getSha(repo, "origin/build/AAA-209"));

      // When
      const { stdout, stderr, status } = runCli(
        repo,
        ["--dev-testing", "git", "pullFastForward", "-i"],
        JSON.stringify({ branch: "build/AAA-209" }),
      );

      // Then — the refusal is reported (exit 1), not an unhandled stack
      // trace — same treatment as MAG-46-01 §3.3.4
      expect(status).toBe(1);
      expect(stdout).toContain("--dev-testing git pullFastForward: FAILED");
      expect(stderr).not.toContain("Error:");

      // Then — the refusal is a *genuine* divergence refusal, not the
      // placeholder "not implemented" failure: the real implementation
      // must report its own message (e.g. that a fast-forward is
      // impossible), and this assertion goes red against the stub
      expect(stdout).not.toContain("not implemented");

      // Then — the local branch is completely unchanged
      expect(getSha(repo, "build/AAA-209")).toBe(localSha);
    } finally {
      rmSync(bareDir, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// §3.5 deleteBranch
// ---------------------------------------------------------------------------

describe("§3.5 deleteBranch", () => {
  it("deletes both the local and remote branch (§3.5.1)", () => {
    const bareDir = tempDir();
    const dir = tempDir();
    try {
      const upstream = initBareRepo(bareDir);
      const repo = initRepo(dir);
      addOrigin(repo, upstream);
      createCommit(repo, "init.txt", "init", "init");
      gitPush(repo, "main");

      // Given: task/AAA-210 exists both locally and on origin (main is
      // checked out, so the local branch can be deleted)
      execFileSync("git", ["checkout", "-b", "task/AAA-210"], {
        cwd: repo,
        stdio: "pipe",
      });
      gitPush(repo, "task/AAA-210");
      checkout(repo, "main");
      expect(branchExistsLocal(repo, "task/AAA-210")).toBe(true);
      expect(branchExistsRemote(repo, "task/AAA-210")).toBe(true);

      // When
      const { stdout, status } = runCli(
        repo,
        ["--dev-testing", "git", "deleteBranch", "-i"],
        JSON.stringify({ branch: "task/AAA-210" }),
      );

      // Then — exits 0 and both halves are gone
      expect(status).toBe(0);
      expect(stdout).toContain("--dev-testing git deleteBranch: OK");
      expect(branchExistsLocal(repo, "task/AAA-210")).toBe(false);
      expect(branchExistsRemote(repo, "task/AAA-210")).toBe(false);
    } finally {
      rmSync(bareDir, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("tolerates an already-absent local half (§3.5.2)", () => {
    const bareDir = tempDir();
    const dir = tempDir();
    try {
      const upstream = initBareRepo(bareDir);
      const repo = initRepo(dir);
      addOrigin(repo, upstream);
      createCommit(repo, "init.txt", "init", "init");
      gitPush(repo, "main");

      // Given: task/AAA-211 exists on origin but was already deleted
      // locally (e.g. a previously-interrupted cleanup)
      execFileSync("git", ["checkout", "-b", "task/AAA-211"], {
        cwd: repo,
        stdio: "pipe",
      });
      gitPush(repo, "task/AAA-211");
      checkout(repo, "main");
      execFileSync("git", ["branch", "-D", "task/AAA-211"], {
        cwd: repo,
        stdio: "pipe",
      });
      expect(branchExistsLocal(repo, "task/AAA-211")).toBe(false);
      expect(branchExistsRemote(repo, "task/AAA-211")).toBe(true);

      // When
      const { stdout, status } = runCli(
        repo,
        ["--dev-testing", "git", "deleteBranch", "-i"],
        JSON.stringify({ branch: "task/AAA-211" }),
      );

      // Then — exits 0 and the remote half is gone
      expect(status).toBe(0);
      expect(stdout).toContain("--dev-testing git deleteBranch: OK");
      expect(branchExistsRemote(repo, "task/AAA-211")).toBe(false);
    } finally {
      rmSync(bareDir, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
