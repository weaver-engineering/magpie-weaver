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

## Current Scope: spec 04

**Working spec doc:** `task-MAG-46-04-status-not-initialised-spec.md`
(copied alongside this file). This is the first *command-level* chunk —
unlike specs 01–03 (real-world execution against actual git/gh/fs, no
mocks), spec 04 tests `pnpm task status` by calling `run(argv,
mockTools)` in-process against a mocked `ExternalTools` (dev-testing
design doc §7). Full `spec` -> `test` -> `build` path, same as every
chunk since spec 00.

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
