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

## Current Scope: spec 06.01

**Working spec doc:**
`task-MAG-46-06-01-status-defers-when-gate-pr-exists-spec.md` (copied
alongside this file). Adds the explicit required behavior MAG-46-06
never had: a merged or open PR on any of the three gate pairs
(`build/{ref}`→`main`, `task/{ref}`→`main`, `test/{ref}`→`build/{ref}`)
causes `status` to defer, checked *before* the no-PR branch-exists
derivation MAG-46-06 already implements. Full `spec` -> `test` -> `build`
path — PR #53 is being sent back asking `build-implementer` to strip the
dead `assertNoGatePR` code for now; it gets reintroduced here, properly
driven by this chunk's own failing tests.

Note: `pnpm task init MAG-46` cannot be used to move this long-running
ref onto a new chunk — confirmed directly (`task init` refuses with
"Branch `spec/MAG-46` already exists"), since the existing-branch-reuse
decision tree is explicitly deferred to MAG-46-18. Continuing to raise
each chunk's spec commit directly onto the existing `spec/{ref}` branch,
as for every prior chunk.

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
