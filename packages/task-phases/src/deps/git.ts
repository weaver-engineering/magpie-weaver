/**
 * Concrete shape of `GitTool` (task-phasing-lld.md §2's `ExternalTools.git`,
 * detailed in §4.8). Branch create/checkout/push/rebase primitives — never
 * used to create ordinary work commits (§1.1).
 *
 * The read-only primitives (`fetch`, `currentBranch`, `branchExists`,
 * `headSha`) and the mutating primitives (`createBranch`, `checkout`,
 * `commitAll`, `push`) named by spec 01 are implemented here. Every other
 * method still throws — real implementations land with the chunk that owns
 * them (MAG-46-13).
 */

import { simpleGit } from "simple-git";

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
  constructor(cwd?: string) {
    this.git = simpleGit({ baseDir: cwd ?? process.cwd() });
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

  hasCommitsBeyond(_branch: string, _parentBranch: string): Promise<boolean> {
    throw new Error("not implemented");
  }

  headCommitTitle(_branch: string): Promise<string> {
    throw new Error("not implemented");
  }

  isDirty(): Promise<boolean> {
    throw new Error("not implemented");
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

  pullFastForward(_branch: string): Promise<void> {
    throw new Error("not implemented");
  }

  rebase(_branch: string, _ontoRef: string): Promise<RebaseOutcome> {
    throw new Error("not implemented");
  }

  deleteBranch(_branch: string): Promise<void> {
    throw new Error("not implemented");
  }
}
