/**
 * Fixture-level regression test for MAG-46 spec 16 §2.1's remote-only-ref
 * handling, driven against REAL git (a local bare `origin` + clone, never
 * mocked `hasCommitsBeyond`).
 *
 * The mocked suite cannot catch this class of bug: `RealGitTool.hasCommitsBeyond`
 * does `rev-parse --verify <parent>^{commit}` first and returns `false` on a
 * failed parent rather than throwing (deps/git.ts). With a genuinely remote-only
 * ref — `spec/{ref}` and `test/{ref}` pushed then deleted locally, leaving only
 * the `origin/` forms — `deriveParentBranch` used to hand a bare, unresolved
 * `spec/{ref}` to `deriveState`, which `hasCommitsBeyond` would silently swallow
 * into `not-started` even though `test/{ref}` really has commits of its own.
 * The correct state is `ready?`. A mocked double just returns whatever is wired
 * in, so it can't reproduce git's swallow-on-failure; only real git can.
 *
 * Regression: guards the `resolveParentBranch` helper in lib/repo-state.ts —
 * asserting a remote-only test ref whose spec/{ref} parent is also remote-only
 * derives `ready?`, not the silent wrong answer `not-started`.
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RealGitTool } from "../../../../packages/task-phases/src/deps/git.js";
import { deriveRepoState } from "../../../../packages/task-phases/src/lib/repo-state.js";
import type { ExternalTools } from "../../../../packages/task-phases/src/types.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "mag-remoteonly-"));
}

function initRepo(dir: string): string {
  mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "test@test"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir, stdio: "pipe" });
  // rename default branch to main
  execFileSync("git", ["commit", "--allow-empty", "-m", "init"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["branch", "-m", "main"], { cwd: dir, stdio: "pipe" });
  return dir;
}

function initBareRepo(dir: string): string {
  mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "--bare"], { cwd: dir, stdio: "pipe" });
  return dir;
}

function commit(repo: string, file: string, content: string, msg: string): string {
  writeFileSync(join(repo, file), content, "utf-8");
  execFileSync("git", ["add", file], { cwd: repo, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", msg], { cwd: repo, stdio: "pipe" });
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf-8" }).trim();
}

function getSha(repo: string, ref: string): string {
  return execFileSync("git", ["rev-parse", ref], { cwd: repo, encoding: "utf-8" }).trim();
}

function addOrigin(repo: string, bareUrl: string): void {
  execFileSync("git", ["remote", "add", "origin", bareUrl], { cwd: repo, stdio: "pipe" });
}

/** Push a branch to origin (with upstream). */
function pushBranch(repo: string, branch: string): void {
  execFileSync("git", ["push", "-u", "origin", branch], { cwd: repo, stdio: "pipe" });
}

function localBranches(repo: string, pattern: string): string[] {
  const out = execFileSync("git", ["branch", "--list", pattern], {
    cwd: repo,
    encoding: "utf-8",
    stdio: "pipe",
  });
  return out
    .split("\n")
    .map((l) => l.trim().replace(/^\* /, ""))
    .filter(Boolean);
}

/** Delete a local branch. */
function deleteLocalBranch(repo: string, branch: string): void {
  execFileSync("git", ["branch", "-D", branch], { cwd: repo, stdio: "pipe" });
}

function checkout(repo: string, branch: string): void {
  execFileSync("git", ["checkout", branch], { cwd: repo, stdio: "pipe" });
}

function createBranch(repo: string, branch: string, fromRef = "HEAD"): void {
  execFileSync("git", ["branch", branch, fromRef], { cwd: repo, stdio: "pipe" });
}

/**
 * Build a real `ExternalTools` double whose GIT layer is the genuine
 * `RealGitTool` pointed at a real repo (so `hasCommitsBeyond`'s real git
 * `rev-parse`/`rev-list` run), with github stubbed to report "no PR" for
 * every pair (the true situation for a bare remote-only ref — nothing is
 * ever merged), and gateChecks/fileSystem as throw-mocks (they must never be
 * touched on the branch-exists derivation path).
 */
function realGitTools(cwd: string): ExternalTools {
  const git = new RealGitTool(cwd);
  const github = {
    createPR: viThrow("github.createPR"),
    findMergedPRs: async () => [],
    findMergedPR: async () => null,
    findOpenPR: async () => null,
  };
  const gateChecks = {
    run: viThrow("gateChecks.run"),
    gateFor: viThrow("gateChecks.gateFor"),
  };
  const fileSystem = {
    loadConfig: viThrow("fs.loadConfig"),
    exists: viThrow("fs.exists"),
    readFile: viThrow("fs.readFile"),
    writeFile: viThrow("fs.writeFile"),
    copyFile: viThrow("fs.copyFile"),
    mkdir: viThrow("fs.mkdir"),
    readDir: viThrow("fs.readDir"),
  };
  return { git, github, gateChecks, fileSystem };
}

function viThrow(name: string): () => never {
  return () => {
    throw new Error(`unexpected call: ${name}`);
  };
}

describe("MAG-46 spec 16 §2.1 — remote-only ref derives state with real git", () => {
  it("derives ready? (not not-started) for a remote-only test/{ref} whose spec/{ref} parent is also remote-only", async () => {
    const dirs: string[] = [];
    const track = (d: string): string => {
      dirs.push(d);
      return d;
    };
    // Given: a bare origin + fresh clone (only main checked out locally).
    const bareDir = track(tempDir());
    const cloneDir = track(tempDir());
    const seedDir = track(tempDir());
    try {
      const upstream = initBareRepo(bareDir);
      const seed = initRepo(seedDir);
      addOrigin(seed, upstream);
      pushBranch(seed, "main");

      // The clone we'll drive derivation against — starts with only main and
      // a fetch that populates origin/* remote-tracking refs.
      const repo = initRepo(cloneDir);
      addOrigin(repo, upstream);
      execFileSync("git", ["fetch", "origin"], { cwd: repo, stdio: "pipe" });

      // Build spec/XYZ-456 then test/XYZ-456 (silently forking spec) with
      // one test commit of its own, push both, then DELETE both locally so
      // ONLY origin/spec/XYZ-456 and origin/test/XYZ-456 exist.
      checkout(repo, "main");
      createBranch(repo, "spec/XYZ-456");
      checkout(repo, "spec/XYZ-456");
      const specSha = commit(repo, "spec.txt", "spec work", "XYZ-456: spec work");

      createBranch(repo, "test/XYZ-456", "spec/XYZ-456");
      checkout(repo, "test/XYZ-456");
      const testSha = commit(repo, "test.txt", "test work", "XYZ-456: test work");

      // Sanity: test/XYZ-456 genuinely has 1 commit beyond spec/XYZ-456.
      checkout(repo, "main");
      pushBranch(repo, "spec/XYZ-456");
      pushBranch(repo, "test/XYZ-456");

      // Delete both local branches — now genuinely remote-only.
      deleteLocalBranch(repo, "spec/XYZ-456");
      deleteLocalBranch(repo, "test/XYZ-456");
      expect(localBranches(repo, "spec/XYZ-456")).toEqual([]);
      expect(localBranches(repo, "test/XYZ-456")).toEqual([]);

      // The remote-tracking refs must be present (fetch() keeps `origin/*`
      // fresh — this is what makes the ref genuinely remote-only).
      expect(getSha(repo, "origin/spec/XYZ-456")).toBe(specSha);
      expect(getSha(repo, "origin/test/XYZ-456")).toBe(testSha);

      // When: derive the repo state with REAL git (cwd = the clone).
      const status = await deriveRepoState(realGitTools(repo), "XYZ-456", "main");

      // Then: phase test, canonical branch resolved to the origin/ form, and
      // — the regression — state ready?, NOT not-started.
      expect(status.phase).toBe("test");
      expect(status.canonicalBranch).toBe("origin/test/XYZ-456");
      expect(status.state).toBe("ready?");
    } finally {
      for (const d of dirs) {
        rmSync(d, { recursive: true, force: true });
      }
    }
  });
});
