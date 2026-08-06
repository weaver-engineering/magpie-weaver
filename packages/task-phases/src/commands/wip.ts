import type { ExternalTools, WipCommandResult } from "../types.js";
import {
  WIP_DEFAULT_MESSAGE,
  deriveRefFromBranch,
  wipCommitTitle,
} from "../lib/wip-commit.js";

/** `pnpm task wip [title] [message]` — see task-phasing-lld.md §3.12.
 * Commits everything on the current branch with the `{ref}: {title} - WIP`
 * title convention (message defaulting to `"work in progress"`), pushes it,
 * and fails cleanly when the worktree is already clean rather than
 * manufacturing an empty commit. A pure git write — never switches
 * branches (§2.1), so `git.checkout` is never touched. */
export async function wip(
  tools: ExternalTools,
  args: Record<string, boolean | number | string | string[]>,
): Promise<WipCommandResult> {
  const branch = await tools.git.currentBranch();
  const ref = deriveRefFromBranch(branch);

  // Fail cleanly before any write when there is nothing to commit: either
  // no task ref is derivable from the checked-out branch (e.g. on `main`,
  // so there is nothing to prefix the WIP title with) or the worktree is
  // already clean. No empty commit is ever manufactured, and the result
  // carries no SHA/file breakdown because nothing was committed.
  if (ref === null || !(await tools.git.isDirty())) {
    const message =
      ref === null
        ? `Cannot wip on branch \`${branch}\`: no task ref derivable from it`
        : "Working tree is clean — nothing to pack away";
    return {
      success: false,
      messages: [message],
      commitSha: "",
      filesAdded: [],
      filesChanged: [],
      filesDeleted: [],
    };
  }

  const positionals =
    args.positionals === undefined
      ? []
      : Array.isArray(args.positionals)
        ? args.positionals
        : [args.positionals];
  const title = typeof positionals[0] === "string" ? positionals[0] : undefined;
  const message = typeof positionals[1] === "string" ? positionals[1] : undefined;

  // The literal `{ref}: {title} - WIP` format is exact (§2.1); with no
  // title the title segment is omitted entirely (`{ref}: - WIP`), and the
  // message falls back to the documented "work in progress" — shared with
  // `init --wip`/`status --fix --wip` via `lib/wip-commit.ts`.
  const commitTitle = wipCommitTitle(ref, title);
  const commitMessage = message ?? WIP_DEFAULT_MESSAGE;

  // changedFiles must be captured before commitAll: commitAll stages and
  // commits everything, after which the working tree is clean.
  const files = await tools.git.changedFiles();
  const commitSha = await tools.git.commitAll(commitTitle, commitMessage);
  await tools.git.push(branch);

  return {
    success: true,
    messages: [`Committed \`${commitTitle}\` as ${commitSha}`, `Pushed ${branch}`],
    commitSha,
    filesAdded: files.added,
    filesChanged: files.changed,
    filesDeleted: files.deleted,
  };
}
