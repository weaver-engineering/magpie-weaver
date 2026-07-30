/**
 * Concrete shape of `GitHubTool` (task-phasing-lld.md §2's
 * `ExternalTools.github`, detailed in §4.9). The sole merge/PR-status
 * detection mechanism in the tool (§3.3) — deliberately never via
 * SHA/ancestry comparison. Never performs a merge itself.
 *
 * `RealGitHubTool` below is a placeholder only: every method throws. Real
 * implementations land with the chunk that owns them (MAG-46-03).
 */

export interface PullRequestSummary {
  number: number;
  url: string;
}

export interface MergedPullRequestSummary extends PullRequestSummary {
  /** ISO-8601. */
  mergedAt: string;

  /** The head branch's SHA at the moment it was merged. */
  headRefOid: string;

  /** The SHA of the commit actually created on the base branch by the
   * merge — the old-boundary reference `GitTool.rebase` needs for the
   * build-reorder case (§4.8). */
  mergeCommitOid: string;
}

export interface GitHubTool {
  createPR(
    base: string,
    head: string,
    opts: { title: string; body?: string },
  ): Promise<PullRequestSummary>;

  /** Full merge history for this base/head pair, oldest-first — a base/head
   * pair can legitimately have more than one merged PR over a ref's
   * lifetime (§4.9). */
  findMergedPRs(base: string, head: string): Promise<MergedPullRequestSummary[]>;

  /** Convenience over `findMergedPRs` — the most recent entry, or `null`. */
  findMergedPR(base: string, head: string): Promise<MergedPullRequestSummary | null>;

  findOpenPR(base: string, head: string): Promise<PullRequestSummary | null>;
}

export class RealGitHubTool implements GitHubTool {
  createPR(
    _base: string,
    _head: string,
    _opts: { title: string; body?: string },
  ): Promise<PullRequestSummary> {
    throw new Error("not implemented");
  }

  findMergedPRs(_base: string, _head: string): Promise<MergedPullRequestSummary[]> {
    throw new Error("not implemented");
  }

  findMergedPR(_base: string, _head: string): Promise<MergedPullRequestSummary | null> {
    throw new Error("not implemented");
  }

  findOpenPR(_base: string, _head: string): Promise<PullRequestSummary | null> {
    throw new Error("not implemented");
  }
}
