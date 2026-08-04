import type {
  ExternalTools,
  Phase,
  PromoteCommandResult,
  TaskState,
} from "../types.js";
import { deriveRepoState, resolveReady } from "../lib/repo-state.js";

/**
 * `pnpm task promote [--json]` — see task-phasing-lld.md §3.11. This chunk
 * (MAG-46-10) implements the first real `promote` action: finding
 * `spec/{ref}` resolved `ready` (via `resolveReady()`, called
 * **unconditionally** — unlike `status`, which only resolves with `--check`),
 * create `test/{ref}` off `spec/{ref}` and return the worktree to
 * `spec/{ref}` (LLD §2.1's branch-restoration invariant — its first
 * application). Finding `spec/{ref}` `blocked`, take no git action and relay
 * the gate's own violations verbatim. The `branchMismatch` guard (LLD §3.4)
 * is evaluated on entry and refuses outright when `currentBranch !=
 * canonicalBranch`. Every other derived state (not-started / work-in-progress
 * / awaiting-pr / merged-pending-* / the test->build and build->main hops)
 * belongs to later chunks and defers.
 *
 * The phase/state/canonicalBranch/branchMismatch derivation is
 * `deriveRepoState()` from `lib/repo-state.ts` — the same function `status`
 * calls, not a private re-derivation — and `ready?` resolution is
 * `resolveReady()`, not a direct `gateChecks.run` call.
 */

/** The four phase-branch prefixes a ref can be checked out on — used to
 * derive the ref from the current branch name below. */
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
 * §3.11.1 / §3.9.1) — empty ref and null phase display as `-`. */
function stateLine(ref: string, phase: Phase | null, state: TaskState): string {
  const refPart = ref === "" ? "-" : ref;
  const phasePart = phase === null ? "-" : phase;
  return `Task::Phase::State ${refPart}::${phasePart}::${state}`;
}

export async function promote(
  tools: ExternalTools,
  _args: Record<string, boolean | number | string | string[]>,
): Promise<PromoteCommandResult> {
  // Fetch is called unconditionally before any derivation, matching `status`
  // (§1.1) — phase/state derivation must read fresh remote-tracking refs.
  await tools.git.fetch();

  const currentBranch = await tools.git.currentBranch();
  const ref = deriveRefFromBranch(currentBranch) ?? "";

  // The derivation pipeline is shared with `status` — never re-derived here.
  let taskStatus = await deriveRepoState(tools, ref, currentBranch);

  // `promote` always resolves `ready?` via `resolveReady()`: it cannot
  // safely act without knowing whether the derived phase is ready or blocked.
  taskStatus = await resolveReady(tools, taskStatus);

  // LLD §3.4's guard, evaluated on entry against the pre-fork state: refuses
  // outright — no git action at all — when the checked-out branch isn't the
  // task's canonical branch, naming both in the report.
  if (taskStatus.branchMismatch) {
    return {
      success: false,
      messages: [
        `Current branch \`${currentBranch}\` - ref: ${ref}`,
        `Refusing to promote: current branch \`${currentBranch}\` does not match the task's canonical phase/state branch \`${taskStatus.canonicalBranch}\``,
      ],
      action: "none",
    };
  }

  // The spec::ready -> forked action: create `test/{ref}` off `spec/{ref}`,
  // then restore the starting branch (branch-restoration invariant, §2.1).
  // Creating a branch checks it out (`git checkout -b`), so we must return
  // to `spec/{ref}` afterward or the fork parks the next phase's branch in
  // this worktree.
  if (taskStatus.state === "ready" && taskStatus.phase === "spec") {
    const canonical = taskStatus.canonicalBranch as string;
    const newBranch = `test/${ref}`;
    await tools.git.createBranch(newBranch, canonical);
    await tools.git.checkout(canonical);

    // Re-derive post-fork status: `test/{ref}` now exists with no commit of
    // its own (parent-aware `deriveState` → `not-started`), and, because the
    // restore invariant leaves us on `spec/{ref}` while the canonical branch
    // is now `test/{ref}`, the re-derived status reports `branchMismatch:
    // true` — an expected consequence, not a refusal (the guard already ran
    // against the pre-fork state on entry).
    const reDerived = await deriveRepoState(tools, ref, currentBranch);

    const messages = [
      `Current branch \`${currentBranch}\` - ref: ${ref}`,
      `Promoting ${ref}::${taskStatus.phase}::${taskStatus.state}...`,
      `  - Create new branch \`${newBranch}\` from \`${canonical}\` - OK`,
      `  - Restore starting branch \`${canonical}\` - OK`,
      `Current branch \`${reDerived.currentBranch}\` - ref: ${ref}`,
      stateLine(ref, reDerived.phase, reDerived.state),
    ];
    if (reDerived.branchMismatch && reDerived.canonicalBranch !== null) {
      messages.push(
        `Branch mismatch: canonical \`${reDerived.canonicalBranch}\`, checked out \`${reDerived.currentBranch}\` (expected - the branch-restoration invariant)`,
      );
    }

    return {
      success: true,
      action: "forked",
      messages,
    };
  }

  // A successfully-determined `blocked` result is a successful invocation
  // (exit 0): no git action, and the gate's own violation text relayed
  // verbatim, not reworded (§3.3).
  if (taskStatus.state === "blocked" && taskStatus.gate?.result) {
    return {
      success: true,
      action: "none",
      messages: [
        `Current branch \`${currentBranch}\` - ref: ${ref}`,
        stateLine(ref, taskStatus.phase, taskStatus.state),
        `Cannot promote: the ${taskStatus.gate.name} check reports violations`,
      ],
      violation: taskStatus.gate.result.violations[0],
    };
  }

  // Any other derived state (not-started, work-in-progress, awaiting-pr,
  // merged-pending-*, and the test->build / build->main ready hops) belongs
  // to a later chunk.
  throw new Error("not implemented");
}