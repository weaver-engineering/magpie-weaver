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

## Previous scope: spec 11.01 (done)

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

## Pre-sequencing review: specs 12–15

Before starting spec 12, reviewed all four remaining backlog specs
(12: `status` derives `merged-pending-pull`; 13: real `rebase()`/
`mergeBase()`; 14: `promote` resolves `merged-pending-pull`; 15: `status`
derives `merged-pending-cleanup` + `promote`'s final cleanup) together for
consistency, deps usage, and sequencing, rather than reviewing each only
once its own turn comes up.

**Sequencing: correct, and 13→14 is a hard dependency, not just
numbering.** `mergeBase`/`rebase` are both still real stubs today
(confirmed: `throw new Error("not implemented")`; `mergeBase` is
unreached by any merged code, `rebase` is already called by `promote`'s
existing spec/quick rebase-forward path — MAG-46-13's already-tracked
debt). Spec 13 is explicitly the dedicated dev-testing chunk making both
real. Spec 14 mocks `git.rebase`/`pullFastForward` in its own tests
(correct pattern) but its *build* phase calls the real thing — safe only
because 13 lands first, which spec 13's own doc already says explicitly.
12 and 15 have no functional dependency on 13/14 — sequenced alongside
them for narrative consistency (both extend the same merged-PR-pair
derivation), not necessity.

**Deps/shim-dependency check:** 12 and 15 clean — nothing they touch
(`findMergedPR`, `headSha`, `isAncestor`, `deleteBranch`, `checkout`) is
stubbed. 13 is the stub-resolution chunk by design.

**Test-file-layout check:** all four specs' "Test file" headers match the
layout doc's own table exactly — no repeat of the 11.01 §3.4 mismatch.

**Existing-test contradiction check — confirmed, but already correctly
anticipated by the test file itself, not a surprise this time:**
`defers-when-gate-pr-exists.test.ts` still has §3.1 (Build Gate PR merged
→ defers) and §3.3 (Main Gate normal-route PR merged → defers) live.
Spec 12 will make §3.1's exact scenario real (`merged-pending-pull`);
spec 15 will make §3.3's real (`merged-pending-cleanup`). The file's own
comments already say "still owned by MAG-46-12/15" — so each needs the
same quick-route retirement §3.2/§3.4 already got, when that chunk
starts, not a new discovery.

**One real gap found and closed ahead of time: spec 14 §3.6's interactive
`y/N` confirmation prompt had no home to exist in.** Checked: nothing in
`ExternalTools` supports injectable stdin/confirmation, and `cli.ts`'s
only stdin mechanism (`ArgsSource`) reads a whole stream as one JSON blob
for `--dev-testing -i`, unrelated to line-based interactive confirmation.
Spec 14's own note asked exactly this to be checked before committing to
writing that section. Weighed four options with Simon:

1. Don't test the interactive path at all — legitimate (it's UX for a
   human; every real agent invocation uses `--confirm-rebase`/`--json`),
   but requires an explicit spec revision to mark it out of scope, not a
   silent skip.
2. Hack the existing `--dev-testing -i` `ArgsSource` stdin mechanism to
   also carry a canned y/N answer — a category error (different
   subsystem, different purpose); rejected.
3. Add `ExternalTools.prompt` as a new DI member, mirroring
   `git`/`github`/etc. — real merit, but real churn: either every
   existing test file's mock-tools helper needs a new field, or all four
   existing members become optional (touching every call site across
   `commands/*.ts`/`lib/*.ts` that currently assumes they're always
   present).
4. **Chosen.** Mock `process.stdin` directly — the exact mirror of what
   every test file already does for `process.stdout` via its own
   `captureStdout()` helper. No `ExternalTools` change. `promote.ts`
   reads the confirmation by mirroring `cli.ts`'s existing `readStdin()`
   (already proven, already used for `--dev-testing -i`'s JSON piping),
   not a new `readline`-based primitive.

Closed via [magpieweaver-docs PR #89](https://github.com/weaver-engineering/magpieweaver-docs/pull/89)
(spec 14's own doc corrected in place, both the §2.1 note and the closing
"note for whoever picks this up," which no longer needs to exist as an
open question).

Also produced [magpieweaver-docs PR #90](https://github.com/weaver-engineering/magpieweaver-docs/pull/90):
this whole review generalised into `design-workflow-findings.md` Finding
3 ("prior-behavior retirements are formulaic, not a spec defect"), the
reasoning added to `sequenced-spec-supervision-notes.md`, the four-step
retirement recipe added to `sequenced-spec-supervision-CLAUDE.md` as a
named procedure, and a consequence for `loom-service-vision.md` — the
future scheduler needs the same required-behavior-vs-merged-test diff as
a standing check, not just something the architect currently does by
hand.

## Current Scope: spec 15

**Working spec doc:**
`task-MAG-46-15-status-merged-pending-cleanup-and-promote-cleaned-up-spec.md`
(copied alongside this file). The final state in the phase/state machine:
`status` derives `merged-pending-cleanup` once the Main Gate PR is
confirmed merged and local `main` hasn't caught up yet — including the
interrupted-cleanup retrigger (a surviving phase branch already an
ancestor of `main`), which must converge on the identical derived state,
not a distinct broken/stale one. `promote`'s `cleaned-up` action resolves
it: updates `main`, deletes every surviving phase branch (local and
`origin`), no confirmation required (nothing is lost once the merge is
confirmed) — covering the regular `spec`/`test`/`build` set, tolerating
partially-already-deleted branches, and the quick route (only
`task/{ref}` ever existed). After cleanup, the ref reports
`not-initialised` again.

**Pre-handoff spec review:** already done in full as part of the
specs 12–15 batch sequencing review. No open questions remain in the
working spec doc.

## Previous scope: spec 14 (done)

**Working spec doc:**
`task-MAG-46-14-promote-pulled-and-rebase-spec.md` (copied alongside this
file). `promote` resolves `merged-pending-pull` (derived in spec 12) into
either `pulled` (plain fast-forward, no pre-existing `build/{ref}` commits)
or `pulled-and-rebased` (gated by `--confirm-rebase` or an interactive
`y/N` prompt, when `build/{ref}` already had build-phase commits that need
reordering onto the fresh merge). `git.rebase()`/`pullFastForward()` are
mocked in this chunk's own tests — the real primitives were proven for
real by spec 13's e2e verification, so it's now safe for this build phase
to call the real thing unattended.

**Pre-handoff spec review:** already done in full as part of the
specs 12–15 batch sequencing review. The one item that review produced —
the interactive confirmation prompt had no home in `ExternalTools`
(§2.1) — was resolved ahead of time and closed in the doc itself: mock
`process.stdin` directly (same technique as every test file's existing
`captureStdout()`, pointed the other direction), no `ExternalTools`
change. No open questions remain in the working spec doc.

**Test phase done** — merged via
[PR #121](https://github.com/weaver-engineering/magpie-weaver/pull/121)
(`test/MAG-46` → `build/MAG-46`, rebase-merged, confirmed 2 commits).
Architect review found no defects — independently reproduced
`build-gate` locally (123/123 tests pass, 100% new-line coverage) and
read the full test file against all six required behaviors (§3.1–§3.6),
confirming the interactive-confirmation mocking technique matched the
spec's own §2.1 correction rather than reintroducing the harness gap.
Build phase started (session `ses_02c93d58dffeZjQyJXyE4m8K2R`, `agent_1`).

**Build phase found a second real bug via e2e testing that the mocked
suite and CI both missed** — [PR #122](https://github.com/weaver-engineering/magpie-weaver/pull/122).
Set up a disposable fixture (`test/ZZZZ-140` → `build/ZZZZ-140`, a
genuinely merged PR — required since `merged-pending-pull` depends on
`findMergedPR` seeing a real merged PR, not a mock) and ran the real
built CLI against it: `pullFastForward()`'s `git branch -f <branch>
origin/<branch>` fails with `fatal: Cannot force update the current
branch.` whenever `<branch>` is the currently checked-out branch — which
it always is here, since `promote`'s own `branchMismatch` guard (spec 10
LLD §3.4) forces the caller onto `build/{ref}` before the
`merged-pending-pull` resolution ever runs. Not an edge case: the same
reasoning made §3.1's "no local `build/{ref}`" sub-case unreachable too
(`branchExists` can't be `false` on the branch you're currently checked
out on), so neither sub-case of this chunk's mainline behavior could
succeed for real as originally built — only the mocked tests, where
`pullFastForward`/`rebase`/`push` are plain `vi.fn()` doubles, passed.

Relayed via a PR comment (the stopgap ad-hoc-prompt-plus-JSON-envelope
pattern — MAG-47's standard review-comment template still not built,
deferred until the MAG-46 backlog completes). `build-implementer`
independently confirmed the same root cause on its own re-read, fixed
`pullFastForward` to fast-forward in place with `git merge --ff-only`
when the target is the current branch, and — going further than asked —
also fixed `promote.ts`'s plain-vs-cascading distinction to compare
`headSha` after the pull rather than relying on the now-understood-
unreachable `branchExists` pre-check. Re-verified against a second real
disposable fixture it built itself (`PR #124`, also requiring a human
merge — self-merging is withheld from agents same as the architect),
confirming the architect's exact failing repro now exits 0 with
`action: "pulled"`. One incident along the way: mid-fix the session
appeared to stall after a context compaction; interrupted cleanly via
`POST /session/{id}/abort` (not the unreliable `/api/.../interrupt`
path) and resumed without issue, also switching this session to
`openrouter`'s `~deepseek/deepseek-v4-flash-latest` (1M-token context)
for the remainder of this chunk's work, at the user's request, scoped
to this session only.

This is the fourth real bug e2e testing alone has caught in this
backlog (`isAncestor`, `rebase()`, the spec-12 `test/{ref}` HEAD read,
now this) — the mocked suite and CI were fully green every time.

## Previous scope: spec 13 (done)

**Working spec doc:**
`task-MAG-46-13-dev-testing-git-rebase-forward-spec.md` (copied alongside
this file). The dedicated dev-testing chunk (tier 1, per Finding 1's
three-tier framework) making `GitTool.rebase()`/`mergeBase()` real —
`promote`'s spec/quick rebase-forward path has called `rebase()` since
spec 10.01, confirmed broken via e2e testing after that chunk's merge,
left as known debt in its existing backlog position until now. Covers
all three real scenarios from LLD §3.5 (spec-amended-under-test,
main-drift, build-reorder-after-superseded-merge), the commit-count
precondition (checked before any rewrite; branch left untouched on
failure), and conflict reporting (surfaced, never auto-resolved).
Exercised for real via `pnpm task --dev-testing git <method> -i`, not
mocked — this is the single riskiest primitive in the whole design, a
force-push-adjacent rewrite that must be proven against real git
behavior before `promote` is allowed to call it unattended.

**Pre-handoff spec review:** already done in full as part of the
specs 12–15 batch sequencing review. No shim-dependency check needed —
this chunk *is* the stub-resolution point by design, not a dependent of
one. Existing-test contradiction check clean: every `mergeBase`/`rebase`
reference elsewhere in the test suite is an `unexpected()` throw-mock
asserting they're never called on *other* code paths, which stays true
regardless of whether the real implementation exists underneath.

**Test phase done** — merged via
[PR #116](https://github.com/weaver-engineering/magpie-weaver/pull/116)
(`test/MAG-46` → `build/MAG-46`, rebase-merged, confirmed 2 commits).
Architect review found no defects — independently rebuilt and ran the
new real-git dev-testing file directly (6/7 fail-then-pass as required,
the 7th — malformed-JSON rejection — legitimately passes immediately,
pre-existing CLI arg-parsing logic unrelated to `rebase()`, same class
as spec 12's `§3.2`), full suite (109 pre-existing pass unmodified),
`build-gate` reproduced locally matching CI exactly. Every scenario uses
real git subprocesses against real throwaway repos, asserting on actual
repo state afterward, not mocks — the §3.3 build-reorder fixture
notably simulates GitHub's own rebase-merge via a throwaway
`cherry-pick` branch to produce a genuine superseded-merge scenario
rather than needing real GitHub interaction. Build phase started
(session `ses_02dad41f4ffef6CGpKFLlkO0wU`, `agent_1`).

Three more agent permission gaps surfaced during this test phase (on top
of the earlier stuck-turn stall requiring a manual cancel via the user's
local client — no error ever logged for that one, worse than the usual
free-tier 503 pattern): `sort`, `mktemp`, and `test` (the POSIX
comparison command) were all missing entirely, needed for the real
git-fixture construction this chunk's tests require. Fixed via
`task/MAG-40` ([PR #115](https://github.com/weaver-engineering/magpie-weaver/pull/115)).

**Build phase done** — [PR #118](https://github.com/weaver-engineering/magpie-weaver/pull/118)
(`ready/MAG-46` → `main`, 3 commits: spec, test, build), CI green
(`validate-main-gate`, `MainGate`), merged.

The build-implementer session resumed from a crashed prior session that
had left the real `rebase()`/`mergeBase()` implementation uncommitted
but intact, plus one stray contaminated commit already cleaned up before
the crash. On resume it misjudged which of two diverged test-commit
shas carried the architect's already-landed §3.3 fixture fix (a
double-`"init"` correction) — read the diff direction backwards, believed
the fix lived in `origin/build/MAG-46` when it actually only existed in
its own dangling local commit — and queued a `git restore
--staged --worktree` that would have overwritten the fix with the
unfixed content. Caught before it ran (architect review of the live
session's pending permission prompt, not CI or any test): the user
halted the session on their own client rather than approving it. Relayed
the correct diff direction explicitly; the session re-verified it itself
or re-derived it, corrected course, and committed the right content.

One legitimate trunk-drift rebase followed (`main` had advanced one
docs-only commit past the branch's merge-base after `ready/MAG-46` was
created) — `git rebase --onto origin/main <merge-base> ready/MAG-46`,
same class as spec 11.01's precedent, clean, no conflicts, 3-commit
structure preserved.

**Architect e2e verification** (real disposable bare-repo + working
copy in scratch, not the sandbox fixture repo, cleaned up after): ran
the actual built CLI (`node dist/cli.js --dev-testing git
rebase/mergeBase -i`) against real git state for all three behaviors —
`mergeBase()` matched plain `git merge-base` exactly; the commit-count
precondition correctly refused a 2-commit branch and left it untouched;
a genuine single-commit rebase produced a real, correctly-parented
commit with the right file content and a clean working tree; a real
conflicting rebase reported `status: "conflict"` and correctly left the
repo mid-`rebase-apply` rather than auto-aborting — checked against the
spec doc first since that looked surprising, confirmed intentional
(§2.1: "leave the repository in whatever state `git rebase` itself
leaves it in... that's a decision for `promote`'s own error handling,
not this primitive"). No defects found this time — unlike specs 11.01
and 12, where the same e2e-verification step is what caught the real
bugs the mocked suite and CI both missed.

`test/MAG-46`, `build/MAG-46`, `ready/MAG-46` deleted on origin and in
both worktrees per the standard clear-down-stale-branches step.

## Previous scope: spec 12 (done)

**Working spec doc:**
`task-MAG-46-12-status-merged-pending-pull-spec.md` (copied alongside
this file). Extends `lib/repo-state.ts`'s `deriveRepoState()` (same
shared pipeline as MAG-46-11/11.01's `awaiting-pr`) with the Build Gate
pair's merged-PR case: a confirmed-merged `test/{ref}` → `build/{ref}`
PR whose `headRefOid` matches `test/{ref}`'s current HEAD derives
`phase: "build", state: "merged-pending-pull"`, in both sub-cases (no
local `build/{ref}` yet, or local `build/{ref}` behind `origin`). No git
mutation — resolving this state is `promote`-only (MAG-46-14). The
superseded-merge distinction (`headRefOid` no longer matching) is
explicitly out of scope, deferred to MAG-46-13/14.

**Pre-handoff spec review:** already done in full as part of the
specs 12–15 batch sequencing review above — shim-dependency check
clean, test-file-layout header matches. The one action item it produced
for this chunk, retiring `defers-when-gate-pr-exists.test.ts` §3.1, was
landed via the quick route and merged ([PR #107](https://github.com/weaver-engineering/magpie-weaver/pull/107))
before this spec-phase commit was created, so `spec/MAG-46` (and
whatever forks from it) never sees the contradicted test.

**Test phase done** — merged via
[PR #109](https://github.com/weaver-engineering/magpie-weaver/pull/109)
(`test/MAG-46` → `build/MAG-46`, rebase-merged, confirmed 2 commits).
Architect review found no defects — independently reproduced `build-gate`
locally (100% new-line coverage, 3 new tests fail-then-pass, 105
pre-existing pass unmodified) rather than trusting CI's summary line.
One thing worth flagging for the build phase, not a defect in the tests:
§3.3 requires `derivePhase()` to genuinely resolve `build/{ref}` via
branch-exists for the first time (currently throws `"not implemented"`
for that case) — confirmed real spec-required scope by re-reading spec
12 §3.3 directly, not a test-writer overreach. Build phase started (session `ses_02e533a15ffevGOv2z3oj8ixhz`, `agent_1`).

**Build phase found a real bug via e2e testing that the mocked suite and CI both missed** — [PR #111](https://github.com/weaver-engineering/magpie-weaver/pull/111).
`derivePrState`'s new code read `test/{ref}`'s HEAD via the bare local
branch name (`tools.git.headSha("test/{ref}")`). Nothing guarantees that
branch exists locally — `fetch()` only ever updates the remote-tracking
ref. Found by running the real built CLI from a fresh clone against a
genuinely merged PR on a disposable ref (`ZZZZ-972`, base/head branches
created for real, PR raised, **Simon merged it** — `gh pr merge` is
withheld from agents and architect alike, so this needed a real,
if disposable, human-approved merge; the sandbox fixture repo didn't fit
since its branches aren't named `build/{ref}`/`test/{ref}`): crashed with
`fatal: ambiguous argument 'test/ZZZZ-972': unknown revision`. Confirmed
the exact cause by manually branching `test/ZZZZ-972` locally — with that
in place the same code succeeded.

Relayed to `build-implementer`, which fixed the read to use
`origin/test/{ref}` (matching the pattern already used elsewhere in this
file for `build/{ref}` vs `origin/build/{ref}`), reproduced the original
crash and confirmed the fix against real git state itself before
reporting — genuinely thorough, went further than asked and also
real-verified §3.2/§3.3. It then correctly hit a second-order
consequence and stopped rather than working around it: the already-merged
test's `headShaFor` mock was pinned to the same bare `test/{ref}` form the
buggy implementation used, so the *correct* implementation now failed the
*existing* mocked assertions. `test/**` is immutable to it; reported
`needs-architect-intervention` with the exact lines needing correction
rather than reaching for a bare-then-origin fallback that would satisfy
the mock while silently masking real git errors — real engineering
judgment, not just rule-following.

**Architect fix:** amended the already-merged test commit directly
(`git rebase -i`, edit in place, not a new commit — commit count stayed
at exactly 3) to correct `merged-pending-pull.test.ts`'s `headShaFor`
keys and `toHaveBeenCalledWith` assertions to `origin/test/{ref}`.
Independently re-verified twice: mocked suite (108/108) and a second real
e2e pass from a fresh clone (no local `test/ZZZZ-972`) confirming
`build::merged-pending-pull` for real. One further trunk-drift rebase
needed afterward (PR #110 landed after `build/MAG-46` forked, same class
as before) — done, pushed, CI green. Disposable ref fully unwound
(`build/ZZZZ-972`/`test/ZZZZ-972` deleted on origin).

This is the third real bug e2e testing alone has caught in this backlog
(`isAncestor`, `rebase()`, now this) — the mocked suite and CI were both
fully green each time.

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
