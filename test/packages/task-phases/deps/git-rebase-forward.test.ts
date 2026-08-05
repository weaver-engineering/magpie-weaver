/**
 * System tests for `--dev-testing git rebase <branch> <ontoRef>` real-world
 * execution of the `rebase()` primitive — the single riskiest operation in
 * the whole task-phasing design, and the last `RealGitTool` method to stay
 * stubbed (LLD §4.8, §3.5, Appendix §3.5.a/§3.5.b).
 *
 * Every test spawns the built CLI as a subprocess against a real (temporary)
 * git repository — never calls into `cli.ts` exports directly. §3.1/§3.2/§3.4/
 * §3.5 use plain local repos; §3.3 uses a local bare repo as `origin` so
 * `origin/build/{ref}` genuinely exists (spec-01 precedent), no network
 * involved.
 *
 * `rebase(branch, ontoRef)` takes exactly two named arguments — the JSON
 * envelope is always `{"branch": "...", "ontoRef": "..."}`, with `ontoRef` a
 * concretely resolvable ref (a local branch or a remote-tracking ref), never
 * a placeholder (§2.1).
 *
 * Each fixture's upstream derivation is exercised implicitly by the Then
 * clauses: the amended-spec and build-reorder fixtures put the branch's one
 * unique commit *after* a boundary that is still on the onto-ref's history
 * (the old spec commit for §3.1, the old test content for §3.3), so the
 * implementation's `upstream = mergeBase(branch, ontoRef)` — the LLD §4.8
 * prescription — finds the exact one-commit boundary. The main-drift and
 * two-commit fixtures exercise the same derivation from the other side.
 *
 * All of §3.1–§3.5 fail against the pre-implementation codebase:
 * `RealGitTool.rebase`/`RealGitTool.mergeBase` throw "not implemented", so
 * every run that reaches a real git call reports FAILED. §3.6 (malformed
 * JSON) is rejected by the CLI's arg parsing before any tool call, so it
 * passes from the start.
 *
 * Spec: MAG-46-13  §3.1 spec-amended-under-test, §3.2 main-drift, §3.3
 * build-reorder, §3.4 commit-count precondition, §3.5 conflict reporting,
 * §3.6 malformed-JSON rejection.
 */

// Implements: task-MAG-46-13-dev-testing-git-rebase-forward-spec.md

import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
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
 *  new commit's SHA. Overwrites an existing file of the same name. */
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
// Assertion helpers (real git reads)
// ---------------------------------------------------------------------------

/** The subject line of a ref's tip commit. */
function subject(repo: string, ref: string): string {
  return execFileSync("git", ["log", "-1", "--format=%s", ref], {
    cwd: repo,
    encoding: "utf-8",
    stdio: "pipe",
  }).trim();
}

/** All subject lines of a ref's history, tip first. */
function subjects(repo: string, ref: string): string[] {
  return execFileSync("git", ["log", "--format=%s", ref], {
    cwd: repo,
    encoding: "utf-8",
    stdio: "pipe",
  })
    .trim()
    .split("\n")
    .filter((line) => line !== "");
}

/** True if `ancestor` is an ancestor of `descendant` (exit 0 of
 *  `merge-base --is-ancestor` is true, exit 1 a legitimate false). */
function isAncestor(repo: string, ancestor: string, descendant: string): boolean {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
      cwd: repo,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

/** `git rev-list --count <refA>..<refB>` — commits unique to `refB`
 *  relative to `refA`. `refA` may be a ref name or a raw SHA. */
function countBetween(repo: string, refA: string, refB: string): number {
  return Number(
    execFileSync("git", ["rev-list", "--count", `${refA}..${refB}`], {
      cwd: repo,
      encoding: "utf-8",
      stdio: "pipe",
    }).trim(),
  );
}

/** `git status --porcelain` of the working tree. */
function porcelain(repo: string): string {
  return execFileSync("git", ["status", "--porcelain"], {
    cwd: repo,
    encoding: "utf-8",
    stdio: "pipe",
  }).trim();
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

/** Parses the single JSON document the dev-testing path emits as its second
 *  output line after the `--dev-testing git rebase: OK` status line. */
function parseOutcome(stdout: string): Record<string, unknown> {
  const lines = stdout.trim().split("\n");
  expect(lines[0]).toContain("--dev-testing git rebase: OK");
  return JSON.parse(lines[1]) as Record<string, unknown>;
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
// §3.1 spec-amended-under-test: ordinary rebase-forward
// ---------------------------------------------------------------------------

describe("§3.1 spec-amended-under-test: ordinary rebase-forward", () => {
  it("rebases test/{ref}'s one commit onto spec/{ref}'s amended HEAD (§3.1)", () => {
    const dir = tempDir();
    try {
      const repo = initRepo(dir);

      // Given: spec/AAA-001 has an amended commit past test/AAA-001's
      // original fork point (the fork point is the old spec commit; the
      // amendment is a new commit on top of it), and test/AAA-001 has
      // exactly one commit of its own, with no conflicting changes.
      execFileSync("git", ["checkout", "-b", "spec/AAA-001"], {
        cwd: repo,
        stdio: "pipe",
      });
      createCommit(repo, "spec.txt", "spec", "spec commit");
      execFileSync("git", ["checkout", "-b", "test/AAA-001"], {
        cwd: repo,
        stdio: "pipe",
      });
      createCommit(repo, "test.txt", "test", "test commit");
      checkout(repo, "spec/AAA-001");
      createCommit(repo, "amend.txt", "amended", "amended spec commit");

      // Fixture sanity: spec is NOT an ancestor of test (the amendment
      // orphaned test), and test has exactly one commit of its own.
      expect(isAncestor(repo, "spec/AAA-001", "test/AAA-001")).toBe(false);
      expect(countBetween(repo, "spec/AAA-001", "test/AAA-001")).toBe(1);

      // When
      const { stdout, status } = runCli(
        repo,
        ["--dev-testing", "git", "rebase", "-i"],
        JSON.stringify({ branch: "test/AAA-001", ontoRef: "spec/AAA-001" }),
      );

      // Then — reported outcome is ok
      expect(status).toBe(0);
      expect(parseOutcome(stdout)).toEqual({ status: "ok" });

      // Then — test/AAA-001's one commit now sits on top of spec/AAA-001's
      // amended HEAD: spec is an ancestor again, test still has exactly its
      // one commit beyond spec, and that commit is the test commit.
      expect(isAncestor(repo, "spec/AAA-001", "test/AAA-001")).toBe(true);
      expect(countBetween(repo, "spec/AAA-001", "test/AAA-001")).toBe(1);
      expect(subject(repo, "test/AAA-001")).toBe("test commit");
      expect(readFileSync(join(repo, "test.txt"), "utf-8")).toBe("test");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// §3.2 main-drift: spec/{ref} rebased onto a newer main
// ---------------------------------------------------------------------------

describe("§3.2 main-drift: spec/{ref} rebased onto a newer main", () => {
  it("rebases spec/{ref}'s commit onto main's current tip (§3.2)", () => {
    const dir = tempDir();
    try {
      const repo = initRepo(dir);

      // Given: spec/AAA-002 has exactly one commit of its own, forked from
      // main before main advanced (other tasks merged).
      execFileSync("git", ["checkout", "-b", "spec/AAA-002"], {
        cwd: repo,
        stdio: "pipe",
      });
      createCommit(repo, "spec.txt", "spec", "spec commit");
      checkout(repo, "main");
      createCommit(repo, "other1.txt", "one", "other task one");
      createCommit(repo, "other2.txt", "two", "other task two");

      // Fixture sanity: main is not an ancestor of the branch, and the
      // branch has exactly one commit of its own.
      expect(isAncestor(repo, "main", "spec/AAA-002")).toBe(false);
      expect(countBetween(repo, "main", "spec/AAA-002")).toBe(1);

      // When
      const { stdout, status } = runCli(
        repo,
        ["--dev-testing", "git", "rebase", "-i"],
        JSON.stringify({ branch: "spec/AAA-002", ontoRef: "main" }),
      );

      // Then — reported outcome is ok
      expect(status).toBe(0);
      expect(parseOutcome(stdout)).toEqual({ status: "ok" });

      // Then — spec/AAA-002's commit now sits on top of main's current tip:
      // its parent is main's tip, main is an ancestor, and the branch still
      // has exactly its one commit beyond main.
      expect(getSha(repo, "spec/AAA-002^")).toBe(getSha(repo, "main"));
      expect(isAncestor(repo, "main", "spec/AAA-002")).toBe(true);
      expect(countBetween(repo, "main", "spec/AAA-002")).toBe(1);
      expect(subject(repo, "spec/AAA-002")).toBe("spec commit");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// §3.3 build-reorder: onto a fresh test→build merge result
// ---------------------------------------------------------------------------

describe("§3.3 build-reorder: onto a fresh test→build merge result", () => {
  it("rebases the pre-existing build commit onto the fresh merge, restoring spec, test(new), build order (§3.3)", () => {
    const bareDir = tempDir();
    const dir = tempDir();
    try {
      const upstream = initBareRepo(bareDir);
      const repo = initRepo(dir);
      addOrigin(repo, upstream);
      createCommit(repo, "init.txt", "init", "init");
      gitPush(repo, "main");

      // Given: a first Build Gate PR (test/AAA-003 → build/AAA-003) merged
      // rebase-style, so origin/build/AAA-003 = spec + test-old.
      execFileSync("git", ["checkout", "-b", "spec/AAA-003"], {
        cwd: repo,
        stdio: "pipe",
      });
      createCommit(repo, "spec.txt", "spec", "spec commit");
      execFileSync("git", ["checkout", "-b", "test/AAA-003"], {
        cwd: repo,
        stdio: "pipe",
      });
      createCommit(repo, "test.txt", "test one", "test commit v1");
      execFileSync("git", ["push", "origin", "test/AAA-003:build/AAA-003"], {
        cwd: repo,
        stdio: "pipe",
      });

      // Given: build/AAA-003 then received one build-phase commit (local
      // WIP only — never pushed to origin).
      execFileSync("git", ["checkout", "-b", "build/AAA-003", "origin/build/AAA-003"], {
        cwd: repo,
        stdio: "pipe",
      });
      createCommit(repo, "build.txt", "build", "build commit");

      // Given: test/AAA-003 was subsequently amended (new test content on
      // top of the old) and a second Build Gate PR also merged — a
      // superseded merge. Simulate GitHub's rebase-merge of the second PR:
      // replay test's new commit onto the current origin/build tip and
      // publish it, leaving origin/build/AAA-003 = spec, test-old, test-new.
      checkout(repo, "test/AAA-003");
      createCommit(repo, "test2.txt", "test two", "test commit v2");
      execFileSync("git", ["checkout", "-b", "tmp-rebase", "origin/build/AAA-003"], {
        cwd: repo,
        stdio: "pipe",
      });
      execFileSync("git", ["cherry-pick", getSha(repo, "test/AAA-003")], {
        cwd: repo,
        stdio: "pipe",
      });
      execFileSync("git", ["push", "origin", "tmp-rebase:build/AAA-003"], {
        cwd: repo,
        stdio: "pipe",
      });
      checkout(repo, "build/AAA-003");
      execFileSync("git", ["branch", "-D", "tmp-rebase"], {
        cwd: repo,
        stdio: "pipe",
      });
      execFileSync("git", ["fetch", "origin"], { cwd: repo, stdio: "pipe" });

      // Fixture sanity: origin/build reflects the state after the second
      // merge; local build/AAA-003 carries exactly one pre-existing build
      // commit, and it does NOT yet sit after the fresh merge content.
      expect(subject(repo, "origin/build/AAA-003")).toBe("test commit v2");
      expect(countBetween(repo, "origin/build/AAA-003", "build/AAA-003")).toBe(1);
      expect(getSha(repo, "build/AAA-003^")).not.toBe(getSha(repo, "origin/build/AAA-003"));

      // When
      const { stdout, status } = runCli(
        repo,
        ["--dev-testing", "git", "rebase", "-i"],
        JSON.stringify({ branch: "build/AAA-003", ontoRef: "origin/build/AAA-003" }),
      );

      // Then — reported outcome is ok
      expect(status).toBe(0);
      expect(parseOutcome(stdout)).toEqual({ status: "ok" });

      // Then — the pre-existing build commit now sits after the fresh merge,
      // not before it: its parent is the fresh merge result's tip, and the
      // order is spec, test(new), build.
      expect(getSha(repo, "build/AAA-003^")).toBe(getSha(repo, "origin/build/AAA-003"));
      expect(subjects(repo, "build/AAA-003")).toEqual([
        "build commit",
        "test commit v2",
        "test commit v1",
        "spec commit",
        "init",
      ]);
    } finally {
      rmSync(bareDir, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// §3.4 commit-count precondition refuses cleanly
// ---------------------------------------------------------------------------

describe("§3.4 commit-count precondition refuses cleanly", () => {
  it("reports unexpected-commit-count and leaves the branch completely untouched (§3.4)", () => {
    const dir = tempDir();
    try {
      const repo = initRepo(dir);

      // Given: test/AAA-004 has two commits beyond spec/AAA-004 (an agent
      // stacked two wip commits without squashing).
      execFileSync("git", ["checkout", "-b", "spec/AAA-004"], {
        cwd: repo,
        stdio: "pipe",
      });
      createCommit(repo, "spec.txt", "spec", "spec commit");
      execFileSync("git", ["checkout", "-b", "test/AAA-004"], {
        cwd: repo,
        stdio: "pipe",
      });
      createCommit(repo, "wip1.txt", "one", "wip one");
      createCommit(repo, "wip2.txt", "two", "wip two");
      const originalSha = getSha(repo, "test/AAA-004");

      // When
      const { stdout, status } = runCli(
        repo,
        ["--dev-testing", "git", "rebase", "-i"],
        JSON.stringify({ branch: "test/AAA-004", ontoRef: "spec/AAA-004" }),
      );

      // Then — the precondition refusal is reported as its own outcome,
      // before any rewrite is attempted.
      expect(status).toBe(0);
      const outcome = parseOutcome(stdout);
      expect(outcome.status).toBe("unexpected-commit-count");
      expect(outcome.expected).toBe(1);
      expect(outcome.actual).toBe(2);

      // Then — test/AAA-004 is completely untouched: still its original
      // two commits, not partially rebased.
      expect(getSha(repo, "test/AAA-004")).toBe(originalSha);
      expect(subjects(repo, "test/AAA-004")).toEqual([
        "wip two",
        "wip one",
        "spec commit",
        "init",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a branch with zero commits of its own, leaving it untouched (§3.4)", () => {
    const dir = tempDir();
    try {
      const repo = initRepo(dir);

      // Given: test/AAA-004b has NO commit of its own — it points at
      // spec/AAA-004b exactly (e.g. an agent forked but never committed).
      execFileSync("git", ["checkout", "-b", "spec/AAA-004b"], {
        cwd: repo,
        stdio: "pipe",
      });
      createCommit(repo, "spec.txt", "spec", "spec commit");
      execFileSync("git", ["checkout", "-b", "test/AAA-004b"], {
        cwd: repo,
        stdio: "pipe",
      });
      const originalSha = getSha(repo, "test/AAA-004b");

      // When
      const { stdout, status } = runCli(
        repo,
        ["--dev-testing", "git", "rebase", "-i"],
        JSON.stringify({ branch: "test/AAA-004b", ontoRef: "spec/AAA-004b" }),
      );

      // Then — the same clean refusal, reported as its own outcome with the
      // actual count of zero.
      expect(status).toBe(0);
      const outcome = parseOutcome(stdout);
      expect(outcome.status).toBe("unexpected-commit-count");
      expect(outcome.expected).toBe(1);
      expect(outcome.actual).toBe(0);

      // Then — the branch is completely untouched (nothing was rewritten).
      expect(getSha(repo, "test/AAA-004b")).toBe(originalSha);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// §3.5 genuine conflict is reported, not resolved
// ---------------------------------------------------------------------------

describe("§3.5 genuine conflict is reported, not resolved", () => {
  it("reports conflict with real details and leaves the repository mid-rebase (§3.5)", () => {
    const dir = tempDir();
    try {
      const repo = initRepo(dir);

      // Given: spec/AAA-005's amendment and test/AAA-005's one commit both
      // modify the same line of the same file, incompatibly.
      execFileSync("git", ["checkout", "-b", "spec/AAA-005"], {
        cwd: repo,
        stdio: "pipe",
      });
      createCommit(repo, "config.txt", "value=1", "spec commit");
      execFileSync("git", ["checkout", "-b", "test/AAA-005"], {
        cwd: repo,
        stdio: "pipe",
      });
      createCommit(repo, "config.txt", "value=2", "test commit");
      const originalSha = getSha(repo, "test/AAA-005");
      checkout(repo, "spec/AAA-005");
      createCommit(repo, "config.txt", "value=3", "amended spec commit");

      // When
      const { stdout, status } = runCli(
        repo,
        ["--dev-testing", "git", "rebase", "-i"],
        JSON.stringify({ branch: "test/AAA-005", ontoRef: "spec/AAA-005" }),
      );

      // Then — the conflict is reported as its own outcome with real
      // conflict information from git (the conflicted file's name).
      expect(status).toBe(0);
      const outcome = parseOutcome(stdout);
      expect(outcome.status).toBe("conflict");
      expect(String(outcome.details)).toContain("config.txt");

      // Then — no commit was force-pushed; the local repository is left
      // mid-rebase for a human/agent to resolve manually: the branch ref
      // has not moved and the worktree reports the unmerged path.
      expect(getSha(repo, "test/AAA-005")).toBe(originalSha);
      expect(porcelain(repo)).toContain("UU");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// §3.6 malformed JSON args is rejected before any rebase is attempted
// ---------------------------------------------------------------------------

describe("§3.6 malformed JSON args is rejected before any rebase is attempted", () => {
  it("exits 2 and touches no branch (§3.6)", () => {
    const dir = tempDir();
    try {
      const repo = initRepo(dir);
      createCommit(repo, "init.txt", "init", "init");
      execFileSync("git", ["checkout", "-b", "test/AAA-006"], {
        cwd: repo,
        stdio: "pipe",
      });
      const originalSha = getSha(repo, "test/AAA-006");

      // When — malformed JSON on stdin
      const { stdout, status } = runCli(
        repo,
        ["--dev-testing", "git", "rebase", "-i"],
        "{not valid json",
      );

      // Then — rejected before any rebase is attempted: exit code 2 and no
      // branch touched.
      expect(status).toBe(2);
      expect(stdout).toContain("Malformed JSON");
      expect(getSha(repo, "test/AAA-006")).toBe(originalSha);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
