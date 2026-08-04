# Tool Up Task Phasing

Now that we have gate checks in place, the developer (agent) is forced into a system-level TDD straitjacket. However, conforming to the rules of the ways of working requires consistent use of git branches and change propagation.

The phase gate checks can be run locally, so the developer can check whether they are in line with the requirements and what to do to resolve them. What is needed is a `pnpm` tool to monitor and manage the migration of commits through the spec → test → build → deploy phases.

It should:

* Allow the developer to review the task they are working on, the phase it is at, what its status is within the phase [not started | work in progress (WIP) | ready], whether it is ready to move to the next phase and if not why not, in a single command.
* Support the developer to start a phase. e.g. check out the right branch to start the phase.
* Support the developer to complete a phase, e.g. raising PRs and pushing changes.
* List the tasks in progress by querying the git branches and the state of the work tree.

## Design Documents

The full design for this task lives in the `magpieweaver-docs` repo, under
`docs/setup/dev-env/task-phasing/`:

- [`task-phasing-lld.md`](../../../../magpieweaver-docs/docs/setup/dev-env/task-phasing/task-phasing-lld.md)
  — the Low Level Design for the whole task-phasing system: the phase
  model, the `TaskState`/`PhaseState` shapes, and the command set. This is
  the source design that every spec chunk (00 through 18) implements a
  piece of.
- [`task-MAG-46-dev-testing-cli-design.md`](../../../../magpieweaver-docs/docs/setup/dev-env/task-phasing/task-MAG-46-dev-testing-cli-design.md)
  — the `--dev-testing <tool> <method>` CLI grammar and execution
  semantics used to drive `git`/`gh`/`fs`/`gate-check` in system tests.
- [`task-MAG-46-system-behaviours.md`](../../../../magpieweaver-docs/docs/setup/dev-env/task-phasing/task-MAG-46-system-behaviours.md)
  — the catalogue of every required system-level behavior, derived from
  the LLD, organized for human review rather than for driving TDD.
- [`task-MAG-46-test-file-layout-design.md`](../../../../magpieweaver-docs/docs/setup/dev-env/task-phasing/task-MAG-46-test-file-layout-design.md)
  — how system tests for this task are laid out on disk and named.

The backlog is broken into numbered spec chunks (`task-MAG-46-00-...`
through `task-MAG-46-18-...`, plus `10.01`/`11.01`), each with its own
Given/When/Then spec doc in the same `task-phasing` directory. Those
per-chunk specs are the authoritative, up-to-date implementation contract
for each chunk — this document and the four design docs above give the
overall shape; they don't get re-derived here.

## Progress

**Spec 00 (scaffolding) is done** — merged to `main` via
[PR #33](https://github.com/weaver-engineering/magpie-weaver/pull/33) on
the `quick` route (`task/MAG-46` -> `main`, no test-gate). It scaffolded
`packages/task-phases/` (`cli.ts`, `registry.ts`, `types.ts`,
`commands/*.ts`, `deps/*.ts`, empty `lib/`), froze the
`ExternalTools`/`FunctionCatalog` shapes, and built the `--dev-testing`
argv-parsing/dispatch path. Every command handler and every `deps/*.ts`
tool method was a placeholder throwing `"not implemented"`.

**Spec 01 (`--dev-testing git` real-world execution) is done** — full
spec -> test -> build cycle, merged via
[PR #37](https://github.com/weaver-engineering/magpie-weaver/pull/37).
Implemented the `GitTool` subset spec 01 exercised: `fetch`,
`currentBranch`, `branchExists`, `headSha`, `createBranch`, `checkout`,
`commitAll`, `push` — a thin wrapper over `simple-git`, `cwd`-resolved.

**Spec 02 (`--dev-testing fs` real-world execution) is done** — full
cycle, merged via
[PR #39](https://github.com/weaver-engineering/magpie-weaver/pull/39).
Implemented `FileSystemTool` (`loadConfig`, `exists`, `readFile`,
`writeFile`, `copyFile`, `mkdir`, `readDir`) over Node's `fs`/`fs/
promises` builtins. `loadConfig`'s walk-up is **not bounded to the repo
root** (corrected mid-cycle — a config file can legitimately live above
the repo).

**Spec 03 (`--dev-testing gh` real-world execution) is done** — full
cycle, merged via
[PR #42](https://github.com/weaver-engineering/magpie-weaver/pull/42).
Implemented `GitHubTool` (`createPR`, `findMergedPRs`, `findMergedPR`,
`findOpenPR`) as a thin wrapper over the `gh` CLI. Merge-detection tests
run against permanent fixture branches on a dedicated sandbox repo
(`weaver-engineering/sandbox-task-phases-DO-NOT-DELETE` — see its
README) rather than merging PRs live, since `gh pr merge` is a
deliberately withheld agent permission.

**Spec 04 (`task status` reports `not-initialised`) is done** — full
cycle, merged via
[PR #45](https://github.com/weaver-engineering/magpie-weaver/pull/45).
First *command-level* chunk (`run(argv, mockTools)` in-process, no real
git/gh/fs calls) — implemented the base case of the §3.2 status
derivation pipeline: no phase branch of any kind for a ref (local or
remote) means `not-initialised`. Every other branch of the pipeline still
throws `"not implemented"`.

**Spec 05 (`task init` creates spec/quick branches) is done** — full
cycle, merged via
[PR #47](https://github.com/weaver-engineering/magpie-weaver/pull/47)
(test) and [PR #48](https://github.com/weaver-engineering/magpie-weaver/pull/48)
(build). Implemented the happy path for both branch-creation routes off
`main`, scaffolding `docs/tasks/{ref}/task-{ref}.md` from a template.
Manually exercising the merged build against real git state surfaced a
genuine backlog gap: `RealGitTool` still stubbed 5 methods (`isDirty`,
`hasCommitsBeyond`, `headCommitTitle`, `pullFastForward`, `deleteBranch`)
that `init` depends on directly, and that `wip`/`promote`/`switch`
(MAG-46-07/10/14/15/17) also call — but every one of those chunks tests
only against mocked `git`, and no chunk in the documented backlog (00
through 18) gave any of these 5 methods real-world coverage. Addressed
immediately as MAG-46-05.01 rather than deferred.

**Spec 05.01 (real `isDirty`/`hasCommitsBeyond`/`headCommitTitle`/
`pullFastForward`/`deleteBranch`) is done** — full cycle, merged via
[PR #49](https://github.com/weaver-engineering/magpie-weaver/pull/49)
(test) and [PR #51](https://github.com/weaver-engineering/magpie-weaver/pull/51)
(build, squash-merged). `RealGitTool` now covers all methods `init` needs;
confirmed end-to-end with a real, disposable `pnpm task init` run against
the primary worktree. One process gap surfaced along the way: the
`build/{ref}`/`test/{ref}` clear-down step after a Main Gate merge was
missed once, leaving a stale `build/MAG-46` that produced a spurious
merge conflict on the next chunk's Build Gate PR — see memory
`feedback_clear_down_stale_phase_branches` for the recipe now being
followed each cycle. A separate `git merge --ff-only*` permission gap
(build-implementer resuming after this PR merged) was fixed via
`task/MAG-40` ([PR #50](https://github.com/weaver-engineering/magpie-weaver/pull/50),
left open in case more surface before closing it out).

**Spec 06 (`task status` derives `not-started`/`work-in-progress`) test
phase is done** — merged via
[PR #52](https://github.com/weaver-engineering/magpie-weaver/pull/52).
Build phase (PR #53) review surfaced a real gap: `build-implementer` had
written a check (`assertNoGatePR`) to defer `status` when a gate PR
exists for `{ref}` — recognising, correctly, that MAG-46-06's own tests
never required it, since their Given clauses only ever set
`findMergedPR`/`findOpenPR` to return `null` as a precondition, never as
a scenario of their own — but never wired the function into `status()`.
Dead code, confirmed via coverage (`assertNoGatePR` at 0 invocations
despite `main-gate` reporting 100% new-line coverage — a gate-checks
coverage-computation gap worth a separate look later). Left unwired, this
is a real regression: before MAG-46-06, any existing phase branch
deferred unconditionally; now the no-PR case gets a real answer, but so
does the PR-exists case, silently overstepping into MAG-46-09/11/12/15's
territory. Not patched quietly in the build PR — the fix belongs to a
proper test-driven chunk (MAG-46-06.01) instead of retroactively
strengthening an already-merged test commit.

**Spec 06.01 (`status` defers when a gate PR exists) is done** — full
cycle, merged via [PR #58](https://github.com/weaver-engineering/magpie-weaver/pull/58)
(test) and [PR #64](https://github.com/weaver-engineering/magpie-weaver/pull/64)
(build). Landed on the `ready/{ref}` architecture (`main/{ref}` — the
name originally chosen when `build/{ref}` was branch-protected — turned
out to be structurally impossible: git can't create a branch named
`main/anything` while `main` itself exists as a branch; see `task/MAG-30`
for the rename).

**Spec 06.01's own test corrected for the open-Build-Gate-PR case** —
quick-route commit (`task/MAG-46`), landed ahead of MAG-46-11's own test
phase, which is what actually surfaced it: MAG-46-11's required behavior
(`status`/`promote` deriving real `awaiting-pr` for an open Build Gate
PR) directly contradicted `defers-when-gate-pr-exists.test.ts` §3.2
(same exact scenario, asserting the opposite — deferral). Not a spec
mistake; `assertNoGatePR`'s own comment always said this case was
temporary, owned by a later chunk. Removed §3.2 rather than rewriting it
in place — the correct behavior is MAG-46-11's own test-phase work
(`status/awaiting-pr.test.ts`, per its test-file-layout note), not
something to preempt here. §3.1/§3.3/§3.4 (merged Build Gate PR, both
Main Gate PR cases) are untouched, still correctly deferred, still owned
by MAG-46-12/15. Landed via the quick route specifically because
`main-gate`'s task/{ref} path has no `validate-test-commit`-style
"existing tests unchanged" check (confirmed by reading
`validate-task-commit.ts` before choosing this route) — no architect
override needed, unlike the spec-06/09 contradiction earlier, which hit
that check directly on the build route.

**`pnpm task init` now commits and pushes the doc it scaffolds** —
quick-route commit (`task/MAG-46`, no ticket of its own — a tooling fix
to `task-phases` itself, dog-fooding the CLI for the first time revealed
`init` stopped short of committing/pushing what it wrote). By the time
`init` runs, the design workflow that produced the doc is already
finished, so queuing it up is purely mechanical. Required updating one
assertion in the existing chunk-05 test file (`commitAll` was previously
asserted never-called) — done directly here rather than via test-writer,
which is categorically barred from editing existing test files; that
restriction exists to stop an agent silently patching around a test it
broke by accident, not to block a deliberate, documented revision to an
earlier chunk's contract.

**`lib/repo-state.ts` and `lib/task-doc.ts` now exist** — quick-route
commit (`task/MAG-46`), a pure move with no behavior change (all 67
existing task-phases tests pass unmodified). LLD §1.2/§4.5/§4.6 designate
`lib/` as reused logic across commands, but it sat empty through two full
spec/test/build cycles: MAG-46-05 (`init`) and MAG-46-06/06.01 (`status`)
each implemented their own private version of exactly the logic the LLD
already calls out as shared — `status.ts`'s `anyPhaseBranchExists`/
`derivePhase`/`deriveState`/`assertNoGatePR` is `lib/repo-state.ts` §4.5's
pipeline verbatim; `init.ts`'s template-scaffolding helpers are
`lib/task-doc.ts` §4.6. Caught only once the `init` commit-and-push
change above made the duplication concrete enough to notice, not by
review of either prior chunk and not by any test. `status.ts` now calls
`deriveRepoState()`; `init.ts` now calls `scaffoldTaskDoc()`. See the
`task-phasing-lib-extraction-gap` note on the docs repo's `obsidian`
branch for the fuller retrospective — this is the first full run through
the design → spec → implement cycle for this tool, and the gap points at
a real process weakness (spec docs don't currently carry LLD-level
structural detail down to the agent) worth fixing before more chunks
land, not just this one instance of it.

**`init`'s commit+push is now gated behind `--commit`** — quick-route
commit (`task/MAG-46`). It was unconditional (PR #65); about to actually
use `init` for real to raise spec 07 surfaced the difference between
"queuing the doc up is purely mechanical" (still true) and "always
pushing to a shared remote with no chance to look first" (not something
that follows from the first). `InitCommandResult` gained a `committed:
boolean` field so `--json` callers can tell which happened. Every prior
chunk's spec commit (00 through 06.01) was still raised by hand, copying
the spec doc directly onto `spec/MAG-46` — `init` was never actually used
for one until now.

**`spec/MAG-46` deleted and will be recreated per chunk going forward** —
it was never cleared down after a chunk's Main Gate merge, unlike
`test`/`build`/`ready/{ref}`, so it had drifted stale (missing every
MAG-30/40 fix merged since 06.01 landed) and — more importantly — its
mere existence is *why* `init MAG-46` refused outright ("Branch
`spec/MAG-46` already exists"; the existing-branch-reuse decision tree is
MAG-46-18's, not built yet). Its full content was already squashed into
`main` through every chunk's Main Gate PR, so deleting it lost nothing.
Same treatment as `test`/`build`/`ready/{ref}` from here on: gone right
after each chunk merges, letting `init` create it fresh for the next one
instead of needing a manual branch check first.

**`init` no longer overwrites an existing task doc** — real bug, found
immediately on the very first real `init MAG-46` run once `spec/MAG-46`
was actually clear: `scaffoldTaskDoc()` wrote the blank template
unconditionally, with no check for whether the doc already existed. It
silently replaced this file's entire 200+-line history (every prior
chunk's progress notes) with the 30-line blank template — caught only
because `--commit` wasn't given yet, so nothing was pushed; `git checkout
--` recovered it. This was always a gap in spec 05's original
implementation, not something introduced by the `spec/{ref}` clear-down
above — the LLD's own §3.8 pseudocode already conditions the
template-scaffold step on "and the task doc does not exist," which was
simply never implemented. It never surfaced before because every real
`init` call to date was for a genuinely new ref. `scaffoldTaskDoc()` now
checks first and leaves an existing doc untouched, reporting `written:
false`; `init` skips `--commit` entirely when nothing was written, rather
than attempting an empty commit.

## Current Scope: spec 11.01

**Working spec doc:**
`task-MAG-46-11-01-promote-quick-route-pr-raised-spec.md`, authored in
`magpieweaver-docs` (`docs/setup/dev-env/task-phasing/`), not yet copied
into this repo's `docs/tasks/task-MAG-46/` — that copy is the spec-phase
commit itself, still to be raised on a freshly-recreated `spec/MAG-46`.
Closes a gap MAG-46-11 explicitly left open: that chunk only covered the
`test`-phase PR-raise (`test/{ref}` → `build/{ref}`); the quick route's
own `promote`-to-PR action (`task/{ref}` → `main` directly, LLD §3.7's
gate table) had no spec at all until this chunk. Extends the same
`deriveRepoState()` awaiting-pr resolution MAG-46-11 added — one
derivation function covering all routes — with the `main`/`task/{ref}`
open-PR pair: `quick::ready` → `promote` raises the Main Gate PR directly
(no branch-publish step first, unlike the test-phase route — `main`
always exists already); once open, `status`/`promote` report `phase:
"quick", state: "awaiting-pr"`; a repeated `promote` call is the same
idempotent no-op as MAG-46-11's. `quick::blocked` relays `main-gate`'s
violations, same shape as every other blocked case.

**Pre-handoff spec review:**

- **Shim-dependency check:** the quick-route `pr-raised` action needs
  only `github.createPR`/`findOpenPR`/`findMergedPR` (all real) — no new
  `git.*` primitive, since (unlike `build/{ref}`) `main` never needs
  publishing first. Clean, no tier decision needed.
- **Existing-test contradiction check found a real hit** — the second
  time this specific check has caught something, after spec 11's own
  §3.2 case: `test/packages/task-phases/status/defers-when-gate-pr-exists.test.ts`
  §3.4 ("defers when the Main Gate PR (quick route) is open") asserted an
  open `main`/`task/{ref}` PR still produces `"not implemented"` —
  directly contradicting this chunk's required §3.4 behavior (real
  `awaiting-pr`). Same root cause as spec 11's §3.2 hit: `assertNoGatePR`'s
  replacement was always going to land in stages, and this test predated
  the stage that covers it. **Fixed via the quick route** (`task/MAG-46`):
  retired the §3.4 case with a correction note (same treatment as §3.2),
  removed the now-unused `openPR()` test helper, renumbered the file's
  System-behaviors comment. §3.1/§3.3 (the two merged-PR pairs) are
  untouched, still correctly deferred, still owned by MAG-46-12/15. All
  102 remaining task-phases tests pass; real coverage for this case moves
  to a new `status/awaiting-pr-quick-route.test.ts` (see the file-layout
  correction below — not `status/awaiting-pr.test.ts` as first assumed
  here).

**`spec/MAG-46` recreated, spec-phase commit raised** (`1766242`), and
`test-writer` started headlessly on `test/MAG-46`
(`ses_031f6cad1ffeLoMMvV5W0DpoVW`, `agent_1`). It self-derived the
correct state despite `agent_1`'s worktree still sitting on the now-gone
`ready/MAG-46` from spec 11's build session — fetched, forked
`test/MAG-46` off `spec/MAG-46` itself, no intervention needed for that
part.

**A third pre-handoff-review miss, this time caught by `test-writer`
itself rather than the architect:** `task-MAG-46-test-file-layout-design.md`'s
§4 table had MAG-46-11.01 §3.4 (the quick-route `status` case) *"adding a
case to the existing `status/awaiting-pr.test.ts`"*, citing §5 (a spec
doc gaining sections within *itself* later, e.g. MAG-46-06's own
§3.5–3.7 growth). Wrong citation: MAG-46-11.01 is a distinct, later spec
doc that merely shares MAG-46-11's territory — an ordinary §4
split-by-command new-file case, exactly like its own §3.1–3.3 row
directly above, which already correctly named a new file. `test-writer`
caught it at session start, before writing anything: the "existing file"
directive is incompatible with both `build-gate`'s `validate-test-commit`
check and every agent's own standing mandate against editing existing
test files — a conflict invisible until a *second* chunk's tests target
a file a *prior, already-merged* chunk created, which the original table
row never considered. Reported `needs-architect-intervention` cleanly,
no uncommitted work. Fixed in `magpieweaver-docs` (both the layout
doc's table + a correction note, and the working spec doc's own "Test
file" header) — new file `status/awaiting-pr-quick-route.test.ts`, same
treatment as the sibling row. **`spec/MAG-46` itself was deliberately
left unamended**: `test/MAG-46` had already forked from it, and rewriting
`spec/MAG-46`'s single commit would flip the ancestry-staleness check
(`derivePhase`'s `isAncestor` guard), routing `promote` into the
rebase-forward path and the known-broken `rebase()` stub (MAG-46-13's
deferred tier-1 gap, confirmed broken via e2e testing after spec 10.01) —
the fix was relayed to the live `test-writer` session directly instead.
Adds a fourth instance to the growing "pre-handoff review gap" list
(spec 09, spec 11's own §3.2, this chunk's §3.4-deferral case, now this)
— worth its own line on the pre-handoff checklist in
`sequenced-spec-supervision-CLAUDE.md`: cross-check a spec's named test
file against every already-merged chunk's own file-layout row, not just
its behavioral assertions.

**Test phase done** — merged via
[PR #101](https://github.com/weaver-engineering/magpie-weaver/pull/101)
(`test/MAG-46` → `build/MAG-46`), including a one-line review fix (a
dead ternary in `quick-route-pr-raised.test.ts`'s `branchExists` mock —
both branches returned `true`) relayed to the live session and amended
in before merge.

**Build phase implemented, [PR #103](https://github.com/weaver-engineering/magpie-weaver/pull/103) raised, not yet merged.**
`build-implementer` self-resolved a real, previously-undocumented gap
along the way: `main-gate`'s "destination branch has advanced past the
merge base" check fired for the first time in this backlog (`origin/main`
had moved via PR #100's task-doc commit after `build/MAG-46` forked from
it) — nothing in the standing instructions covers Main-Gate-PR-time trunk
drift, only `build/{ref}`-drift (§2, step 5/6). It correctly diagnosed
and rebased `ready/MAG-46` onto current `origin/main` unprompted, keeping
the 3-commit structure intact. Architect review of the build commit found
one genuinely unrequested piece of scope: a `branchExists` precondition
check on the quick route's PR-raise action, with a failure-return branch
neither the spec nor the test-phase route's own precedent asked for —
the sole cause of new-line coverage sitting at exactly 90% against a
strict `>90%` threshold. Relayed directly; `build-implementer` improved
on the instruction given — the immutable test (`pr-raised.test.ts` §3.1)
turned out to genuinely require the bare `branchExists` call itself (not
inherited for free from the derivation pipeline, as first assumed), just
not the dead branch around it. Kept the call, removed only the branch;
coverage cleared to 100%.

**Known debt:** the surviving `branchExists(headBranch, { remote: true })`
call in `promote.ts`'s quick-route `pr-raised` action
(`commands/promote.ts`, inside the `phase === "quick"` block) is now
functionally inert in production — its result is discarded, nothing
branches on it — kept solely because `pr-raised.test.ts` §3.1 asserts
the call happened. Not worth reopening an already-merged, gate-passed
test PR to relax one assertion for a single harmless read-only git call.
Revisit if `promote/quick-route-pr-raised.test.ts` is ever touched again
for an unrelated reason.

**Confirmed via real e2e testing, ahead of PR #103's merge** (per the
standing discipline — mocked-green is necessary, not sufficient; both
`isAncestor` and `rebase()` shipped through fully-green mocked suites
before failing for real): built the CLI directly off `ready/MAG-46` in a
throwaway worktree, then ran it — via absolute path, from a *second*
worktree checked out on a real, disposable `task/ZZZZ-971` branch off
`main` — against real git and real GitHub, not mocks. One setup mistake
caught along the way: running `main-gate` (which rebuilds as part of its
own `build` check) from the *same* worktree after switching it to
`task/ZZZZ-971` silently clobbered the freshly-built `ready/MAG-46` CLI
with `origin/main`'s old one — hence the two-worktree split, one pinned
purely as the build artifact, the other purely as the git state under
test.

- `promote` on `quick::ready` genuinely opened
  [PR #105](https://github.com/weaver-engineering/magpie-weaver/pull/105)
  (`task/ZZZZ-971` → `main`) — confirmed independently via `gh pr view`,
  not just the tool's own claimed output.
- `status --ref ZZZZ-971` correctly derived `phase: "quick", state:
  "awaiting-pr"` afterward.
- A repeated `promote` call was genuinely idempotent: `action: "none"`,
  re-stated PR #105, and `gh pr list --head task/ZZZZ-971` confirmed no
  second PR was ever created.

Disposable ref fully cleaned up afterward: PR #105 closed unmerged,
`task/ZZZZ-971` deleted (local and remote), both scratch worktrees
removed. `quick::blocked` (§3.2) wasn't separately e2e'd — pure read +
relay, no new git/gh interaction beyond what §3.1/§3.3 already exercised
for real.

## Previous scope: spec 11 (done)

**Merged via [PR #95](https://github.com/weaver-engineering/magpie-weaver/pull/95)**
(spec+test+build bundled on `ready/MAG-46`, per the established pattern).

**Working spec doc:**
`task-MAG-46-11-status-awaiting-pr-and-promote-pr-raised-spec.md` (copied
alongside this file). Replaces `lib/repo-state.ts`'s `assertNoGatePR()`
(currently an unconditional `"not implemented"` throw the moment any gate
PR exists) with real derivation for the Build Gate PR pair specifically:
`test::ready` → `promote` creates `build/{ref}` from `origin/main` when
absent, then raises the PR (`action: "pr-raised"`); once open,
`status`/`promote` report `phase: "test", state: "awaiting-pr"`, and a
repeated `promote` call is a safe, idempotent no-op. The Main-Gate-PR
pairs stay deferred to MAG-46-12/15, unchanged.

**Pre-handoff spec review, this time explicitly including the
shim-dependency check agreed after spec 10.01's build** (per
`notes/sequenced-spec-supervision-CLAUDE.md`, magpieweaver-docs): traced
every `deps/*.ts` method this chunk's logic reaches at runtime.
`git.branchExists`/`git.push`/`github.findOpenPR`/`github.createPR` are
all real. `derivePhase()`'s own `isAncestor` staleness check still fires
whenever `test/{ref}` exists (unconditional, unaffected by this chunk),
and is already real. The `rebase`-trigger detection spec 10.01 added only
fires for `phase === "spec" | "quick"` — this chunk operates on `phase:
"test"`, so it's never reached. **No new dependency on a stubbed shim
method** — clean on this front, no tier decision needed.

Also re-checked spec 11's own corrections (made earlier, before 10.01
existed) against the current code: `assertNoGatePR` is unchanged and
still unconditionally throws, so the "replace this function" instruction
is still accurate; the new `rebase`-trigger logic doesn't interact with
the PR-aware short-circuit this chunk adds (a task with an open Build
Gate PR returns `awaiting-pr` before reaching the rebase-detection code
at all).

**Correction: "no further corrections needed" above was wrong** — the
shim-dependency check traced runtime *code* paths, not existing *test*
assertions, and missed a real, direct contradiction: this chunk's own
required behavior (real `awaiting-pr` for an open Build Gate PR) is the
exact scenario `defers-when-gate-pr-exists.test.ts` §3.2 already asserted
the opposite outcome for. `test-writer` caught it correctly at session
start — re-derived state, read the spec, found the conflict before
writing anything, reported `needs-architect-intervention` cleanly with no
uncommitted work. Fixed by retiring §3.2 (not rewriting it — the correct
behavior is this chunk's own `status/awaiting-pr.test.ts` to write),
landed via the quick route rather than an architect override, since
`main-gate`'s `task/{ref}` path has no existing-tests-unchanged check.
See the Progress section entry near spec 06.01 for the full detail; PR
#93.

This is now a named gap in the pre-handoff review process, not just this
one miss: checking whether a chunk's *code* touches a stubbed shim is a
different question from checking whether a chunk's *required behavior*
contradicts an existing test's specific assertion — spec 09's contradiction
earlier and this one are both instances of the second question, and
neither was caught by a systematic check, only by whoever happened to
read the right file. Worth adding as its own explicit item to the
pre-handoff checklist in `sequenced-spec-supervision-CLAUDE.md`
(magpieweaver-docs), not folded into the shim-dependency check.

**Phase branches cleared down after the Main Gate merge**: `test/MAG-46`,
`build/MAG-46`, `ready/MAG-46` deleted (remote and local), `spec/MAG-46`
deleted and will be recreated fresh from `main` for the next chunk, same
treatment as every prior cycle.

**Quick-route follow-up, merged via
[PR #97](https://github.com/weaver-engineering/magpie-weaver/pull/97)
(`task/MAG-46`, reset fresh from `main` first — its one prior unmerged
commit turned out content-identical to what PR #93 had already squashed
in, so nothing was lost resetting it):**

- **`git.interface.ts` folded in, file deleted.** PR #95's build commit
  added `createRemoteBranch` directly to `GitTool`/`RealGitTool` in
  `git.ts`, exactly as the pinned standalone interface (Finding 2,
  `design-workflow-findings.md`) required — but left the now-redundant
  pinned file in place instead of deleting it, and two doc comments
  (`git.ts`, `promote/pr-raised.test.ts`) still pointed at it as a live
  source of truth. Deleted the file, confirmed nothing else references
  `GitToolBranchCreation`, reworded both comments. All 103 task-phases
  tests pass; `tsc` build clean.
- **`"pnpm build*"` (no `-r`) permission added** to
  `build-implementer`/`test-writer`/`quick-scaffolder`, alongside the
  existing `"pnpm -r build*"`. Confirmed live gap from the MAG-40
  bootstrap session: `pnpm build` run at a fresh agent worktree's root
  (equivalent to `pnpm -r build` per the root `package.json` script, but
  a textually different invocation) didn't match the existing glob and
  needed a manual click-allow.

## Previous scope: spec 10.01 (done)

**Working spec doc:** `task-MAG-46-10-01-promote-rebase-forward-spec.md`.
The two plain rebase-forward triggers from LLD §3.5 that were missed
between spec 10 and MAG-46-14: spec amended under an already-forked
`test/{ref}`, and `origin/main` drifting ahead of `spec/{ref}`/
`task/{ref}`. Merged via
[PR #91](https://github.com/weaver-engineering/magpie-weaver/pull/91)
(test) and [PR #92](https://github.com/weaver-engineering/magpie-weaver/pull/92)
(build).

**Pre-handoff spec review found one real gap:** §3.1's rebase target
(`test/{ref}`) is a *different* branch from the caller's own
(`spec/{ref}`), and `rebase()`'s contract (`git rebase --onto <ontoRef>
<upstream> <branch>`) checks `<branch>` out as part of the operation,
same as `createBranch` does for spec 10's fork — reproducing spec 10's
exact worktree-exclusivity bug if left unfixed. Fixed the same way:
`promote` restores the caller's starting branch after `rebase()`
actually ran (§3.1 `ok`, §3.5 `conflict` — discovered mid-replay, after
the checkout already happened); §3.6 (`unexpected-commit-count`) needs no
restoration, since that precondition is a plain `rev-list --count`
checked *before* any checkout; §3.2/§3.3 need none either, since there
the branch being rebased already is the currently-checked-out one.

**Confirmed via real e2e testing after merge: `rebase()` crashes for
real**, same class of gap as spec 10's `isAncestor` — `RealGitTool.rebase`
is still a stub. Unlike `isAncestor`, this is genuinely tier-1 material
(per `notes/thin-shims-implement-wholesale.md`'s three-tier framework):
`rebase()` derives `upstream` via `mergeBase`, checks a commit-count
precondition, runs the actual `git rebase --onto`, and has real
conflict-handling semantics — complex enough to warrant durable automated
coverage, not a same-PR patch. **Confirmed this does not block spec 11**:
the rebase-trigger path only fires for `phase: "spec" | "quick"`; spec
11 operates on `phase: "test"` and never reaches it. Left MAG-46-13 in
its existing backlog position rather than pulling it forward — it will
bite the architect's own use of `promote --confirm-rebase` (the only
caller, since it's spec/quick-phase-only) until MAG-46-13 lands, not any
agent's own cycle.

## Previous scope: spec 10 (done)

**Working spec doc:** `task-MAG-46-10-promote-forked-spec.md`. The first
real `promote` behavior: finding `spec/{ref}` in state `ready` (resolved
via `resolveReady()`, unconditionally — no `--check`-style flag, unlike
`status`), `promote` creates `test/{ref}` off `spec/{ref}` and returns
the worktree to `spec/{ref}` (the branch-restoration invariant, LLD
§2.1). Finding `spec/{ref}` `blocked`, takes no git action and relays the
gate's own violations directly. Also lands the `branchMismatch` guard
(LLD §3.4) that gates every `promote` action from here on: refuses
outright when `currentBranch != canonicalBranch`. Merged via
[PR #88](https://github.com/weaver-engineering/magpie-weaver/pull/88)
(test) and [PR #89](https://github.com/weaver-engineering/magpie-weaver/pull/89)
(build).

**Pre-handoff spec review went through two passes before this reached
test-writer.** First pass (magpieweaver-docs#79): the spec's own
Deliverable Notes directed calling `tools.gateChecks.run` directly to
resolve `ready?`, duplicating logic `resolveReady()` (MAG-46-09) already
owns — corrected. That pass also changed §3.1's post-fork state from
`not-started` to `ready?`, reasoning that `test/{ref}` inherits
`spec/{ref}`'s commits so `hasCommitsBeyond` is `true` from creation —
**this was wrong, and is corrected in the second pass below.**

Second pass (magpieweaver-docs#80), prompted by checking the design
against the actual dev-machine setup (one clone, several linked
worktrees sharing a ref namespace) rather than the single-worktree model
the LLD assumed:

* **Phase state is derived against the phase's own parent branch, not
  against `main`.** `deriveState()` passing the literal `"main"` for
  every phase measures the *task's* total progress and reports it as the
  *phase's* state — which is exactly how the first pass arrived at
  `ready?`. A phase is `not-started` when it has no commit *of its own*:
  `spec`/`quick` derive against `origin/main`, `test` against
  `spec/{ref}`, `build` against `origin/build/{ref}`. §3.1 goes back to
  `not-started`, correctly this time — asserting the parent is
  `spec/AAA-123`, not `main`. Recorded as a general rule in LLD §3.2.
* **The fork must restore the starting branch.** `createBranch` is `git
  checkout -b`, and git allows a branch to be checked out in only one
  worktree at a time — an unrestored fork run by the architect on
  `spec/{ref}` leaves `test/{ref}` checked out in the architect's
  worktree, locking the agent out of it. `promote` now calls
  `checkout("spec/{ref}")` after creating `test/{ref}`. This is now a
  general invariant (LLD §2.1): a command leaves the worktree on the
  branch it found it on, except `<ref>`/`status --fix`, whose purpose is
  to switch. The resulting `branchMismatch: true` is the expected
  consequence, not a refusal condition.

Both corrected in place in the spec doc (§2.1/§3.1) and the LLD (§2.1,
§3.2), landed via magpieweaver-docs#80. Specs 10.01 and 11 also picked up
corrections in the same pass — `origin/main` instead of local `main` as
the drift reference (10.01), and `promote` creating `build/{ref}` from
`origin/main` when absent, which nothing earlier in the workflow does
(11) — recorded in their own docs, not repeated here since neither is
this chunk's scope.

**Build phase crashed on real e2e testing, mocked tests never caught
it.** `promote`'s merged build (PR #89 as first raised) passed all 92
mocked tests and CI cleanly, but crashed for real the moment it was run
end-to-end against a genuine ready spec branch: `promote`'s post-fork
re-derivation (§2.1's "surface the branchMismatch consequence" step)
calls `deriveRepoState()` a second time, which reaches
`RealGitTool.isAncestor` — a stub, deliberately deferred to MAG-46-13 —
the instant `test/{ref}` exists. My first suggested fix (skip the
re-derivation) was itself wrong and retracted before the agent acted on
it: `forked.test.ts` (already merged, immutable) explicitly asserts
`isAncestor` gets called. The real fix — implementing
`RealGitTool.isAncestor` for real, in `deps/git.ts`, via
`git merge-base --is-ancestor` — landed instead, ahead of MAG-46-13,
with the architect authorizing any coverage-gate friction in advance
(none was actually needed: `deps/*.ts` is excluded from coverage
measurement by an existing, documented policy — proof of correctness for
that file class is meant to come from `--dev-testing` tests, which don't
exist for `isAncestor` yet). Verified independently three ways before
merge: diff review, CI reproduced locally, and a second real disposable
ready-spec branch confirming no crash. See
`notes/thin-shims-implement-wholesale.md` (magpieweaver-docs) for the
general lesson this incident produced.

**Fifth real `pnpm task init MAG-46 --commit` run** — `spec/MAG-46`
(along with `test/build/ready/MAG-46`) was cleared down again once spec
10's full cycle (spec→test→build) merged to `main`, confirming the
clear-down-per-cycle practice holds for a fifth cycle in a row. Same
shape as specs 07/08/09/10's: `init` correctly left the already-existing
task doc untouched (`--commit` was a no-op as a result); the spec doc
itself was still copied in by hand (`--specs` remains MAG-46-18's).

**Phase ownership unchanged:** specification is architect-owned (this
chunk's spec commit is already done); test and build are for the agent.
The per-chunk spec doc is the authoritative implementation contract —
see "Design Documents" above; it isn't re-derived here.

**This document should be updated each time work moves on to a new spec
chunk**, so it always states which chunk is currently in hand rather than
listing the whole backlog as in progress at once.

## Metadata
- URL: [https://linear.app/simonemmott/issue/MAG-46/tool-up-task-phasing](https://linear.app/simonemmott/issue/MAG-46/tool-up-task-phasing)
- Identifier: MAG-46
- Status: 6 - In Progress
- Priority: No priority
- Assignee: Unassigned
- Project: [Magpie Weaver](https://linear.app/simonemmott/project/magpie-weaver-a6314c2e525d/overview). Magpie Weaver is an AI agent that helps authors write and develop intricate, engaging stories and narratives.
- Project milestone: MVP
- Created: 2026-07-23T17:53:05.318Z
- Updated: 2026-07-23T17:53:14.328Z
