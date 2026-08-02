import type { ExternalTools, GateName, Phase, TaskState, TaskStatus } from "../types.js";

/**
 * Repo-state derivation shared across commands — see task-phasing-lld.md
 * §4.5. Extracted from `status.ts` (spec 06/06.01), which was the first
 * command to need it; `wip`/`promote`/`ref` (MAG-46-07/10/17) need the
 * exact same {ref, phase, state} pipeline, not a fork of it.
 */

/** The four phase-branch prefixes that make a ref "initialised". */
const PHASE_PREFIXES = ["spec", "test", "build", "task"] as const;

/** The base/head pairs whose merge/open state drives the §3.2 pipeline
 * ahead of branch-exists derivation: the two Main Gate PRs
 * (`build/{ref}` / `task/{ref}` -> `main`) and the Build Gate PR
 * (`test/{ref}` -> `build/{ref}`). Merged pair first, then open, in LLD
 * §3.2's order. */
const GATE_PR_PAIRS: ReadonlyArray<readonly [base: string, head: string]> = [
  ["main", "build/{ref}"],
  ["main", "task/{ref}"],
  ["build/{ref}", "test/{ref}"],
] as const;

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

/** Defers ("not implemented") if any gate PR exists for `ref` — a merged
 * or open PR on any of the three gate pairs (§3.1-§3.4). This runs
 * *before* the branch-exists derivation, so a PR-present task never
 * silently misreports as `not-started`/`work-in-progress`. The PR-driven
 * states (`awaiting-pr`, `merged-pending-pull`, `merged-pending-cleanup`)
 * are owned by later chunks (MAG-46-11/12/15); until they land, an
 * existing PR means the caller cannot answer authoritatively. */
async function assertNoGatePR(tools: ExternalTools, ref: string): Promise<void> {
  for (const [base, head] of GATE_PR_PAIRS) {
    const baseName = base.replace("{ref}", ref);
    const headName = head.replace("{ref}", ref);
    if ((await tools.github.findMergedPR(baseName, headName)) !== null) {
      throw new Error("not implemented");
    }
    if ((await tools.github.findOpenPR(baseName, headName)) !== null) {
      throw new Error("not implemented");
    }
  }
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

/** Derives the no-PR branch-exists `PhaseState` (specs 06 + 09): no
 * commits beyond `main` → `not-started`; commits exist → `ready?`, unless
 * the head commit is WIP-marked, which holds derivation at
 * `work-in-progress` (§3.7) — a WIP-marked head never reaches `ready?`.
 * `ready?`/`ready`/`blocked` *resolution* itself is `resolveReady()`'s
 * scope (MAG-46-09 §2.1), not this function's.
 *
 * This is spec 06's post-MAG-46-09 correction (§3.2/§3.4/§3.5): a
 * non-WIP-marked branch with commits reports `ready?`, not
 * `work-in-progress`. Only a genuinely WIP-marked head stays
 * `work-in-progress`. */
async function deriveState(
  tools: ExternalTools,
  canonicalBranch: string,
): Promise<TaskState> {
  if (!(await tools.git.hasCommitsBeyond(canonicalBranch, "main"))) {
    return "not-started";
  }
  const title = await tools.git.headCommitTitle(canonicalBranch);
  if (title.includes("WIP")) {
    return "work-in-progress";
  }
  return "ready?";
}

/** LLD §3.7's phase -> destination-gate table, keyed off `status.phase` —
 * the same mapping the gate-checks tool's `gateFor()` holds, inline here
 * because `resolveReady()` must populate the `gate` metadata without
 * conscripting the gate-check tool itself (nothing may run `gateChecks`
 * on the non-ready? pass-through path). `enforced` is false only for the
 * `spec` → `test-gate` step, which the branch-protection layer doesn't
 * cover. */
const GATE_FOR_PHASE: Readonly<Record<Phase, { name: GateName; enforced: boolean }>> = {
  spec: { name: "test-gate", enforced: false },
  test: { name: "build-gate", enforced: true },
  build: { name: "main-gate", enforced: true },
  quick: { name: "main-gate", enforced: true },
};

/** Resolves a `ready?` `TaskStatus` to `ready` or `blocked` by running the
 * destination gate for its derived phase (MAG-46-09 §2.1, LLD §3.7) —
 * `promote` (MAG-46-10/11) calls this unconditionally, so it MUST be a
 * pure pass-through for any state that isn't already `ready?`: it returns
 * the exact input object and never touches `gateChecks`, letting callers
 * rely on it always being safe to call.
 *
 * When the state *is* `ready?`, `gateChecks.run(phase, {ref})` is invoked
 * with the derived phase — not a guessed one — and the result reshaped
 * into `ready` (passed) or `blocked` (failed), with the `gate` metadata
 * populated from the LLD §3.7 table above. */
export async function resolveReady(
  tools: ExternalTools,
  status: TaskStatus,
): Promise<TaskStatus> {
  if (status.state !== "ready?") {
    return status;
  }
  const phase = status.phase;
  if (phase === null) {
    return status;
  }
  const result = await tools.gateChecks.run(phase, { ref: status.ref });
  return {
    ...status,
    state: result.passed ? "ready" : "blocked",
    gate: {
      name: GATE_FOR_PHASE[phase].name,
      enforced: GATE_FOR_PHASE[phase].enforced,
      result,
    },
  };
}

/** Derives the full repo state for `ref` — LLD §4.5's pipeline: no phase
 * branch of any kind means `not-initialised`; otherwise defer if a gate
 * PR exists for `ref` (§3.1-§3.4), and only with no gate PR derive
 * phase/state from the branches themselves (§3.2/§3.5-§3.7). Callers must
 * `fetch()` first — this never mutates local branches or fetches itself,
 * matching §4.5's "reports these states only" contract. */
export async function deriveRepoState(
  tools: ExternalTools,
  ref: string,
  currentBranch: string,
): Promise<TaskStatus> {
  if (!(await anyPhaseBranchExists(tools, ref))) {
    return {
      ref,
      phase: null,
      canonicalBranch: null,
      currentBranch,
      branchMismatch: false,
      state: "not-initialised",
    };
  }

  await assertNoGatePR(tools, ref);

  const { phase, canonicalBranch } = await derivePhase(tools, ref);
  const state = await deriveState(tools, canonicalBranch);

  return {
    ref,
    phase,
    canonicalBranch,
    currentBranch,
    branchMismatch: currentBranch !== canonicalBranch,
    state,
  };
}
