import type { ExternalTools, ListCommandResult, TaskStatus } from "../types.js";
import { deriveRepoState } from "../lib/repo-state.js";

/** The four phase-branch prefixes a ref can be checked out on — used only
 * to derive a ref from a branch name below; `lib/repo-state.ts` has its own
 * copy for its own, distinct purpose (existence checks). Same derivation as
 * `status.ts`/`wip.ts`'s own copies, kept local to this command per that
 * precedent. */
const PHASE_PREFIXES = ["spec", "test", "build", "task"] as const;

/** The phase-branch `{ref}` pattern `list` filters the enumerated branches
 * on (LLD §3.10), matching `cli.ts`'s own `TASK_REF_PATTERN`. */
const TASK_REF_PATTERN = /^[A-Z]+-[0-9]+$/;

/** Derives a task ref from a checked-out branch name — `spec/AAA-001` ->
 * `AAA-001`. Returns `null` when the branch is not a phase branch (e.g.
 * `main`); no attempt is made to derive a ref from `main` itself. */
function deriveRefFromBranch(branch: string): string | null {
  for (const prefix of PHASE_PREFIXES) {
    if (branch.startsWith(`${prefix}/`)) {
      return branch.slice(prefix.length + 1);
    }
  }
  return null;
}

/** Renders one ` - task: ...` list line (LLD §3.10.1). The `<== Current
 * Task` marker only ever nests the `MISSMATCH` marker on the current task's
 * own line — the same nesting the spec's `branchMismatch`-per-entry rule
 * mirrors. */
function listLine(task: TaskStatus, isCurrent: boolean): string {
  const marker = isCurrent
    ? ` <== Current Task${task.branchMismatch ? " MISSMATCH" : ""}`
    : "";
  return ` - task: \`${task.ref}\` phase: \`${task.phase ?? "-"}\` state: \`${task.state}\`${marker}`;
}

/** `pnpm task list [--json]` — see task-phasing-lld.md §3.10. Enumerates
 * every ref with an active branch via `git.listBranches` (MAG-46-16 §2.1's
 * pinned primitive), groups both the local and remote-tracking forms of the
 * same branch under one `{ref}` entry, and derives each ref's `TaskStatus`
 * through `lib/repo-state.ts`'s `deriveRepoState()` — the same shared
 * pipeline `status` uses, never a `list`-specific derivation path.
 *
 * Never resolves `ready?` and never calls `gateChecks.run` (no `--check`
 * equivalent, per §2.1/§3.14's open question) — its cost must not scale with
 * the number of active refs, and the tests enforce it structurally via a
 * throw-mock. Marks the currently checked-out task's entry via `currentRef`,
 * and surfaces `branchMismatch` only on that entry (LLD §3.10's nested
 * markers): a non-current task's entry reports `false` even when the
 * checked-out branch differs from it. */
export async function list(
  tools: ExternalTools,
  _args: Record<string, boolean | number | string | string[]>,
): Promise<ListCommandResult> {
  // Fetch is called unconditionally before any derivation (§1.1/§2.1), then
  // the branch enumeration happens exactly once.
  await tools.git.fetch();
  const currentBranch = await tools.git.currentBranch();
  const branches = await tools.git.listBranches();

  // Group by {ref}: strip any `origin/` prefix (when present) and any phase
  // prefix, match the remainder against `*/{ref}`, and collect each distinct
  // ref once — a ref reachable only via `origin/test/{ref}` is exactly as
  // active as one with a local branch (§2.1).
  const refs = new Set<string>();
  for (const branch of branches) {
    const bare = branch.replace(/^origin\//, "");
    for (const prefix of PHASE_PREFIXES) {
      if (bare.startsWith(`${prefix}/`)) {
        const ref = bare.slice(prefix.length + 1);
        if (TASK_REF_PATTERN.test(ref)) {
          refs.add(ref);
        }
      }
    }
  }

  const currentRef = deriveRefFromBranch(currentBranch);

  const tasks: TaskStatus[] = [];
  for (const ref of [...refs].sort()) {
    const taskStatus = await deriveRepoState(tools, ref, currentBranch);
    tasks.push({
      ...taskStatus,
      // branchMismatch is only meaningful on the current task's entry — a
      // non-current task's entry reports false even when the checked-out
      // branch differs from it (§3.2, LLD §3.10's nested markers).
      branchMismatch: ref === currentRef ? taskStatus.branchMismatch : false,
    });
  }

  const currentEntry =
    currentRef !== null ? tasks.find((task) => task.ref === currentRef) : undefined;

  return {
    success: true,
    messages: [
      "Listing the status of all current tasks...",
      ...tasks.map((task) => listLine(task, task.ref === currentRef)),
      ...(currentEntry !== undefined
        ? [
            `Task::Phase::State ${currentEntry.ref}::${currentEntry.phase ?? "-"}::${currentEntry.state}`,
          ]
        : []),
    ],
    tasks,
    currentRef,
  };
}
