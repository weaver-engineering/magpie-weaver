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
  args: Record<string, boolean | number | string | string[]>,
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

  // §3.5's plain rebase-forward: the derivation surfaced a rebase trigger —
  // either the staleness fallback (test/{ref} exists but spec/{ref} is not
  // its ancestor, so test/{ref} must be rebased onto the amended spec/{ref})
  // or trunk drift (origin/main is not an ancestor of the derived spec/task
  // branch, so it must be rebased onto origin/main). This runs *before* the
  // fork path because in the stale-test case phase is spec and state is
  // ready, which the fork action would otherwise claim. `--confirm-rebase`
  // (or an interactive y/N prompt, in non-`--json` mode) is required: a
  // force-push rewrite is never performed silently.
  if (taskStatus.rebase !== undefined) {
    const { branch, onto } = taskStatus.rebase;
    const confirmed = args["confirm-rebase"] === true;

    if (!confirmed) {
      // Refusal contract (LLD §3.5): no git action at all, report that a
      // rebase is required and what flag to supply, exit 1.
      return {
        success: false,
        action: "none",
        messages: [
          `Current branch \`${currentBranch}\` - ref: ${ref}`,
          `Promoting ${ref}::${taskStatus.phase}::${taskStatus.state} requires a rebase: \`${branch}\` is behind and must be rebased onto \`${onto}\``,
          `This is a force-pushed branch rewrite - confirm with --confirm-rebase to proceed`,
          `No action taken`,
        ],
      };
    }

    const outcome = await tools.git.rebase(branch, onto);

    if (outcome.status === "ok") {
      await tools.git.push(branch, { force: true });
      // §2.1's branch-restoration invariant: rebase()'s `git rebase --onto
      // <onto> <upstream> <branch>` form checks `<branch>` out as part of
      // the operation, so when the rebased branch differs from the caller's
      // starting branch (the §3.1 staleness case — rebasing test/{ref} from
      // spec/{ref}), the worktree is parked on it and must be returned.
      if (branch !== currentBranch) {
        await tools.git.checkout(currentBranch);
      }
      return {
        success: true,
        action: "rebased",
        rebaseOutcome: outcome,
        messages: [
          `Current branch \`${currentBranch}\` - ref: ${ref}`,
          `Rebased \`${branch}\` onto \`${onto}\` and force-pushed`,
          ...(branch !== currentBranch
            ? [`Restored starting branch \`${currentBranch}\``]
            : []),
        ],
      };
    }

    if (outcome.status === "conflict") {
      // The conflict was discovered mid-replay, AFTER rebase() checked the
      // branch out — the caller's starting branch is restored regardless of
      // outcome (§2.1). No push of a conflicted rewrite.
      if (branch !== currentBranch) {
        await tools.git.checkout(currentBranch);
      }
      return {
        success: false,
        action: "rebased",
        rebaseOutcome: outcome,
        messages: [
          `Current branch \`${currentBranch}\` - ref: ${ref}`,
          `Rebase of \`${branch}\` onto \`${onto}\` hit a conflict`,
          `${outcome.details}`,
          ...(branch !== currentBranch
            ? [`Restored starting branch \`${currentBranch}\``]
            : []),
        ],
      };
    }

    // unexpected-commit-count: rebase()'s precondition is a plain
    // `rev-list --count`, checked BEFORE any checkout is attempted, so the
    // worktree never moved and there is nothing to restore (§2.1). The
    // branch carries more than one commit of its own — the agent must squash
    // before promoting.
    return {
      success: false,
      action: "rebased",
      rebaseOutcome: outcome,
      messages: [
        `Current branch \`${currentBranch}\` - ref: ${ref}`,
        `Cannot rebase \`${branch}\` onto \`${onto}\`: it has ${outcome.actual} commits of its own, expected ${outcome.expected}`,
        `Please squash \`${branch}\` to a single commit before promoting`,
      ],
    };
  }

  // An open Build Gate PR derives `awaiting-pr` on the test phase (spec 11
  // §3.3). `promote` is a safe, idempotent no-op here — the PR is already
  // open, so neither the branch nor the PR is (re)created; the existing
  // PR's number is re-stated rather than a generic "nothing to do".
  if (taskStatus.state === "awaiting-pr") {
    const messages = [
      `Current branch \`${currentBranch}\` - ref: ${ref}`,
      stateLine(ref, taskStatus.phase, taskStatus.state),
    ];
    const open = await tools.github.findOpenPR(`build/${ref}`, `test/${ref}`);
    if (open !== null) {
      messages.push(`PR #${open.number} is open for ${ref}: ${open.url}`);
    }
    return {
      success: true,
      action: "none",
      messages,
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

  // The test::ready -> pr-raised action (spec 11 §3.1/§3.1.1): raise the
  // Build Gate PR (`test/{ref}` -> `build/{ref}`). Nothing earlier in the
  // workflow creates `build/{ref}`, so when it's absent on origin it is
  // first published from `origin/main` — a PR cannot be opened against a
  // base branch that isn't there (it would 422). The branch is created
  // straight on origin, never checked out locally (would take a worktree
  // slot for a branch the test/build phases never work on, §2.1).
  if (taskStatus.state === "ready" && taskStatus.phase === "test") {
    const buildBranch = `build/${ref}`;
    const headBranch = `test/${ref}`;
    if (!(await tools.git.branchExists(buildBranch, { remote: true }))) {
      await tools.git.createRemoteBranch(buildBranch, "origin/main");
    }
    const pr = await tools.github.createPR(buildBranch, headBranch, {
      title: `Task ${ref}: promote ${ref}::test::ready to build (Build Gate)`,
    });
    return {
      success: true,
      action: "pr-raised",
      prNumber: pr.number,
      prUrl: pr.url,
      messages: [
        `Current branch \`${currentBranch}\` - ref: ${ref}`,
        stateLine(ref, taskStatus.phase, taskStatus.state),
        `PR #${pr.number} opened for ${ref}: ${pr.url}`,
      ],
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