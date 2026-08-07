import type {
  ExternalTools,
  Phase,
  PromoteCommandResult,
  TaskState,
} from "../types.js";
import { deriveRepoState, resolveReady } from "../lib/repo-state.js";

/**
 * `pnpm task promote [--json]` — see task-phasing-lld.md §3.11. This chunk
 * (MAG-46-14) implements the `merged-pending-pull` resolution: the Build
 * Gate PR merged but local `build/{ref}` doesn't yet reflect it (derived in
 * MAG-46-12), so `promote` either plain-pulls it (no local `build/{ref}` —
 * `action: "pulled"`, no confirmation, §3.1) or pulls AND rebases the
 * pre-existing build commits onto the fresh merge (`action:
 * "pulled-and-rebased"`, gated by `--confirm-rebase` or an interactive y/N
 * prompt, §3.2/§3.6), surfacing conflicts / unexpected commit counts via
 * `rebaseOutcome` rather than silently resolving them (§3.4/§3.5).
 *
 * Earlier chunks: MAG-46-10 implemented the first real `promote` action:
 * finding `spec/{ref}` resolved `ready` (via `resolveReady()`, called
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
 * MAG-49 (this chunk) closes the last remaining ready hop — the
 * `build::ready -> pr-raised` action named by the fallthrough comment below:
 * once local `build/{ref}` resolves `ready` (the build gate passes against
 * the local worktree's own commits, no push first), create `ready/{ref}`
 * from `build/{ref}`'s HEAD, push it, raise the Main Gate PR
 * (`ready/{ref}` -> `main`), and restore the starting branch. Modeled on
 * `quick::ready -> pr-raised` (its destination `main` always exists) plus
 * the one step neither template needs: creating `ready/{ref}` itself. A
 * pre-existing `origin/ready/{ref}` is either a safe-to-discard stale
 * attempt (deleted, then recreated fresh) or already-merged history
 * (refused cleanly — never silently overwritten). Trunk drift on the build
 * phase and a `blocked` build-phase gate need no new code: the generic
 * rebase-forward block and the generic blocked-relay branch (both below)
 * already cover `build` unchanged.
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

/** Reads a single line of confirmation input from `process.stdin` for the
 *  interactive y/N path (spec 14 §3.6) — mirrors `cli.ts`'s `readStdin()`
 *  technique (`data`/`end` events, read to completion) rather than
 *  introducing `readline` or any new primitive. This is CLI-layer I/O —
 *  reading a human's own confirmation off stdin is the same category as
 *  the messages `promote` already writes to stdout, NOT an
 *  `ExternalTools` member (spec 14 §2.1's correction). */
function readConfirmation(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
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

  // An open gate PR derives `awaiting-pr` — on the `test` phase for the
  // Build Gate PR (spec 11 §3.3) and on the `quick` phase for the quick
  // route's Main Gate PR (spec 11.01 §3.3). `promote` is a safe, idempotent
  // no-op here — the PR is already open, so neither the branch nor the PR is
  // (re)created; the existing PR's number is re-stated rather than a generic
  // "nothing to do". The PR pair consulted matches the derived phase's route.
  if (taskStatus.state === "awaiting-pr") {
    const messages = [
      `Current branch \`${currentBranch}\` - ref: ${ref}`,
      stateLine(ref, taskStatus.phase, taskStatus.state),
    ];
    const open =
      taskStatus.phase === "quick"
        ? await tools.github.findOpenPR("main", `task/${ref}`)
        : await tools.github.findOpenPR(`build/${ref}`, `test/${ref}`);
    if (open !== null) {
      messages.push(`PR #${open.number} is open for ${ref}: ${open.url}`);
    }
    return {
      success: true,
      action: "none",
      messages,
    };
  }

  // The merged-pending-pull resolution (spec 14): the Build Gate PR
  // (`test/{ref}` -> `build/{ref}`) has merged and local `build/{ref}`
  // doesn't yet reflect it (MAG-46-12's derivation). `promote` consumes
  // that derived state — it never re-checks `build/{ref}`'s ancestry
  // itself (§2.1) — and resolves it one of two ways, distinguished by
  // whether a local `build/{ref}` exists:
  //
  // §3.1 plain pull: no local `build/{ref}` — nothing pre-existing to
  // reorder. Fast-forward it locally (`pullFastForward` creates it from
  // origin when absent), no confirmation needed — non-destructive.
  //
  // §3.2/§3.6 cascading: local `build/{ref}` exists with pre-existing
  // build-phase commits. Pull AND rebase them onto the fresh merge
  // (`origin/build/{ref}`), then force-push — gated by `--confirm-rebase`
  // or an interactive y/N prompt (§3.6), exactly like every other rewrite
  // in this design. A missing confirmation in `--json` mode refuses with
  // no git action at all (§3.3).
  //
  // A rebase conflict (§3.4) or unexpected commit count (§3.5) is surfaced
  // via `rebaseOutcome`, never silently resolved — the pull half of the
  // action DID complete, so action stays "pulled-and-rebased"; only the
  // force-push is withheld.
  if (taskStatus.state === "merged-pending-pull") {
    const buildBranch = taskStatus.canonicalBranch as string;
    const ontoRef = `origin/${buildBranch}`;

    // Promote's own plain-vs-cascading decision: does a local build/{ref}
    // exist with pre-existing build commits to reorder? (The derived state
    // covers both sub-cases — no local branch, or local behind origin — so
    // the existence check is what distinguishes them.)
    const localBuildExists = await tools.git.branchExists(buildBranch, { remote: false });

    if (!localBuildExists) {
      // §3.1: plain pull — non-destructive, no confirmation required.
      await tools.git.pullFastForward(buildBranch);
      return {
        success: true,
        action: "pulled",
        messages: [
          `Current branch \`${currentBranch}\` - ref: ${ref}`,
          `Pulled \`${buildBranch}\` to match \`${ontoRef}\` (merged Build Gate PR)`,
        ],
      };
    }

    // Cascading case: pull + rebase, gated by confirmation.
    const confirmed = args["confirm-rebase"] === true;
    if (!confirmed) {
      if (args["json"] === true) {
        // §3.3: refuse cleanly — no git action at all, name the flag.
        return {
          success: false,
          action: "none",
          messages: [
            `Current branch \`${currentBranch}\` - ref: ${ref}`,
            `Promoting ${ref}::${taskStatus.phase}::${taskStatus.state} requires a rebase: \`${buildBranch}\` has pre-existing build commits that must be rebased onto the merged Build Gate content`,
            `This is a force-pushed branch rewrite - confirm with --confirm-rebase to proceed`,
            `No action taken`,
          ],
        };
      }
      // §3.6: interactive y/N prompt — shown before any rebase/push is
      // attempted, answer read off process.stdin (CLI-layer I/O, spec 14
      // §2.1's correction — not an ExternalTools member).
      process.stdout.write(`Rebase \`${buildBranch}\` onto \`${ontoRef}\`? [y/N] `);
      const answer = await readConfirmation();
      if (answer.trim().toLowerCase() !== "y") {
        return {
          success: false,
          action: "none",
          messages: [
            `Current branch \`${currentBranch}\` - ref: ${ref}`,
            `Confirmation declined - no action taken`,
          ],
        };
      }
    }

    await tools.git.pullFastForward(buildBranch);

    // A plain fast-forward may have left nothing to reorder: the real-world
    // "local build/{ref} merely trails origin" case (a checked-out branch
    // always exists, so branchExists above can't distinguish it from the
    // genuinely-diverted case — spec 10's branchMismatch guard forces the
    // caller onto build/{ref}). If the pull already caught the branch up to
    // the merged content, report the non-destructive `pulled` outcome rather
    // than sending a zero-commit branch into `rebase` (whose commit-count
    // precondition would fail with a misleading `unexpected-commit-count`).
    if ((await tools.git.headSha(buildBranch)) === (await tools.git.headSha(ontoRef))) {
      return {
        success: true,
        action: "pulled",
        messages: [
          `Current branch \`${currentBranch}\` - ref: ${ref}`,
          `Pulled \`${buildBranch}\` to match \`${ontoRef}\` (merged Build Gate PR)`,
        ],
      };
    }

    const outcome = await tools.git.rebase(buildBranch, ontoRef);

    if (outcome.status === "ok") {
      await tools.git.push(buildBranch, { force: true });
      return {
        success: true,
        action: "pulled-and-rebased",
        rebaseOutcome: outcome,
        messages: [
          `Current branch \`${currentBranch}\` - ref: ${ref}`,
          `Pulled \`${buildBranch}\` and rebased its build commit onto \`${ontoRef}\`, force-pushed`,
        ],
      };
    }

    if (outcome.status === "conflict") {
      // The conflict is surfaced, never auto-resolved: the newly-merged
      // test content takes precedence and the agent must adjust their
      // build WIP to match it. No force-push of a conflicted rewrite.
      return {
        success: false,
        action: "pulled-and-rebased",
        rebaseOutcome: outcome,
        messages: [
          `Current branch \`${currentBranch}\` - ref: ${ref}`,
          `Rebase of \`${buildBranch}\` onto \`${ontoRef}\` hit a conflict`,
          `${outcome.details}`,
          `The newly-merged test content takes precedence - adjust your build WIP to match it`,
        ],
      };
    }

    // unexpected-commit-count: the pull half completed; only the rebase
    // half failed, surfaced via rebaseOutcome — not a reversion to
    // "pulled" or "none" (§3.5's explicit Then clause).
    return {
      success: false,
      action: "pulled-and-rebased",
      rebaseOutcome: outcome,
      messages: [
        `Current branch \`${currentBranch}\` - ref: ${ref}`,
        `Cannot rebase \`${buildBranch}\` onto \`${ontoRef}\`: it has ${outcome.actual} commits of its own, expected ${outcome.expected}`,
        `Please squash \`${buildBranch}\` to a single commit before promoting`,
      ],
    };
  }

  // The merged-pending-cleanup resolution (spec 15): the Main Gate PR
  // (`main` <- `ready/{ref}` regular route, `main` <- `task/{ref}` quick
  // route) is confirmed merged and local `main` hasn't caught up yet — or
  // an interrupted prior cleanup left a surviving branch already an
  // ancestor of local `main` (the §3.2 retrigger, which converges on this
  // identical derived state). Nothing is at risk once the merge is
  // confirmed, so NO `--confirm-rebase` flag and no prompt of any kind
  // gates this action (§3.3 — explicitly unlike MAG-46-14's cascading
  // rewrite). LLD §3.6's sequence: checkout `main` first, then update
  // local `main` to match `origin/main` (`pullFastForward`), then delete
  // every phase branch the route created — locally and on `origin` via
  // `deleteBranch`, which tolerates an already-absent branch as a no-op
  // (§3.4 — the re-run of a partially-finished cleanup). Afterward the ref
  // reports `not-initialised` again (§3.5).
  //
  // Regular-route cleanup includes `ready/{ref}` (MAG-46, post-close-out
  // fix): the branch list here predates the `build/{ref}` -> `main/{ref}`
  // -> `ready/{ref}` rename (`task-MAG-40.md`) — `ready/{ref}` is the
  // Main Gate PR's actual head, transient by design, and was never being
  // deleted, requiring a manual `git push origin --delete` every cycle.
  if (taskStatus.state === "merged-pending-cleanup") {
    if (await tools.git.isDirty()) {
      // The worktree is the one thing cleanup cannot proceed past: the
      // checkout/pullFastForward below would carry uncommitted changes
      // across a branch switch. Refuse cleanly — no git action at all.
      return {
        success: false,
        action: "none",
        messages: [
          `Current branch \`${currentBranch}\` - ref: ${ref}`,
          `Cannot clean up ${ref}: the worktree is dirty - commit or stash your changes first`,
          `No action taken`,
        ],
      };
    }
    const branchesToDelete =
      taskStatus.phase === "quick"
        ? [`task/${ref}`]
        : [`spec/${ref}`, `test/${ref}`, `build/${ref}`, `ready/${ref}`];
    await tools.git.checkout("main");
    await tools.git.pullFastForward("main");
    for (const branch of branchesToDelete) {
      await tools.git.deleteBranch(branch);
    }
    return {
      success: true,
      action: "cleaned-up",
      branchesDeleted: branchesToDelete,
      messages: [
        `Current branch \`${currentBranch}\` - ref: ${ref}`,
        stateLine(ref, taskStatus.phase, taskStatus.state),
        `Main Gate PR merged - cleaning up phase branches`,
        ...branchesToDelete.map((branch) => `  - Deleted \`${branch}\``),
      ],
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

  // The quick::ready -> pr-raised action (spec 11.01 §3.1): raise the Main
  // Gate PR directly against `main` (`task/{ref}` -> `main`). Unlike the
  // test-phase route there is NO branch-publish step first — the base
  // `main` always exists, so no `git.createRemoteBranch`/`createBranch`/
  // `checkout` are touched (§2.1); the publish step exists in the test-phase
  // route only because nothing in the workflow creates `build/{ref}`.
  if (taskStatus.state === "ready" && taskStatus.phase === "quick") {
    const headBranch = `task/${ref}`;
    await tools.git.branchExists(headBranch, { remote: true });
    const pr = await tools.github.createPR("main", headBranch, {
      title: `Task ${ref}: promote ${ref}::quick::ready to main (Main Gate)`,
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

  // The build::ready -> pr-raised action (task-MAG-49, §3.1/§3.5/§3.6):
  // raise the Main Gate PR (`ready/{ref}` -> `main`) once local
  // `build/{ref}` resolves `ready` (the build gate passes against the local
  // worktree's own commits — no push required first, matching main-gate.ts's
  // existing local-`build/{ref}`-equals-`ready/{ref}` self-verification
  // design). Modeled on quick::ready -> pr-raised (the destination `main`
  // always exists, so there is no branch-publish step) plus one step neither
  // template needs: create `ready/{ref}` from `build/{ref}`'s current HEAD
  // before pushing — carrying the actual accumulated build commits, not an
  // empty branch off `origin/main`.
  //
  // A pre-existing `origin/ready/{ref}` needs one safety check before being
  // touched: `isAncestor("origin/ready/{ref}", "origin/main")`. If true —
  // its content is already part of `main`'s history — touching it would
  // clobber merged history, so refuse cleanly (success false, action none,
  // no git mutation, §3.6). If false — a stale, unmerged leftover (the old
  // raw-`git` workflow or an interrupted `promote` attempt) — discard it
  // with `deleteBranch` first, then proceed through the normal happy path
  // unchanged; deleting also auto-closes any stale open PR against the old
  // branch on GitHub, so the subsequent `createPR` never collides with a
  // leftover PR (§3.5). When `origin/ready/{ref}` doesn't exist at all, the
  // check is skipped entirely.
  if (taskStatus.state === "ready" && taskStatus.phase === "build") {
    const buildBranch = taskStatus.canonicalBranch as string;
    const readyBranch = `ready/${ref}`;
    if (await tools.git.branchExists(readyBranch, { remote: true })) {
      if (await tools.git.isAncestor(`origin/${readyBranch}`, "origin/main")) {
        return {
          success: false,
          action: "none",
          messages: [
            `Current branch \`${currentBranch}\` - ref: ${ref}`,
            `Cannot promote: \`${readyBranch}\` already exists and is already merged into \`main\``,
            `No action taken`,
          ],
        };
      }
      await tools.git.deleteBranch(readyBranch);
    }
    await tools.git.createBranch(readyBranch, buildBranch);
    await tools.git.push(readyBranch);
    const pr = await tools.github.createPR("main", readyBranch, {
      title: `Task ${ref}: promote ${ref}::build::ready to main (Main Gate)`,
    });
    // createBranch checks the new branch out (`git checkout -b`), so the
    // caller's starting branch is explicitly restored afterward (§3.2).
    await tools.git.checkout(buildBranch);
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