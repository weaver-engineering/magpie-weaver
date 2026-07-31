/**
 * Concrete shape of `GitHubTool` (task-phasing-lld.md §2's
 * `ExternalTools.github`, detailed in §4.9). The sole merge/PR-status
 * detection mechanism in the tool (§3.3) — deliberately never via
 * SHA/ancestry comparison. Never performs a merge itself.
 *
 * `RealGitHubTool` is a thin wrapper over the `gh` CLI: `gh pr create`
 * (opening destination-gate PRs) and `gh pr list --state merged` /
 * `--state open` (PR-status detection). It relies on `gh`'s own
 * cwd-relative repo detection, so all commands run with this tool's `cwd`
 * (defaulting to `process.cwd()`), never relative to wherever
 * `task-phases` itself is installed (task-MAG-46-dev-testing-cli-design.md
 * §6).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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
  /**
   * @param cwd Working directory for running `gh` commands. Defaults to
   * `process.cwd()` — `gh` resolves the target repository from the caller's
   * current working directory (design doc §6), never from wherever
   * `task-phases` itself is installed.
   */
  constructor(private cwd: string = process.cwd()) {}

  /** `gh pr create --base <base> --head <head> --title "<title>"
   * [--body "<body>"]`. `gh pr create` does not support `--json`; it prints
   * the PR URL to stdout on success, so the number is parsed out of that
   * URL. Never merges. */
  async createPR(
    base: string,
    head: string,
    opts: { title: string; body?: string },
  ): Promise<PullRequestSummary> {
    const args = [
      "pr",
      "create",
      "--base",
      base,
      "--head",
      head,
      "--title",
      opts.title,
      // `gh pr create` requires both `--title` and `--body` when running
      // non-interactively — pass an explicit (possibly empty) body so the
      // command never falls into the interactive prompt path.
      "--body",
      opts.body ?? "",
    ];

    const { stdout } = await this.runGh(args);

    const url = stdout.trim();
    const match = url.match(/\/pull\/(\d+)\s*$/);
    if (match === null) {
      throw new Error(
        `gh pr create succeeded but its output was not a PR URL: "${url}"`,
      );
    }
    return { number: Number(match[1]), url };
  }

  /** `gh pr list --base <base> --head <head> --state merged --json
   * number,url,mergedAt,headRefOid,mergeCommit --limit 50`, sorted
   * oldest-first by `mergedAt` (`mergeCommit.oid` mapped to
   * `mergeCommitOid` above). Full merge history for this base/head pair —
   * more than one entry is an expected, designed-for case (§4.9). */
  async findMergedPRs(base: string, head: string): Promise<MergedPullRequestSummary[]> {
    const { stdout } = await this.runGh([
      "pr",
      "list",
      "--base",
      base,
      "--head",
      head,
      "--state",
      "merged",
      "--json",
      "number,url,mergedAt,headRefOid,mergeCommit",
      "--limit",
      "50",
    ]);

    const results = JSON.parse(stdout) as Array<{
      number: number;
      url: string;
      mergedAt: string | null;
      headRefOid: string | null;
      mergeCommit: { oid: string } | null;
    }>;

    return results
      .map((pr) => ({
        number: pr.number,
        url: pr.url,
        mergedAt: pr.mergedAt ?? "",
        headRefOid: pr.headRefOid ?? "",
        mergeCommitOid: pr.mergeCommit?.oid ?? "",
      }))
      .sort(
        (a, b) => Date.parse(a.mergedAt) - Date.parse(b.mergedAt),
      );
  }

  /** Convenience over `findMergedPRs` — the most recent entry, or `null`
   * if none. Used wherever only "has this merged (yet)" matters (§3.2/§3.3's
   * ordinary merge-status derivation). */
  async findMergedPR(base: string, head: string): Promise<MergedPullRequestSummary | null> {
    const merged = await this.findMergedPRs(base, head);
    return merged.length === 0 ? null : merged[merged.length - 1];
  }

  /** `gh pr list --base <base> --head <head> --state open --json
   * number,url` — the currently open PR for this base/head pair, if any
   * (§3.2, `awaiting-pr`); `null` if none. */
  async findOpenPR(base: string, head: string): Promise<PullRequestSummary | null> {
    const { stdout } = await this.runGh([
      "pr",
      "list",
      "--base",
      base,
      "--head",
      head,
      "--state",
      "open",
      "--json",
      "number,url",
      "--limit",
      "50",
    ]);

    const results = JSON.parse(stdout) as PullRequestSummary[];
    return results.length === 0 ? null : results[0];
  }

  /** Runs `gh <args>` from this tool's `cwd`. On a nonzero exit the real
   * `gh` stderr is surfaced as the error message (spec 03 §3.4.1) — the
   * CLI's `--dev-testing` error path reports it as a FAILED line, not an
   * uncaught exception. */
  private async runGh(args: string[]): Promise<{ stdout: string }> {
    try {
      return await execFileAsync("gh", args, {
        cwd: this.cwd,
        encoding: "utf-8",
        maxBuffer: 1024 * 1024,
      });
    } catch (error) {
      const err = error as { stderr?: string | Buffer; code?: number };
      const stderrText = (err.stderr ?? "").toString().trim();
      if (stderrText.length > 0) {
        throw new Error(stderrText);
      }
      throw new Error(
        `gh ${args[0]} failed${err.code !== undefined ? ` (exit code ${err.code})` : ""}`,
      );
    }
  }
}
