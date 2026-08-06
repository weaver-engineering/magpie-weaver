/**
 * Spec-16 (MAG-46-16) addition to the system-facing `GitTool` contract
 * (task-phasing-lld.md §4.8, implemented in `deps/git.ts`).
 *
 * Pinned here, immutable once committed: the build-implementer must add
 * `listBranches` to `GitTool` in `deps/git.ts` (and implement it on
 * `RealGitTool`) to exactly this signature and these git semantics. It is
 * the one git primitive `list`'s enumeration step needs (spec 16 §2.1) —
 * nothing in the LLD §4.8 interface (or in any earlier chunk) can *enumerate*
 * the repo's branches: every prior `GitTool` method takes a specific
 * branch/ref name, and `list` (LLD §3.10) is the first command that needs
 * to know *which* `{ref}`s have an active branch at all.
 *
 * `list`'s tests (test/packages/task-phases/list/active-tasks.test.ts) mock
 * this method directly and assert it is called exactly once. The
 * implementation must return, in one call, every local branch name
 * (`test/{ref}`) plus every remote-tracking branch name in its short form
 * (`origin/test/{ref}`) — `git for-each-ref --format='%(refname:short)'
 * refs/heads refs/remotes/origin`. The caller (list) strips any `origin/`
 * prefix and any `spec/`/`test`/`build`/`task` phase prefix, matches what
 * remains against `/^[A-Z]+-[0-9]+$/`, and groups both forms of the same
 * branch under one `{ref}` entry — so a ref reachable only via
 * `origin/test/{ref}` (never checked out locally) is exactly as active as
 * one with a local branch.
 */
export interface GitToolListBranches {
  /**
   * `git for-each-ref --format='%(refname:short)' refs/heads
   * refs/remotes/origin` — every local branch name (`test/{ref}`) and every
   * remote-tracking branch name in its short form (`origin/test/{ref}`), in
   * one call.
   *
   * Sole caller is `list` (§3.10) — the first command to need branch
   * enumeration, which no earlier chunk's `GitTool` surface supported. The
   * caller strips the `origin/` prefix (when present) and the
   * `spec/`/`test`/`build`/`task` phase prefix, matches the remainder
   * against `/^[A-Z]+-[0-9]+$/`, and groups the local and remote-tracking
   * forms of the same branch under one `{ref}` entry.
   */
  listBranches(): Promise<string[]>;
}
