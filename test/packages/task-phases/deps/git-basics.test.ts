/**
 * System tests for `--dev-testing git <method>` real-world execution.
 *
 * Every test spawns the built CLI as a subprocess against a real (temporary)
 * git repository — never calls into `cli.ts` exports directly.
 *
 * Spec: MAG-46-01  §3.1 Read-only primitives, §3.2 Mutating primitives,
 *                  §3.2.5 cwd-resolution, §3.3 Error handling.
 *
 * All `RealGitTool` methods throw "not implemented" during the test phase,
 * so every test that reaches a real git call fails as required.
 */

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

/** Create an initial commit on the current branch so the repo has a root. */
function createCommit(
  repo: string,
  fileName: string,
  content: string,
  msg: string,
): string {
  writeFileSync(join(repo, fileName), content, "utf-8");
  execFileSync("git", ["add", fileName], { cwd: repo, stdio: "pipe" });
  const result = execFileSync("git", ["commit", "-m", msg], {
    cwd: repo,
    encoding: "utf-8",
    stdio: "pipe",
  });
  // return the SHA of the new commit
  const sha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repo,
    encoding: "utf-8",
    stdio: "pipe",
  }).trim();
  return sha;
}

/** Create a branch (without switching to it) */
function createBranch(repo: string, branch: string, fromRef = "HEAD"): void {
  execFileSync("git", ["branch", branch, fromRef], { cwd: repo, stdio: "pipe" });
}

/** Checkout a branch */
function checkout(repo: string, branch: string): void {
  execFileSync("git", ["checkout", branch], { cwd: repo, stdio: "pipe" });
}

/** Return the current SHA of a given ref */
function getSha(repo: string, ref: string): string {
  return execFileSync("git", ["rev-parse", ref], {
    cwd: repo,
    encoding: "utf-8",
    stdio: "pipe",
  }).trim();
}

/** Add an `origin` remote pointing at `bareUrl`. */
function addOrigin(repo: string, bareUrl: string): void {
  execFileSync("git", ["remote", "add", "origin", bareUrl], {
    cwd: repo,
    stdio: "pipe",
  });
}

/** Push a branch to origin. */
function gitPush(repo: string, branch: string): void {
  execFileSync("git", ["push", "-u", "origin", branch], {
    cwd: repo,
    stdio: "pipe",
  });
}

/** Clone a bare origin into a new working-copy directory. */
function cloneRepo(originPath: string, dest: string): string {
  execFileSync("git", ["clone", originPath, dest], { stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "test@test"], {
    cwd: dest,
    stdio: "pipe",
  });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dest, stdio: "pipe" });
  execFileSync("git", ["config", "commit.gpgsign", "false"], {
    cwd: dest,
    stdio: "pipe",
  });
  return dest;
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
// §3.1 Read-only Primitives
// ---------------------------------------------------------------------------

describe("§3.1 Read-only primitives", () => {
  // §3.1.1 fetch
  describe("§3.1.1 fetch", () => {
    it("exits 0 and fetches new commits from origin", () => {
      const bareDir = tempDir();
      const cloneDir = tempDir();
      try {
        // Given: a bare origin with one commit
        const upstream = initBareRepo(bareDir);
        const working = initRepo(tempDir());
        addOrigin(working, upstream);
        createCommit(working, "initial.txt", "initial", "initial commit");
        gitPush(working, "main");

        // Given: a local clone with that commit
        const local = cloneRepo(upstream, cloneDir);

        // Given: the origin has a commit not yet present locally
        // (push another commit from the working repo)
        createCommit(working, "new.txt", "new content", "second commit");
        gitPush(working, "main");

        // Capture the new SHA from origin before fetching
        const expectedSha = getSha(upstream, "main");

        // When — fetch
        const { stdout, status } = runCli(local, [
          "--dev-testing",
          "git",
          "fetch",
        ]);

        // Then — exits 0
        expect(status).toBe(0);

        // Then — origin/main now includes the new commit
        const localOriginMain = getSha(local, "origin/main");
        expect(localOriginMain).toBe(expectedSha);
      } finally {
        rmSync(bareDir, { recursive: true, force: true });
        rmSync(cloneDir, { recursive: true, force: true });
      }
    });
  });

  // §3.1.2 currentBranch
  describe("§3.1.2 currentBranch", () => {
    it("reports the current checked-out branch name", () => {
      const dir = tempDir();
      try {
        // Given: repo has test/AAA-001 checked out
        const repo = initRepo(dir);
        createCommit(repo, "init.txt", "init", "init");
        execFileSync("git", ["checkout", "-b", "test/AAA-001"], {
          cwd: repo,
          stdio: "pipe",
        });

        // When
        const { stdout, status } = runCli(repo, [
          "--dev-testing",
          "git",
          "currentBranch",
        ]);

        // Then — exits 0 and reports exactly "test/AAA-001"
        expect(status).toBe(0);
        expect(stdout).toContain("--dev-testing git currentBranch: OK");

        // The second line should be the JSON value
        const lines = stdout.trim().split("\n");
        expect(lines[1]).toBe('"test/AAA-001"');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  // §3.1.3 branchExists — local and remote
  describe("§3.1.3 branchExists", () => {
    it("returns true for a local branch that has not been pushed", () => {
      const dir = tempDir();
      try {
        // Given: spec/AAA-002 exists locally but has never been pushed
        const repo = initRepo(dir);
        createCommit(repo, "init.txt", "init", "init");
        createBranch(repo, "spec/AAA-002");

        // When — local check
        const { stdout, status } = runCli(repo, [
          "--dev-testing",
          "git",
          "branchExists",
          "-i",
        ], JSON.stringify({ branch: "spec/AAA-002" }));

        // Then — true
        expect(status).toBe(0);
        expect(stdout).toContain("--dev-testing git branchExists: OK");
        expect(stdout).toContain("true");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("returns false for a local-only branch when checking remote", () => {
      const bareDir = tempDir();
      const dir = tempDir();
      try {
        // Given: a local branch that has never been pushed
        const upstream = initBareRepo(bareDir);
        const repo = initRepo(dir);
        addOrigin(repo, upstream);
        createCommit(repo, "init.txt", "init", "init");
        gitPush(repo, "main");
        createBranch(repo, "spec/AAA-002");

        // When — remote check
        const { stdout, status } = runCli(repo, [
          "--dev-testing",
          "git",
          "branchExists",
          "-i",
        ], JSON.stringify({ branch: "spec/AAA-002", opts: { remote: true } }));

        // Then — false
        expect(status).toBe(0);
        expect(stdout).toContain("--dev-testing git branchExists: OK");
        expect(stdout).toContain("false");
      } finally {
        rmSync(bareDir, { recursive: true, force: true });
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  // §3.1.4 headSha
  describe("§3.1.4 headSha", () => {
    it("returns the SHA of the given branch's tip", () => {
      const dir = tempDir();
      try {
        // Given: build/AAA-003 exists with a known commit at its tip
        const repo = initRepo(dir);
        const sha = createCommit(repo, "init.txt", "init", "init");
        createBranch(repo, "build/AAA-003");

        // When
        const { stdout, status } = runCli(repo, [
          "--dev-testing",
          "git",
          "headSha",
          "-i",
        ], JSON.stringify({ branch: "build/AAA-003" }));

        // Then — SHA matches
        expect(status).toBe(0);
        expect(stdout).toContain("--dev-testing git headSha: OK");
        expect(stdout).toContain(sha);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});

// ---------------------------------------------------------------------------
// §3.2 Mutating Primitives
// ---------------------------------------------------------------------------

describe("§3.2 Mutating primitives", () => {
  // §3.2.1 createBranch does not push
  describe("§3.2.1 createBranch does not push", () => {
    it("creates a local branch and checks it out without pushing", () => {
      const bareDir = tempDir();
      const dir = tempDir();
      try {
        const upstream = initBareRepo(bareDir);
        const repo = initRepo(dir);
        addOrigin(repo, upstream);
        createCommit(repo, "init.txt", "init", "init");
        gitPush(repo, "main");
        checkout(repo, "main");

        // Given: spec/AAA-004 exists and is checked out
        execFileSync("git", ["checkout", "-b", "spec/AAA-004"], {
          cwd: repo,
          stdio: "pipe",
        });

        // Given: test/AAA-004 does not exist locally or on origin
        // (verified by checking for absence)
        // (it doesn't exist, so we're good)

        // When
        const { stdout, status } = runCli(repo, [
          "--dev-testing",
          "git",
          "createBranch",
          "-i",
        ], JSON.stringify({ newBranch: "test/AAA-004", fromRef: "spec/AAA-004" }));

        // Then — exits 0
        expect(status).toBe(0);

        // Then — test/AAA-004 exists locally
        const localBranches = execFileSync("git", ["branch"], {
          cwd: repo,
          encoding: "utf-8",
          stdio: "pipe",
        });
        expect(localBranches).toContain("test/AAA-004");

        // Then — test/AAA-004 is checked out
        const currentBranch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
          cwd: repo,
          encoding: "utf-8",
          stdio: "pipe",
        }).trim();
        expect(currentBranch).toBe("test/AAA-004");

        // Then — test/AAA-004 does NOT exist on origin
        const remoteRefs = execFileSync("git", ["ls-remote", "origin", "test/AAA-004"], {
          cwd: repo,
          encoding: "utf-8",
          stdio: "pipe",
        }).trim();
        expect(remoteRefs).toBe("");
      } finally {
        rmSync(bareDir, { recursive: true, force: true });
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  // §3.2.2 checkout an existing branch
  describe("§3.2.2 checkout an existing branch", () => {
    it("switches to the named branch", () => {
      const bareDir = tempDir();
      const dir = tempDir();
      try {
        const upstream = initBareRepo(bareDir);
        const repo = initRepo(dir);
        addOrigin(repo, upstream);
        createCommit(repo, "init.txt", "init", "init");
        gitPush(repo, "main");

        // Given: test/AAA-004 exists locally
        createBranch(repo, "test/AAA-004");

        // Given: main is checked out
        checkout(repo, "main");

        // When
        const { stdout, status } = runCli(repo, [
          "--dev-testing",
          "git",
          "checkout",
          "-i",
        ], JSON.stringify({ branch: "test/AAA-004" }));

        // Then — exits 0
        expect(status).toBe(0);

        // Then — current branch is test/AAA-004
        const currentBranch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
          cwd: repo,
          encoding: "utf-8",
          stdio: "pipe",
        }).trim();
        expect(currentBranch).toBe("test/AAA-004");
      } finally {
        rmSync(bareDir, { recursive: true, force: true });
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  // §3.2.3 commitAll
  describe("§3.2.3 commitAll stages and commits everything, returns SHA", () => {
    it("commits staged and untracked changes, cleans worktree, returns SHA", () => {
      const dir = tempDir();
      try {
        // Given: test/AAA-004 is checked out
        const repo = initRepo(dir);
        createCommit(repo, "tracked.txt", "original", "init");
        execFileSync("git", ["checkout", "-b", "test/AAA-004"], {
          cwd: repo,
          stdio: "pipe",
        });

        // Given: tracked file has unstaged modification
        writeFileSync(join(repo, "tracked.txt"), "modified", "utf-8");

        // Given: new untracked file exists
        writeFileSync(join(repo, "untracked.txt"), "new file", "utf-8");

        // When
        const { stdout, status } = runCli(repo, [
          "--dev-testing",
          "git",
          "commitAll",
          "-i",
        ], JSON.stringify({ title: "AAA-004 WIP", message: "note" }));

        // Then — exits 0
        expect(status).toBe(0);
        expect(stdout).toContain("--dev-testing git commitAll: OK");

        // Then — the reported value is the new commit's real SHA
        const lines = stdout.trim().split("\n");
        const reportedSha = JSON.parse(lines[1]);
        const actualSha = getSha(repo, "HEAD");
        expect(reportedSha).toBe(actualSha);

        // Then — both the modification and new file are committed
        const diff = execFileSync("git", ["diff", "--name-only", "HEAD~1"], {
          cwd: repo,
          encoding: "utf-8",
          stdio: "pipe",
        });
        expect(diff).toContain("tracked.txt");
        expect(diff).toContain("untracked.txt");

        // Then — worktree is clean
        const statusOut = execFileSync("git", ["status", "--porcelain"], {
          cwd: repo,
          encoding: "utf-8",
          stdio: "pipe",
        }).trim();
        expect(statusOut).toBe("");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  // §3.2.4 push
  describe("§3.2.4 push publishes a local branch", () => {
    it("pushes a local branch to origin", () => {
      const bareDir = tempDir();
      const dir = tempDir();
      try {
        const upstream = initBareRepo(bareDir);
        const repo = initRepo(dir);
        addOrigin(repo, upstream);

        // Given: test/AAA-004 exists locally with a commit
        createCommit(repo, "init.txt", "init", "init");
        execFileSync("git", ["checkout", "-b", "test/AAA-004"], {
          cwd: repo,
          stdio: "pipe",
        });
        createCommit(repo, "feature.txt", "feature", "feature commit");

        // Given: test/AAA-004 does not exist on origin
        const prePush = execFileSync("git", ["ls-remote", "origin", "test/AAA-004"], {
          cwd: repo,
          encoding: "utf-8",
          stdio: "pipe",
        }).trim();
        expect(prePush).toBe("");

        // When
        const { stdout, status } = runCli(repo, [
          "--dev-testing",
          "git",
          "push",
          "-i",
        ], JSON.stringify({ branch: "test/AAA-004" }));

        // Then — exits 0
        expect(status).toBe(0);

        // Then — origin/test/AAA-004 now exists
        const postPush = execFileSync("git", ["ls-remote", "origin", "test/AAA-004"], {
          cwd: repo,
          encoding: "utf-8",
          stdio: "pipe",
        }).trim();
        expect(postPush).not.toBe("");

        // Then — it matches the local SHA
        const localSha = getSha(repo, "test/AAA-004");
        const remoteSha = postPush.split("\t")[0];
        expect(remoteSha).toBe(localSha);
      } finally {
        rmSync(bareDir, { recursive: true, force: true });
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});

// ---------------------------------------------------------------------------
// §3.2.5 Working-directory resolution
// ---------------------------------------------------------------------------

describe("§3.2.5 Working-directory resolution", () => {
  it("resolves the repo relative to cwd, not to task-phases install location", () => {
    const sandbox1Dir = tempDir();
    const sandbox2Dir = tempDir();
    try {
      // Given: first sandbox repo with sandbox-branch checked out
      const sandbox1 = initRepo(sandbox1Dir);
      createCommit(sandbox1, "f1.txt", "file1", "init");
      execFileSync("git", ["checkout", "-b", "sandbox-branch"], {
        cwd: sandbox1,
        stdio: "pipe",
      });

      // Given: second fixture repo with a different branch checked out
      const sandbox2 = initRepo(sandbox2Dir);
      createCommit(sandbox2, "f2.txt", "file2", "init");
      execFileSync("git", ["checkout", "-b", "second-branch"], {
        cwd: sandbox2,
        stdio: "pipe",
      });

      // When — invoke CLI with cwd = sandbox1
      const result1 = runCli(sandbox1, [
        "--dev-testing",
        "git",
        "currentBranch",
      ]);

      // Then — reports sandbox1's branch
      expect(result1.status).toBe(0);
      expect(result1.stdout).toContain("--dev-testing git currentBranch: OK");
      const lines1 = result1.stdout.trim().split("\n");
      expect(lines1[1]).toBe('"sandbox-branch"');

      // When — invoke CLI with cwd = sandbox2
      const result2 = runCli(sandbox2, [
        "--dev-testing",
        "git",
        "currentBranch",
      ]);

      // Then — reports sandbox2's branch (different from sandbox1)
      expect(result2.status).toBe(0);
      expect(result2.stdout).toContain("--dev-testing git currentBranch: OK");
      const lines2 = result2.stdout.trim().split("\n");
      expect(lines2[1]).toBe('"second-branch"');
    } finally {
      rmSync(sandbox1Dir, { recursive: true, force: true });
      rmSync(sandbox2Dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// §3.3 Error Handling
// ---------------------------------------------------------------------------

describe("§3.3 Error handling", () => {
  // §3.3.1 Unknown tool
  describe("§3.3.1 Unknown tool", () => {
    it("rejects an unknown tool name with exit code 2", () => {
      // When — completely made-up tool
      const { stdout, status } = runCli(process.cwd(), [
        "--dev-testing",
        "frobnicate",
        "currentBranch",
      ]);

      // Then — message states frobnicate is not recognised
      expect(status).toBe(2);
      expect(stdout).toContain("frobnicate");
    });
  });

  // §3.3.2 Unknown method on a known tool
  describe("§3.3.2 Unknown method on a known tool", () => {
    it("rejects an unknown method on git with exit code 2", () => {
      // When — method that doesn't exist on git
      const { stdout, status } = runCli(process.cwd(), [
        "--dev-testing",
        "git",
        "doesNotExist",
      ]);

      // Then — message states the method is not recognised
      expect(status).toBe(2);
      expect(stdout).toContain("doesNotExist");
      expect(stdout).toContain("git");
    });
  });

  // §3.3.3 Malformed JSON args is rejected before any git call
  describe("§3.3.3 Malformed JSON args", () => {
    it("rejects malformed JSON on stdin with exit code 2, without making a git call", () => {
      const { stdout, status } = runCli(
        process.cwd(),
        ["--dev-testing", "git", "headSha", "-i"],
        "{not valid json",
      );

      // Then — exit code 2 (invalid argument)
      expect(status).toBe(2);
      expect(stdout).toContain("Malformed JSON");
    });
  });

  // §3.3.4 Real git failure is reported, not thrown uncaught
  describe("§3.3.4 Real git failure is reported", () => {
    it("exits non-zero with a git error, not an unhandled stack trace", () => {
      const dir = tempDir();
      try {
        // Given — a valid repo without the ref
        const repo = initRepo(dir);
        createCommit(repo, "init.txt", "init", "init");

        // When — ask for SHA of a non-existent branch
        const { stdout, stderr, status } = runCli(repo, [
          "--dev-testing",
          "git",
          "headSha",
          "-i",
        ], JSON.stringify({ branch: "does-not-exist" }));

        // Then — exits non-zero
        expect(status).not.toBe(0);
        expect(status).toBe(1);

        // Then — the error message is surfaced in the output
        // (currently "not implemented" from RealGitTool; after implementation
        //  it will be a real git error message)
        expect(stdout).toContain("--dev-testing git headSha: FAILED");
        // The error must NOT be an unhandled stack trace (no "Error:" prefix
        // from uncaught exception — the CLI catches and formats it)
        expect(stderr).not.toContain("Error:");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
