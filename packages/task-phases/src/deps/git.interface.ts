/**
 * Spec-11 (MAG-46-11) addition to the system-facing `GitTool` contract
 * (task-phasing-lld.md §4.8, implemented in `deps/git.ts`).
 *
 * Pinned here, immutable once committed: the build-implementer must add
 * `createRemoteBranch` to `GitTool` in `deps/git.ts` (and implement it on
 * `RealGitTool`) to exactly this signature and these git semantics. It is
 * the one git primitive `promote`'s `test::ready -> pr-raised` action
 * needs (spec 11 §3.1.1) — nothing in the LLD §4.8 interface (or in any
 * earlier chunk) can publish `build/{ref}` on `origin` from `origin/main`
 * without a local checkout of `build/{ref}`.
 *
 * `promote`'s tests (test/packages/task-phases/promote/pr-raised.test.ts)
 * mock and assert this method; the implementation must call it with
 * `newBranch = "build/{ref}"/"build/AAA-123"` and `fromRef = "origin/main"`,
 * and only when `git.branchExists("build/{ref}", { remote: true })` is
 * false (§3.1.1). `promote` must not create `build/{ref}` locally — an
 * unrestored local creation would take a worktree checkout slot for a
 * branch the test/build phases never work on (§2.1's worktree-safety
 * reasoning, MAG-46-10 §2.1).
 */

export interface GitToolBranchCreation {
  /**
   * `git push origin <fromRef>:refs/heads/<newBranch>` — publishes the
   * already-existing ref `fromRef` (e.g. `origin/main`) to a newly-named
   * branch `newBranch` (e.g. `build/{ref}`) on `origin`, without creating
   * or checking `newBranch` out locally.
   *
   * Used by `promote`'s `test::ready -> pr-raised` action to create
   * `build/{ref}` on origin from `origin/main` before opening the Build
   * Gate PR (spec 11 §2.1/§3.1.1) — the base branch a `gh pr create
   * --base build/{ref}` would 422 against if it didn't exist. Throws if
   * `newBranch` already exists on origin (the caller checks
   * `branchExists` first).
   */
  createRemoteBranch(newBranch: string, fromRef: string): Promise<void>;
}
