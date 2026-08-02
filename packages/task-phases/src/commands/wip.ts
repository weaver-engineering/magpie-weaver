import type { ExternalTools, WipCommandResult } from "../types.js";

/** The four phase-branch prefixes a ref can be checked out on — used to
 * derive the ref that prefixes the WIP title below. Same derivation as
 * `status.ts`'s own copy; kept local to this command. */
const PHASE_PREFIXES = ["spec", "test", "build", "task"] as const;

/** Derives a task ref from the checked-out branch name — `task/AAA-123` ->
 * `AAA-123`. Returns `null` when the branch is not a phase branch (e.g.
 * `main`); no attempt is made to derive a ref from `main` itself. */
function deriveRefFromBranch(branch: string): string | null {
  for (const prefix of PHASE_PREFIXES) {
    if (branch.startsWith(`${prefix}/`)) {
      return branch.slice(prefix.length + 1);
    }
  }
  return null;
}

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
  // message falls back to the documented "work in progress".
  const titleSegment = title !== undefined ? `${title} ` : "";
  const commitTitle = `${ref}: ${titleSegment}- WIP`;
  const commitMessage = message ?? "work in progress";

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
