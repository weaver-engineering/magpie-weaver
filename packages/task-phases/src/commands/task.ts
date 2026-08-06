import type { ExternalTools, RefCommandResult } from "../types.js";
import { deriveRepoState } from "../lib/repo-state.js";

/** The four phase-branch prefixes a ref can be checked out on — used only
 * to derive a ref from the current branch name below (the WIP commit title
 * is prefixed with the ref of the branch being LEFT, never the ref being
 * switched to); `lib/repo-state.ts` has its own copy for its own, distinct
 * purpose (existence checks). */
const PHASE_PREFIXES = ["spec", "test", "build", "task"] as const;

/** Derives a task ref from a checked-out branch name — `task/AAA-123` ->
 * `AAA-123`, or `null` when the branch is not a phase branch (e.g. `main`);
 * no attempt is made to derive a ref from `main` itself. */
function deriveRefFromBranch(branch: string): string | null {
  const prefix = PHASE_PREFIXES.find((p) => branch.startsWith(`${p}/`));
  return prefix === undefined ? null : branch.slice(prefix.length + 1);
}

/** Normalises the `--wip [title] [message]` flag value into its optional
 * title/message halves. `parseFlags` produces three shapes for the flag: a
 * bare `true` (no values given), a single string (one value — the title),
 * or a string array (two values — title, message). */
function parseWipArgs(
  wip: boolean | number | string | string[] | undefined,
): { title: string | undefined; message: string | undefined } {
  const values = typeof wip === "string" ? [wip] : Array.isArray(wip) ? wip : [];
  return { title: values[0], message: values[1] };
}

/** `pnpm task <ref> [--wip [title] [message]] [--json]` — the `ref` command,
 * see task-phasing-lld.md §3.13. `<ref>` derives its current canonical
 * branch via the shared `deriveRepoState()` pipeline (LLD §4.5 — the same
 * derivation `status`/`list`/`promote` all use, never a fresh lookup built
 * for this command) and checks it out. When `--wip` is given and the
 * worktree is dirty, commits the work in progress on the branch being LEFT
 * first — the `{ref}: {title} - WIP` convention `wip` (MAG-46-07) uses,
 * prefixed with the ref derived from the current branch — before switching.
 *
 * Without `--wip`, switching under uncommitted changes is allowed to proceed
 * and can fail on a real `git checkout` conflict — that failure is an
 * ordinary git error surfaced as-is (never swallowed or reworded into a
 * generic failure, and never pre-empted by a WIP commit that wasn't asked
 * for), per §2.1. A ref with no phase branch of any kind derives
 * `not-initialised` — there is no canonical branch to switch to, so the
 * switch fails cleanly rather than checking out nothing. */
export async function ref(
  tools: ExternalTools,
  args: Record<string, boolean | number | string | string[]>,
): Promise<RefCommandResult> {
  const refArg = typeof args.ref === "string" ? args.ref : "";

  // Fetch is called unconditionally before any derivation (§1.1/§2.1),
  // matching every other command that runs the shared pipeline.
  await tools.git.fetch();

  const currentBranch = await tools.git.currentBranch();
  const taskStatus = await deriveRepoState(tools, refArg, currentBranch);
  if (taskStatus.canonicalBranch === null) {
    throw new Error(`Cannot switch to \`${refArg}\`: no canonical branch (task not initialised)`);
  }

  // --wip commits work in progress on the branch being left before the
  // switch — but only when there is actually something to commit: a clean
  // worktree is never manufactured into an empty commit (same rule as
  // `wip`, MAG-46-07). Without `--wip`, nothing is ever committed.
  let wipCommitSha: string | undefined;
  if (args.wip !== undefined) {
    if (await tools.git.isDirty()) {
      const { title, message } = parseWipArgs(args.wip);
      const refOfBranchLeft = deriveRefFromBranch(currentBranch);
      // The literal `{ref}: {title} - WIP` format is exact (§2.1 of MAG-46-07);
      // with no title the title segment is omitted entirely.
      const titleSegment = title !== undefined ? `${title} ` : "";
      const commitTitle = `${refOfBranchLeft ?? ""}: ${titleSegment}- WIP`;
      wipCommitSha = await tools.git.commitAll(commitTitle, message ?? "work in progress");
    }
  }

  // The checkout happens only after any WIP commit. A real checkout conflict
  // propagates as git's own error — surfaced by the caller as-is.
  await tools.git.checkout(taskStatus.canonicalBranch);

  return {
    success: true,
    messages: [
      `Switched from \`${currentBranch}\` to \`${taskStatus.canonicalBranch}\``,
      ...(wipCommitSha !== undefined ? [`Committed work in progress as ${wipCommitSha}`] : []),
    ],
    switchedFrom: currentBranch,
    switchedTo: taskStatus.canonicalBranch,
    ...(wipCommitSha !== undefined && { wipCommitSha }),
  };
}
