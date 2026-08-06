import type { ExternalTools, Phase, StatusCommandResult, TaskState, TaskStatus } from "../types.js";
import { deriveRepoState, resolveReady } from "../lib/repo-state.js";
import { commitWipOnCurrentBranch, deriveRefFromBranch } from "../lib/wip-commit.js";

/**
 * `pnpm task status ...` — see task-phasing-lld.md §3.9. Implements the
 * §3.2 derivation pipeline's branch-exists case (specs 06 + 06.01 + 09):
 * a phase branch exists, so status first defers if any gate PR for `{ref}`
 * is merged or open (spec 06.01) and otherwise derives phase/state from the
 * branches themselves (`not-started` vs `ready?` vs `work-in-progress`,
 * specs 06/09). `--check` (MAG-46-09 §2.1) opts into resolving `ready?` to
 * `ready`/`blocked` via `resolveReady()`, and refuses — exit 1 — when
 * `--ref <other>` asks to check a task other than the one checked out.
 * `--fix` (MAG-46-18) switches to the canonical branch on a mismatch
 * (reporting `fixed: true`), optionally committing WIP first when `--wip`
 * is also given; it is a no-op when already canonical (`fixed: false`).
 * The
 * derivation itself lives in `lib/repo-state.ts` (LLD §4.5) — shared with
 * every other command that needs the same {ref, phase, state} pipeline, not
 * reimplemented here. The `--wip`-related helpers live in
 * `lib/wip-commit.ts`, shared with `wip` and `init --wip` (§3.12).
 */

/** Renders one `Task::Phase::State <ref>::<phase>::<state>` line (LLD
 * §3.9.1/§3.8.1) — empty ref and null phase display as `-`. */
function stateLine(ref: string, phase: Phase | null, state: TaskState): string {
  const refPart = ref === "" ? "-" : ref;
  const phasePart = phase === null ? "-" : phase;
  return `Task::Phase::State ${refPart}::${phasePart}::${state}`;
}

export async function status(
  tools: ExternalTools,
  args: Record<string, boolean | number | string | string[]>,
): Promise<StatusCommandResult> {
  // Fetch is called unconditionally before any derivation (§1.1/§2.1) — its
  // result isn't even needed for the not-initialised base case.
  await tools.git.fetch();

  const currentBranch = await tools.git.currentBranch();

  const refArg = typeof args.ref === "string" ? args.ref : "";
  const ref = refArg !== "" ? refArg : (deriveRefFromBranch(currentBranch) ?? "");

  if (ref === "") {
    // No ref derivable from the checked-out branch (e.g. on `main`) — with
    // no task to inspect, the base case applies.
    return notInitialisedResult(ref, currentBranch);
  }

  let taskStatus = await deriveRepoState(tools, ref, currentBranch);

  const checkRequested = args.check === true;

  // --check is only valid when `--ref` names the currently checked-out task.
  // A mismatch is a hard refusal (success: false / exit 1), not a crash —
  // the taskStatus for `<ref>` is still fully derived underneath.
  const checkedOutRef = deriveRefFromBranch(currentBranch);
  if (checkRequested && checkedOutRef !== ref) {
    return {
      success: false,
      messages: [
        `Current branch \`${currentBranch}\` - ref: ${ref}`,
        stateLine(ref, taskStatus.phase, taskStatus.state),
        `--check requires ${ref} to be the currently checked-out task (checked-out ref: ${checkedOutRef ?? "none"})`,
      ],
      taskStatus,
      checked: false,
      checkRefused: true,
      fixed: false,
    };
  }

  // --check is an opt-in: resolving ready? (via resolveReady) runs the gate
  // only when --check was requested. A plain read or a non-ready? state
  // leaves ready?/work-in-progress unresolved and never calls gate checks.
  if (checkRequested) {
    taskStatus = await resolveReady(tools, taskStatus);
  }

  // --fix (MAG-46-18, LLD §3.9): on a branch mismatch, switch to the
  // canonical branch — optionally committing WIP first when --wip is also
  // given and the worktree is dirty. A no-op when the current branch
  // already is the canonical branch (fixed: false, nothing checked out).
  // The switch happens after the --check-refused guard so a refused
  // invocation never silently acts on the working tree, and the reported
  // taskStatus keeps the pre-switch derivation (the derivation's own
  // currentBranch/branchMismatch record the mismatch --fix just resolved).
  let fixed = false;
  let fixedTarget: string | undefined;
  if (args.fix !== undefined) {
    // --fix is not applicable with `--ref` naming a task other than the
    // checked-out one (LLD §3.9: there is no "current branch" of `<ref>`
    // to fix/carry WIP on) — nothing is switched.
    const fixApplicable = refArg === "" || checkedOutRef === ref;
    if (fixApplicable) {
      // `--fix [branch]`: an explicit branch overrides the derived
      // canonical branch; bare `--fix` switches to the canonical one.
      const target = typeof args.fix === "string" ? args.fix : taskStatus.canonicalBranch;
      if (target !== null && currentBranch !== target) {
        if (args.wip !== undefined && (await tools.git.isDirty())) {
          await commitWipOnCurrentBranch(tools, args.wip, currentBranch);
        }
        await tools.git.checkout(target);
        fixed = true;
        fixedTarget = target;
      }
    }
  }

  // A successfully-resolved `blocked` read is still a successful status
  // invocation (exit 0, §3.9) — it only carries the gate's own violation
  // message verbatim, not a reworded one (§3.3).
  const violation =
    taskStatus.state === "blocked" && taskStatus.gate?.result
      ? taskStatus.gate.result.violations[0]
      : undefined;

  return {
    success: true,
    messages: [
      `Current branch \`${currentBranch}\` - ref: ${ref}`,
      stateLine(ref, taskStatus.phase, taskStatus.state),
      ...(fixedTarget !== undefined ? [`Switched to \`${fixedTarget}\``] : []),
    ],
    violation,
    taskStatus,
    checked: checkRequested && taskStatus.gate !== undefined,
    checkRefused: false,
    fixed,
  };
}

function notInitialisedResult(ref: string, currentBranch: string): StatusCommandResult {
  const taskStatus: TaskStatus = {
    ref,
    phase: null,
    canonicalBranch: null,
    currentBranch,
    branchMismatch: false,
    state: "not-initialised",
  };

  return {
    success: true,
    messages: [
      `Current branch \`${currentBranch}\` - ref: ${ref === "" ? "-" : ref}`,
      stateLine(ref, null, "not-initialised"),
    ],
    taskStatus,
    checked: false,
    checkRefused: false,
    fixed: false,
  };
}