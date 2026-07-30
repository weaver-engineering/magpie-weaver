/**
 * Concrete shape of `GitTool` (task-phasing-lld.md §2's `ExternalTools.git`,
 * detailed in §4.8). Branch create/checkout/push/rebase primitives — never
 * used to create ordinary work commits (§1.1).
 *
 * `RealGitTool` below is a placeholder only: every method throws. Real
 * implementations land with the chunk that owns them (MAG-46-01/13).
 */

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
  fetch(): Promise<void> {
    throw new Error("not implemented");
  }

  currentBranch(): Promise<string> {
    throw new Error("not implemented");
  }

  branchExists(_branch: string, _opts?: { remote?: boolean }): Promise<boolean> {
    throw new Error("not implemented");
  }

  headSha(_branch: string): Promise<string> {
    throw new Error("not implemented");
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

  createBranch(_newBranch: string, _fromRef: string): Promise<void> {
    throw new Error("not implemented");
  }

  checkout(_branch: string): Promise<void> {
    throw new Error("not implemented");
  }

  commitAll(_title: string, _message?: string): Promise<string> {
    throw new Error("not implemented");
  }

  push(_branch: string, _opts?: { force?: boolean }): Promise<void> {
    throw new Error("not implemented");
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
