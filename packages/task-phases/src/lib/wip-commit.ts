import type { ExternalTools } from "../types.js";

/** The four phase-branch prefixes a ref can be checked out on — used to
 * derive the ref that prefixes a carried-forward WIP commit title. Shared
 * by `wip`, `init --wip` and `status --fix --wip` (LLD §3.12);
 * `lib/repo-state.ts` has its own copy for its own, distinct purpose
 * (existence checks). */
const PHASE_PREFIXES = ["spec", "test", "build", "task"] as const;

/** Derives a task ref from a checked-out branch name — `task/AAA-123` ->
 * `AAA-123`, or `null` when the branch is not a phase branch (e.g. `main`). */
export function deriveRefFromBranch(branch: string): string | null {
  const prefix = PHASE_PREFIXES.find((p) => branch.startsWith(`${p}/`));
  return prefix === undefined ? null : branch.slice(prefix.length + 1);
}

/** Normalises the `--wip [title] [message]` flag value into its optional
 * title/message halves — the same three `parseFlags` shapes every command
 * produces for the flag: bare `true`, a single string (title), or a string
 * array (title, message). */
export function parseWipArgs(
  wip: boolean | number | string | string[] | undefined,
): { title: string | undefined; message: string | undefined } {
  const values = typeof wip === "string" ? [wip] : Array.isArray(wip) ? wip : [];
  return { title: values[0], message: values[1] };
}

/** The documented default commit message (LLD §3.12). */
export const WIP_DEFAULT_MESSAGE = "work in progress";

/** The literal `{ref}: {title} - WIP` commit title (LLD §3.12) — with no
 * title the title segment is omitted entirely, and the message falls back
 * to `WIP_DEFAULT_MESSAGE`. A `null` ref (branch not a phase branch, e.g.
 * `main`) leaves the ref prefix empty. */
export function wipCommitTitle(
  ref: string | null,
  title: string | undefined,
): string {
  const titleSegment = title !== undefined ? `${title} ` : "";
  return `${ref ?? ""}: ${titleSegment}- WIP`;
}

/** Commits the current worktree's WIP on the branch it is on, using the
 * shared `{ref}: {title} - WIP` convention — used by `init --wip`'s
 * carry-forward (LLD §3.8) and `status --fix --wip` (LLD §3.9) before the
 * branch switch. The caller has already established the worktree is dirty
 * and that a WIP commit is wanted; the commit title is returned so callers
 * can report it. */
export async function commitWipOnCurrentBranch(
  tools: ExternalTools,
  wip: boolean | number | string | string[] | undefined,
  currentBranch: string,
): Promise<string> {
  const { title, message } = parseWipArgs(wip);
  const refOfBranchLeft = deriveRefFromBranch(currentBranch);
  const commitTitle = wipCommitTitle(refOfBranchLeft, title);
  await tools.git.commitAll(commitTitle, message ?? WIP_DEFAULT_MESSAGE);
  return commitTitle;
}
