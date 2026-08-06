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
 * (`ready/{ref}` / `task/{ref}` -> `main`) and the Build Gate PR
 * (`test/{ref}` -> `build/{ref}`). Merged pair first, then open, in LLD
 * §3.2's order.
 *
 * The regular route's Main Gate PR head is `ready/{ref}`, NOT `build/{ref}`
 * — every real Main Gate PR in this project's history uses `ready/{ref}`
 * (the `main/{ref}` -> `ready/{ref}` rename recorded in task-MAG-40.md;
 * `build/{ref}` is the static staging branch `ready/{ref}` forks from,
 * never the PR head). The merged-PR *lookup* therefore checks
 * `ready/{ref}`, while the derived canonicalBranch/phase stay `build/{ref}`
 * — `ready/{ref}` is transient and deleted after the merge, `build/{ref}`
 * is the persistent branch to report/checkout/delete. */
const GATE_PR_PAIRS: ReadonlyArray<readonly [base: string, head: string]> = [
  ["main", "ready/{ref}"],
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

/** The §3.2 merge-status/open-PR stage, run *before* the branch-exists
 * derivation. Returns a `TaskStatus` for the PR-driven state this chunk
 * owns, or `null` when no owned PR drives the state (so branch-exists
 * derivation applies). The merged Build Gate PR (`build/{ref}` <-
 * `test/{ref}`) derives `merged-pending-pull` for the ordinary merge
 * (spec 12 §3.1/§3.2); the merged Main Gate pairs (`main`/`ready/{ref}`,
 * `main`/`task/{ref}`) derive `merged-pending-cleanup` (MAG-46-15 §3.1)
 * when local `main` hasn't caught up with the merge. The regular route's
 * open Main Gate PR still defers ("not implemented") — that state (the
 * regular route's Main-Gate `awaiting-pr`) is owned by a later chunk.
 * The open Build Gate PR (`test/{ref}` -> `build/{ref}`) derives `awaiting-pr`
 * attached to the **source** phase `test` (spec 11 §3.2/§3.4); the open quick
 * route's Main Gate PR (`main`/`task/{ref}`) derives `awaiting-pr` attached to
 * the source phase `quick` (spec 11.01 §3.4) — never the destination. */
async function derivePrState(
  tools: ExternalTools,
  ref: string,
  currentBranch: string,
): Promise<TaskStatus | null> {
  for (const [base, head] of GATE_PR_PAIRS) {
    const baseName = base.replace("{ref}", ref);
    const headName = head.replace("{ref}", ref);
    const merged = await tools.github.findMergedPR(baseName, headName);
    if (merged !== null) {
      // The merged Build Gate PR is this chunk's derivation — but only for
      // the ordinary merge: `test/{ref}`'s current HEAD is compared against
      // the merged PR's recorded `headRefOid` (§2.1), and a mismatch is the
      // superseded-merge case, still deferred (MAG-46-13/14's concern).
      //
      // `test/{ref}` is read via the remote-tracking ref (`origin/test/{ref}`),
      // not the bare local name: `fetch()` only ever updates the former and
      // never checks a local `test/{ref}` out, so the local branch can
      // legitimately not exist (a fresh clone, a CI runner, an architect
      // worktree that never branched every phase). It is read-only input to
      // the headRefOid comparison — unlike §3.2's local-vs-origin comparison
      // for `build/{ref}`, whose whole point is comparing local state.
      if (base === "build/{ref}" && head === "test/{ref}") {
        if ((await tools.git.headSha(`origin/${headName}`)) === merged.headRefOid) {
          const canonicalBranch = baseName;
          // Both sub-cases report `merged-pending-pull`: no local
          // `build/{ref}` yet (§3.1), or local `build/{ref}` behind
          // `origin/build/{ref}` (§3.2). Never resolves the state — no
          // pullFastForward/rebase/checkout here (resolving is
          // promote-only, MAG-46-14).
          if (!(await tools.git.branchExists(canonicalBranch, { remote: false }))) {
            return {
              ref,
              phase: "build",
              canonicalBranch,
              currentBranch,
              branchMismatch: currentBranch !== canonicalBranch,
              state: "merged-pending-pull",
            };
          }
          if (
            (await tools.git.headSha(canonicalBranch)) !==
            (await tools.git.headSha(`origin/${canonicalBranch}`))
          ) {
            return {
              ref,
              phase: "build",
              canonicalBranch,
              currentBranch,
              branchMismatch: currentBranch !== canonicalBranch,
              state: "merged-pending-pull",
            };
          }
          // §3.3: local `build/{ref}` already caught up with origin — the
          // merged PR no longer drives the state; fall through to MAG-46-06's
          // ordinary state derivation applied to the build phase.
          const state = await deriveState(tools, "build", ref, canonicalBranch);
          return {
            ref,
            phase: "build",
            canonicalBranch,
            currentBranch,
            branchMismatch: currentBranch !== canonicalBranch,
            state,
          };
        }
      }
      // The merged Main Gate pairs (`main`/`ready/{ref}` regular route,
      // `main`/`task/{ref}` quick route) derive `merged-pending-cleanup`
      // (MAG-46-15 §3.1) when local `main` hasn't caught up with the merge
      // yet. The "change not in main" confirmation is
      // `isAncestor(mergeCommitOid, "main")` — the PR's own merge commit's
      // reachability from local `main`, not merely "a merged PR exists".
      if (base === "main") {
        // The regular route's merged-PR head is `ready/{ref}` (see
        // GATE_PR_PAIRS), but the canonical branch/phase stay `build/{ref}`
        // — `ready/{ref}` is transient and gone after the merge, while
        // `build/{ref}` is the persistent branch to report/checkout/delete.
        const isRegularRoute = head === "ready/{ref}";
        const canonicalBranch = isRegularRoute ? `build/${ref}` : headName;
        const phase: Phase = isRegularRoute ? "build" : "quick";
        if (!(await tools.git.isAncestor(merged.mergeCommitOid, "main"))) {
          return {
            ref,
            phase,
            canonicalBranch,
            currentBranch,
            branchMismatch: currentBranch !== canonicalBranch,
            state: "merged-pending-cleanup",
          };
        }
        // Local `main` has already caught up with the merge — the merged PR
        // no longer drives the state; fall through to the no-PR derivation
        // for whatever branches survive.
        continue;
      }
      // The superseded-merge Build Gate case (and, defensively, any other
      // unowned merged pair) is an unconditional deferral.
      throw new Error("not implemented");
    }
    const open = await tools.github.findOpenPR(baseName, headName);
    if (open !== null) {
      // The quick route's open Main Gate PR (`main`/`task/{ref}`) is this
      // chunk's extension of the awaiting-pr resolution: `awaiting-pr`
      // attached to the **source** phase of that PR — `quick`, never the
      // destination `main` (spec 11.01 §3.4, §2.1's one-derivation-for-all-
      // routes). The regular route's open Main Gate PR
      // (`main`/`ready/{ref}`) still defers — its awaiting-pr is owned by
      // a later chunk.
      if (base === "main" && head === "task/{ref}") {
        const canonicalBranch = `task/${ref}`;
        return {
          ref,
          phase: "quick",
          canonicalBranch,
          currentBranch,
          branchMismatch: currentBranch !== canonicalBranch,
          state: "awaiting-pr",
        };
      }
      // Only the open Build Gate PR (`test/{ref}` -> `build/{ref}`) is the
      // other real derivation; the regular Main Gate route stays deferred.
      if (base !== "build/{ref}") {
        throw new Error("not implemented");
      }
      const canonicalBranch = `test/${ref}`;
      return {
        ref,
        phase: "test",
        canonicalBranch,
        currentBranch,
        branchMismatch: currentBranch !== canonicalBranch,
        state: "awaiting-pr",
      };
    }
  }
  return null;
}

/** MAG-46-15 §3.2's interrupted-cleanup retrigger: no gate PR is found
 * (the PR-driven stage above ran and found nothing), yet a surviving phase
 * branch is already an ancestor of local `main` — the Main Gate content is
 * in `main`, and a prior, interrupted cleanup left the branch behind.
 * Derives the SAME `merged-pending-cleanup` state as §3.1's ordinary
 * route (never a distinct "stale"/"broken" state).
 *
 * The trigger is deliberately narrow, matching the cleanup semantics:
 *   - `spec/{ref}` must already be gone — it is the FIRST branch the
 *     cleanup deletes, so its absence is what distinguishes an
 *     interrupted cleanup from ordinary in-progress work (whose spec/
 *     test/build branches all still exist).
 *   - a `test/{ref}` or `build/{ref}` survivor must exist locally and be
 *     an ancestor of local `main` (the ancestry check the §3.2 Given
 *     pins: `isAncestor("test/{ref}", "main")`).
 *   - the caller must be on `main` (a `status` read) or the retrigger's
 *     canonical branch `build/{ref}` (a `promote` invocation — whose own
 *     `branchMismatch` guard forces the caller there anyway). */
async function derivePendingCleanupRetrigger(
  tools: ExternalTools,
  ref: string,
  currentBranch: string,
): Promise<TaskStatus | null> {
  if (await tools.git.branchExists(`spec/${ref}`)) {
    return null;
  }
  const canonicalBranch = `build/${ref}`;
  if (currentBranch !== "main" && currentBranch !== canonicalBranch) {
    return null;
  }
  for (const branch of [`test/${ref}`, `build/${ref}`]) {
    if (await tools.git.branchExists(branch)) {
      if (await tools.git.isAncestor(branch, "main")) {
        return {
          ref,
          phase: "build",
          canonicalBranch,
          currentBranch,
          branchMismatch: currentBranch !== canonicalBranch,
          state: "merged-pending-cleanup",
        };
      }
    }
  }
  return null;
}

/** Derives the phase whose branch is currently authoritative for `ref`,
 * alongside that phase's canonical branch, in the no-PR case (LLD §3.2's
 * branch-exists chain). `test/{ref}` is the authority unless `spec/{ref}`
 * was amended after the fork — the staleness check (§3.5) — in which case
 * derivation falls back to `spec`, and `test/{ref}` is never consulted. */
async function derivePhase(
  tools: ExternalTools,
  ref: string,
): Promise<{ phase: Phase; canonicalBranch: string; staleTestBranch: boolean }> {
  const testBranch = `test/${ref}`;
  const specBranch = `spec/${ref}`;
  const taskBranch = `task/${ref}`;

  if (await tools.git.branchExists(testBranch)) {
    // Staleness check (§3.5): `spec/{ref}` amended after `test/{ref}`
    // forked makes spec authoritative — test is simply not consulted. The
    // flag itself is surfaced to `deriveRepoState`, whose §3.5 rebase-forward
    // detection turns it into the "rebase test/{ref} onto spec/{ref}" trigger.
    if (!(await tools.git.isAncestor(specBranch, testBranch))) {
      return { phase: "spec", canonicalBranch: specBranch, staleTestBranch: true };
    }
    return { phase: "test", canonicalBranch: testBranch, staleTestBranch: false };
  }
  if (await tools.git.branchExists(specBranch)) {
    return { phase: "spec", canonicalBranch: specBranch, staleTestBranch: false };
  }
  if (await tools.git.branchExists(taskBranch)) {
    return { phase: "quick", canonicalBranch: taskBranch, staleTestBranch: false };
  }
  // A phase branch exists (anyPhaseBranchExists returned true) but none
  // of the three derivable phases matches — the only remaining prefix is
  // `build/{ref}`, whose states are all PR-driven (awaiting-pr /
  // merged-pending-*) and land with later chunks (MAG-46-11/12/15).
  throw new Error("not implemented");
}

/** The parent branch a phase's state is derived against — spec 10 §2.1's
 * correction: a phase is `not-started` when it has no commit **of its
 * own**, i.e. comparing against the branch it forked from, not `main`.
 * A freshly-forked `test/{ref}` carries no own commits, so it reports
 * `not-started` even though it inherits `spec/{ref}`'s history. The
 * spec/quick `origin/main` entries are MAG-46-10.01's correction — this
 * chunk keeps the pre-existing `"main"` parent for them. `build` is
 * unreachable here (its states are all PR-driven, MEL-46-11/12/15), but
 * its parent is recorded for when it lands. */
function deriveParentBranch(phase: Phase, ref: string): string {
  switch (phase) {
    case "test":
      return `spec/${ref}`;
    case "build":
      return `origin/build/${ref}`;
    case "spec":
    case "quick":
      // 10.01 brings `origin/main`; unchanged here so the already-merged
      // spec/quick state assertions (which pin "main") stay valid.
      return "main";
  }
}

/** Derives the no-PR branch-exists `PhaseState` (specs 06 + 09, corrected
 * per spec 10 §2.1): no commits beyond the phase's **own parent branch**
 * (`deriveParentBranch`) → `not-started`; commits exist → `ready?`, unless
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
  phase: Phase,
  ref: string,
  canonicalBranch: string,
): Promise<TaskState> {
  if (!(await tools.git.hasCommitsBeyond(canonicalBranch, deriveParentBranch(phase, ref)))) {
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

  const prState = await derivePrState(tools, ref, currentBranch);
  if (prState !== null) {
    return prState;
  }

  // MAG-46-15 §3.2: with no gate PR found, an interrupted prior cleanup
  // (spec/{ref} already deleted, a surviving test/build branch already an
  // ancestor of local main) still derives merged-pending-cleanup — the
  // retrigger converges on the identical state as §3.1's ordinary route.
  const retrigger = await derivePendingCleanupRetrigger(tools, ref, currentBranch);
  if (retrigger !== null) {
    return retrigger;
  }

  const { phase, canonicalBranch, staleTestBranch } = await derivePhase(tools, ref);
  const state = await deriveState(tools, phase, ref, canonicalBranch);

  // §3.5 rebase-forward detection: `deriveRepoState` surfaces (but never
  // acts on) the two plain-rebase situations `promote` must resolve. The two
  // are mutually exclusive per invocation (§2.1) — whichever the derivation
  // actually surfaced wins. The staleness fallback is the more specific
  // trigger (a real test/{ref} branch is behind the amended spec/{ref}), so
  // it takes precedence over trunk drift.
  //
  // Trunk drift is measured against `origin/main`, not local `main` (§2.1's
  // correction): a local `main` is an ordinary branch that only moves when
  // something moves it, so it is not a live view of the trunk and deriving
  // "behind the trunk" against it can produce a false negative. This is an
  // `isAncestor` check, distinct from `deriveState`'s `hasCommitsBeyond`
  // parent comparison, which stays on the pre-existing `"main"` parent.
  let rebase: { branch: string; onto: string } | undefined;
  if (staleTestBranch) {
    rebase = { branch: `test/${ref}`, onto: canonicalBranch };
  } else if (phase === "spec" || phase === "quick") {
    const trunk = "origin/main";
    if (!(await tools.git.isAncestor(trunk, canonicalBranch))) {
      rebase = { branch: canonicalBranch, onto: trunk };
    }
  }

  return {
    ref,
    phase,
    canonicalBranch,
    currentBranch,
    branchMismatch: currentBranch !== canonicalBranch,
    state,
    ...(rebase !== undefined && { rebase }),
  };
}
