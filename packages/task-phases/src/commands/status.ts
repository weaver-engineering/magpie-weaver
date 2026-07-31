import type {
  ExternalTools,
  Phase,
  StatusCommandResult,
  TaskState,
  TaskStatus,
} from "../types.js";

/**
 * `pnpm task status ...` — see task-phasing-lld.md §3.9. Implements the
 * §3.2 derivation pipeline's branch-exists case (spec 06): a phase
 * branch exists, so phase/state are derived from the branches themselves
 * (`not-started` vs `work-in-progress`). The merge-status / open-PR /
 * ready? branches of the pipeline (awaiting-pr / merged-pending-* /
 * ready? resolution) are not consulted here — they land with the chunks
 * that own them (MAG-46-06.01 / MAG-46-09/11/12/15). In particular, a
 * task with a gate PR open does not yet defer `status`; that deferral is
 * the subject of MAG-46-06.01.
 */

/** The four phase-branch prefixes that make a ref "initialised". */
const PHASE_PREFIXES = ["spec", "test", "build", "task"] as const;

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

/** Renders one `Task::Phase::State <ref>::<phase>::<state>` line (LLD
 * §3.9.1/§3.8.1) — empty ref and null phase display as `-`. */
function stateLine(ref: string, phase: Phase | null, state: TaskState): string {
  const refPart = ref === "" ? "-" : ref;
  const phasePart = phase === null ? "-" : phase;
  return `Task::Phase::State ${refPart}::${phasePart}::${state}`;
}

/** True if any phase branch exists for `ref`, locally or on `origin` —
 * every branch must be absent for the task to be `not-initialised`. */
async function anyPhaseBranchExists(
  tools: ExternalTools,
  ref: string,
): Promise<boolean> {
  for (const prefix of PHASE_PREFIXES) {
    const name = `${prefix}/${ref}`;
    if (await tools.git.branchExists(name)) {
      return true;
    }
    if (await tools.git.branchExists(name, { remote: true })) {
      return true;
    }
  }
  return false;
}

/** Derives the phase whose branch is currently authoritative for `ref`,
 * alongside that phase's canonical branch, in the no-PR case (LLD §3.2's
 * branch-exists chain). `test/{ref}` is the authority unless `spec/{ref}`
 * was amended after the fork — the staleness check (§3.5) — in which case
 * derivation falls back to `spec`, and `test/{ref}` is never consulted. */
async function derivePhase(
  tools: ExternalTools,
  ref: string,
): Promise<{ phase: Phase; canonicalBranch: string }> {
  const testBranch = `test/${ref}`;
  const specBranch = `spec/${ref}`;
  const taskBranch = `task/${ref}`;

  if (await tools.git.branchExists(testBranch)) {
    // Staleness check (§3.5): `spec/{ref}` amended after `test/{ref}`
    // forked makes spec authoritative — test is simply not consulted.
    if (!(await tools.git.isAncestor(specBranch, testBranch))) {
      return { phase: "spec", canonicalBranch: specBranch };
    }
    return { phase: "test", canonicalBranch: testBranch };
  }
  if (await tools.git.branchExists(specBranch)) {
    return { phase: "spec", canonicalBranch: specBranch };
  }
  if (await tools.git.branchExists(taskBranch)) {
    return { phase: "quick", canonicalBranch: taskBranch };
  }
  // A phase branch exists (anyPhaseBranchExists returned true) but none
  // of the three derivable phases matches — the only remaining prefix is
  // `build/{ref}`, whose states are all PR-driven (awaiting-pr /
  // merged-pending-*) and land with later chunks (MAG-46-11/12/15).
  throw new Error("not implemented");
}

/** Derives the no-PR branch-exists `PhaseState` (spec 06): no commits
 * beyond `main` → `not-started`; commits exist → `work-in-progress`. The
 * head commit's title is consulted for the WIP marker (§3.7) — a
 * WIP-marked head holds derivation at `work-in-progress`, never `ready?`.
 * `ready?`/`ready`/`blocked` resolution itself is MAG-46-09's scope, so
 * both WIP-marked and plain heads resolve to `work-in-progress` here. */
async function deriveState(
  tools: ExternalTools,
  canonicalBranch: string,
): Promise<TaskState> {
  if (!(await tools.git.hasCommitsBeyond(canonicalBranch, "main"))) {
    return "not-started";
  }
  await tools.git.headCommitTitle(canonicalBranch);
  return "work-in-progress";
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

  if (await anyPhaseBranchExists(tools, ref)) {
    // A phase branch exists — derive phase and state from the branches
    // themselves (spec 06). The merge-status / open-PR / ready? branches
    // of the §3.2 pipeline are out of scope for this chunk (MAG-46-06.01
    // / MAG-46-09/11/12/15).
    const { phase, canonicalBranch } = await derivePhase(tools, ref);
    const state = await deriveState(tools, canonicalBranch);

    const taskStatus: TaskStatus = {
      ref,
      phase,
      canonicalBranch,
      currentBranch,
      branchMismatch: currentBranch !== canonicalBranch,
      state,
    };

    return {
      success: true,
      messages: [
        `Current branch \`${currentBranch}\` - ref: ${ref}`,
        stateLine(ref, phase, state),
      ],
      taskStatus,
      checked: false,
      checkRefused: false,
      fixed: false,
    };
  }

  return notInitialisedResult(ref, currentBranch);
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
