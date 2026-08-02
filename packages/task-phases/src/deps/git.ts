/**
 * Concrete shape of `GitTool` (task-phasing-lld.md §2's `ExternalTools.git`,
 * detailed in §4.8). Branch create/checkout/push/rebase primitives — never
 * used to create ordinary work commits (§1.1).
 *
 * Spec 01 implements `fetch`, `currentBranch`, `branchExists`, `headSha`,
 * `createBranch`, `checkout`, `commitAll`, `push`. Spec 05.01 implements
 * `isDirty`, `hasCommitsBeyond`, `headCommitTitle`, `pullFastForward`,
 * `deleteBranch`. Spec 07 implements `changedFiles`. The remaining methods
 * (`mergeBase`, `isAncestor`, `rebase`) still throw — real implementations
 * land with the chunk that owns them (MAG-46-13).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { simpleGit } from "simple-git";

const execFileAsync = promisify(execFile);

/** `deps/git.ts`'s own type — `types.ts` imports it, not the reverse. */
export type RebaseOutcome =
  | { status: "ok" }
  | { status: "conflict"; details: string }
  | {
      status: "unexpected-commit-count";
      expected: 1;
      actual: number;
      details: string;
    };

export interface GitTool {
  fetch(): Promise<void>;

  currentBranch(): Promise<string>;

  branchExists(branch: string, opts?: { remote?: boolean }): Promise<boolean>;

  headSha(branch: string): Promise<string>;

  mergeBase(refA: string, refB: string): Promise<string>;

  hasCommitsBeyond(branch: string, parentBranch: string): Promise<boolean>;

  headCommitTitle(branch: string): Promise<string>;

  isDirty(): Promise<boolean>;

  /** `git status --porcelain` parsed into added/changed/deleted buckets —
   * untracked (`??`) and index-added (`A`) files count as added, deleted
   * (`D`) as deleted, and everything else (`M`, `R`, `C`, ...) as changed.
   * Local-checkout-only by nature, like `isDirty`. Callers must run this
   * *before* any `commitAll`, which stages and commits everything and
   * leaves the tree clean. */
  changedFiles(): Promise<{ added: string[]; changed: string[]; deleted: string[] }>;

  /** Exit code 1 from `merge-base --is-ancestor` is a legitimate `false`,
   * not an error. */
  isAncestor(ancestor: string, descendant: string): Promise<boolean>;

  /** Local only — does not push; callers must follow up with `push()`. */
  createBranch(newBranch: string, fromRef: string): Promise<void>;

  checkout(branch: string): Promise<void>;

  commitAll(title: string, message?: string): Promise<string>;

  push(branch: string, opts?: { force?: boolean }): Promise<void>;

  pullFastForward(branch: string): Promise<void>;

  /** Reports rather than resolves a conflict — newly-merged, human-reviewed
   * content always takes precedence over the branch being rebased. */
  rebase(branch: string, ontoRef: string): Promise<RebaseOutcome>;

  deleteBranch(branch: string): Promise<void>;
}

export class RealGitTool implements GitTool {
  private git: ReturnType<typeof simpleGit>;

  /**
   * @param cwd Working directory for running git commands. Defaults to
   * `process.cwd()` — the repository is resolved relative to the caller's
   * current working directory, never relative to wherever `task-phases`
   * itself is installed (spec 01 §3.2.5).
   */
  constructor(private readonly cwd: string = process.cwd()) {
    this.git = simpleGit({ baseDir: this.cwd });
  }

  /** `git fetch origin --prune` — keeps local remote-tracking refs fresh
   * (and prunes stale ones) before any phase/state derivation. */
  async fetch(): Promise<void> {
    await this.git.raw(["fetch", "origin", "--prune"]);
  }

  /** `git branch --show-current` — the branch actually checked out, or `""`
   * in detached HEAD. */
  async currentBranch(): Promise<string> {
    return (await this.git.raw(["branch", "--show-current"])).trim();
  }

  /** `git show-ref --verify` against the local branch ref, or the local
   * remote-tracking ref when `opts.remote` is set. A nonzero exit from
   * `show-ref` means the ref doesn't exist — `false`, not an error. (`--quiet`
   * is deliberately omitted: simple-git treats a task as failed only when a
   * nonzero exit is accompanied by stderr output, and `--quiet` suppresses
   * that output, so the "doesn't exist" case would otherwise resolve instead
   * of rejecting.) */
  async branchExists(branch: string, opts?: { remote?: boolean }): Promise<boolean> {
    const ref = opts?.remote ? `refs/remotes/origin/${branch}` : `refs/heads/${branch}`;
    try {
      await this.git.raw(["show-ref", "--verify", ref]);
      return true;
    } catch {
      return false;
    }
  }

  /** `git rev-parse <ref>` — the SHA at `ref`'s current HEAD. */
  async headSha(branch: string): Promise<string> {
    return (await this.git.raw(["rev-parse", branch])).trim();
  }

  mergeBase(_refA: string, _refB: string): Promise<string> {
    throw new Error("not implemented");
  }

  /** `git rev-list --count <parentBranch>..<branch>` — commits unique to
   * `branch` relative to `parentBranch`. Nonzero distinguishes
   * `not-started` from `work-in-progress`/`ready?` (§2, §4.5). */
  async hasCommitsBeyond(branch: string, parentBranch: string): Promise<boolean> {
    const count = (
      await this.git.raw(["rev-list", "--count", `${parentBranch}..${branch}`])
    ).trim();
    return Number(count) > 0;
  }

  /** `git log -1 --format=%s <branch>` — HEAD's commit title (subject line
   * only, no body), for the literal `WIP` substring check. */
  async headCommitTitle(branch: string): Promise<string> {
    return (await this.git.raw(["log", "-1", "--format=%s", branch])).trim();
  }

  /** `git status --porcelain` — nonempty output means dirty. Covers both
   * staged and unstaged changes, and untracked files. Local-checkout-only
   * by nature — only meaningful for whatever's currently checked out. */
  async isDirty(): Promise<boolean> {
    const status = await this.git.raw(["status", "--porcelain"]);
    return status.trim() !== "";
  }

  /** `git status --porcelain` parsed into added/changed/deleted buckets.
   * Each porcelain line is `<XY> <path>` — the two status chars are the
   * index (X) and worktree (Y) state, and the path starts at index 3.
   * Untracked files report as `??`; a `D` in either position means deleted;
   * an `A` in either position means added; everything else (`M`, `R`, `C`,
   * ...) is changed. Paths git quoted (spaces, quotes, non-ASCII) have
   * their surrounding quotes stripped. Must run before `commitAll`, which
   * leaves the tree clean. */
  async changedFiles(): Promise<{ added: string[]; changed: string[]; deleted: string[] }> {
    const status = await this.git.raw(["status", "--porcelain"]);
    const added: string[] = [];
    const changed: string[] = [];
    const deleted: string[] = [];
    for (const raw of status.split("\n")) {
      if (raw.length === 0) continue;
      const indexStatus = raw[0];
      const worktreeStatus = raw[1];
      const path = raw.slice(3).replace(/^"(.*)"$/, "$1");
      if (indexStatus === "?" && worktreeStatus === "?") {
        added.push(path);
      } else if (indexStatus === "D" || worktreeStatus === "D") {
        deleted.push(path);
      } else if (indexStatus === "A" || worktreeStatus === "A") {
        added.push(path);
      } else {
        changed.push(path);
      }
    }
    return { added, changed, deleted };
  }

  isAncestor(_ancestor: string, _descendant: string): Promise<boolean> {
    throw new Error("not implemented");
  }

  /** `git checkout -b <newBranch> <fromRef>` — creates `newBranch` off
   * `fromRef`'s current HEAD and checks it out. Local only — does not push;
   * callers must follow up with `push()`. */
  async createBranch(newBranch: string, fromRef: string): Promise<void> {
    await this.git.raw(["checkout", "-b", newBranch, fromRef]);
  }

  /** `git checkout <branch>` — switches to an already-existing branch. */
  async checkout(branch: string): Promise<void> {
    await this.git.raw(["checkout", branch]);
  }

  /** `git add -A && git commit -m "<title>" [-m "<message>"]`, then
   * `git rev-parse HEAD` for the returned SHA. Generic — has no
   * WIP-specific knowledge itself; callers build the full
   * `{ref}: {title} - WIP` formatted title/message first. */
  async commitAll(title: string, message?: string): Promise<string> {
    await this.git.raw(["add", "-A"]);
    const commitArgs = ["commit", "-m", title];
    if (message !== undefined) {
      commitArgs.push("-m", message);
    }
    await this.git.raw(commitArgs);
    return (await this.git.raw(["rev-parse", "HEAD"])).trim();
  }

  /** `git push origin <branch>`, or `git push origin <branch>
   * --force-with-lease` when `opts.force` is set. */
  async push(branch: string, opts?: { force?: boolean }): Promise<void> {
    const args = ["push", "origin", branch];
    if (opts?.force) {
      args.push("--force-with-lease");
    }
    await this.git.raw(args);
  }

  /** The non-destructive half of `merged-pending-pull` (§3.3).
   * If `branch` doesn't exist locally: `git branch <branch>
   * origin/<branch>` (create only, no checkout — callers use `checkout()`
   * separately if they want to switch to it).
   * If it does exist: first verify `git merge-base --is-ancestor
   * <branch> origin/<branch>` — a genuine fast-forward must actually be
   * possible — then `git branch -f <branch> origin/<branch>`. The
   * verification matters: blindly forcing the ref without checking
   * direction would silently discard a local-only commit if this were
   * ever called on a branch that had diverged. */
  async pullFastForward(branch: string): Promise<void> {
    const originRef = `origin/${branch}`;
    if (!(await this.branchExists(branch))) {
      // Create-only, no checkout.
      await this.git.raw(["branch", branch, originRef]);
      return;
    }
    // Verify a genuine fast-forward is possible before forcing the ref.
    // `git merge-base --is-ancestor` exits 1 with *no* stderr output when
    // `branch` is not an ancestor of `origin/<branch>`, and simple-git
    // only treats a nonzero exit as a failure when it is accompanied by
    // stderr — so the divergence case would silently resolve. Read the
    // exit code via execFile directly (gh.ts's pattern) instead.
    try {
      await execFileAsync("git", ["merge-base", "--is-ancestor", branch, originRef], {
        cwd: this.cwd,
        encoding: "utf-8",
      });
    } catch (error) {
      const err = error as { code?: number; stderr?: string | Buffer };
      if (err.code === 1) {
        throw new Error(
          `Cannot fast-forward ${branch}: local branch has diverged from ${originRef}`,
          { cause: error },
        );
      }
      // Any other failure (e.g. unknown ref, exit 128) surfaces git's own
      // stderr, or a generic message when git produced none.
      const stderrText = (err.stderr ?? "").toString().trim();
      throw new Error(
        stderrText.length > 0
          ? stderrText
          : `git merge-base --is-ancestor ${branch} ${originRef} failed (exit code ${err.code ?? "unknown"})`,
        { cause: error },
      );
    }
    await this.git.raw(["branch", "-f", branch, originRef]);
  }

  rebase(_branch: string, _ontoRef: string): Promise<RebaseOutcome> {
    throw new Error("not implemented");
  }

  /** `git branch -D <branch>` + `git push origin --delete <branch>` —
   * used only by final cleanup once the Main Gate PR merges (§3.6); never
   * for any earlier transition. Either half already being absent is a
   * no-op, not an error: the local half in particular is exactly the state
   * a previously-interrupted cleanup leaves behind, so re-running must
   * succeed. (Remote half existence is checked against the local
   * remote-tracking ref, which `fetch()` keeps fresh per §1.1.) */
  async deleteBranch(branch: string): Promise<void> {
    if (await this.branchExists(branch)) {
      await this.git.raw(["branch", "-D", branch]);
    }
    if (await this.branchExists(branch, { remote: true })) {
      await this.git.raw(["push", "origin", "--delete", branch]);
    }
  }
}
