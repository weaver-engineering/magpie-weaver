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
tool method is still a placeholder that throws `"not implemented"` — spec
00 deliberately built plumbing only, no real git/gh/fs/gate-check logic.

## Current Scope: spec 01

**Working spec doc:** `task-MAG-46-01-dev-testing-git-basics-spec.md`
(copied alongside this file). Unlike spec 00, this chunk goes through the
**full `spec` -> `test` -> `build` path**, not the quick route — it has a
real test-gate/build-gate to satisfy. It builds the `--dev-testing git
<method>` real-world execution path (spec 00 only stubbed the grammar) by
implementing the subset of `GitTool` (`task-phasing-lld.md` §4.8) that
spec 01 exercises: `fetch`, `currentBranch`, `branchExists`, `headSha`,
`createBranch`, `checkout`, `commitAll`, `push`.

**Phase ownership, per the Architecture Definition Document's Guard
Rails §1 table:** Specification is architect-owned — the agent has no
role in it. This chunk's spec commit (this doc + the copied spec file,
nothing else, on `spec/MAG-46`) is already done by the architect. **The
Test and Build phases below are for the agent (in OpenCode) to do.**

**The task-phases tool cannot yet manage its own phase transitions** —
that's the very capability this backlog is building. Do every branch
fork, commit, and check below with plain `git`/`pnpm`, not `pnpm task
...`; the `init`/`status`/`promote` commands are still throwing stubs.

### Test Phase (agent)

1. `git checkout -b test/MAG-46 spec/MAG-46` — fork from `spec/MAG-46`,
   not `main`.
2. Write **exactly one new file**,
   `test/packages/task-phases/deps/git-basics.test.ts` (path fixed by
   `task-MAG-46-test-file-layout-design.md`), implementing every
   Given/When/Then in spec 01 §3 (§3.1 read-only primitives, §3.2
   mutating primitives + §3.2.5 cwd-resolution, §3.3 error handling).
3. **These tests must exercise the real, built CLI as a subprocess
   against a real git repo — not `run()` in-process with a mocked
   `ExternalTools`.** Spec 01 §2.1 and the dev-testing design doc §7 are
   explicit about this split: MAG-46-01/02/03/08/13 are real-world
   execution (genuine process, real git, no mocks anywhere);
   MAG-46-04-onward's *command*-level tests are the ones that call
   `run(argv, mockTools)` in-process. Concretely: run
   `pnpm --filter @magpieweaver/task-phases build` first, then spawn
   `node packages/task-phases/dist/cli.js --dev-testing git <method> ...`
   (e.g. via `execFileSync`/`execa`) with `cwd` pointed at a fixture repo
   — never call into `cli.ts`'s exports directly for this file.
4. **No reusable git-fixture test helper exists in this repo yet** —
   you're building the first one. Each Given needs a real temporary git
   repository (`fs.mkdtemp` + `git init`/`git clone`, and — for `fetch`
   (§3.1.1) and `push` (§3.2.4) — a second bare repo standing in as
   `origin`), torn down afterward. `packages/gate-checks/src/git-
   inspector.ts`'s `GitInspectorImpl` is a useful reference for how this
   repo already wraps `simple-git`, but it has no fixture-building test
   helper to copy — its own tests mock `GitInspector` instead.
5. Confirm the new test(s) **fail** right now, before touching any
   implementation — `RealGitTool`'s methods all still throw
   `"not implemented"`, so they should. This is the fail-then-pass rule
   (Guard Rails §2); don't skip actually running it red.
6. Commit **only** `test/**` (plus `package.json`/`pnpm-lock.yaml` if a
   new test-only dependency is needed) — nothing under `packages/`. This
   is mechanically enforced by `validate-test-commit`'s allowed-paths
   list, not just a style preference. Exactly one commit ahead of
   `spec/MAG-46`, title starting `MAG-46` with a non-empty body (e.g.
   `MAG-46: add failing git-basics dev-testing tests`).
7. Self-check before calling this phase done:
   `pnpm gate-check build-gate --ref MAG-46 --json` from `test/MAG-46`
   (checked against `main`, since `build/MAG-46` doesn't exist yet — it
   should report exactly 2 commits, spec + test, and fail only on
   `new-tests-fail`/coverage, which the Build phase resolves next).

### Build Phase (agent)

1. `git checkout -b build/MAG-46 test/MAG-46` — fork from `test/MAG-46`.
2. In `packages/task-phases/src/deps/git.ts`, implement **only** the
   `RealGitTool` methods spec 01 names: `fetch`, `currentBranch`,
   `branchExists`, `headSha`, `createBranch`, `checkout`, `commitAll`,
   `push`. Leave every other method (`mergeBase`, `hasCommitsBeyond`,
   `headCommitTitle`, `isDirty`, `isAncestor`, `pullFastForward`,
   `rebase`, `deleteBranch`) throwing `"not implemented"` — those belong
   to later chunks (MAG-46-13 etc.); implementing them now is scope creep
   the gate can't see coming but the architect will.
3. Follow `packages/gate-checks/src/git-inspector.ts`'s `GitInspectorImpl`
   pattern: wrap `simple-git`, constructor takes an optional `cwd`
   defaulting to `process.cwd()`. This is what satisfies spec 01 §3.2.5's
   cwd-resolution requirement — resolve the repo relative to `cwd`, never
   relative to where `task-phases` itself is installed. Add `simple-git`
   as a real dependency of `packages/task-phases/package.json` (already
   used by `gate-checks` and `gitdatastore` — not a new library for this
   repo).
4. Do not touch `test/**` at all in this commit — the Test phase's new
   test(s) must pass **unmodified**.
5. Commit **only** `apps/`, `packages/`, `package.json`, `pnpm-lock.yaml`
   (per `validate-build-commit`'s allowed paths) — exactly one commit
   ahead of `test/MAG-46`, title starting `MAG-46` with a non-empty body.
6. Coverage applies here (Guard Rails §2): ~80% overall, 90%+ on new/
   changed lines specifically.
7. Self-check before calling this phase done:
   `pnpm gate-check main-gate --ref MAG-46 --json` from `build/MAG-46`
   (expects exactly 3 commits — spec, test, build — relative to `main`,
   and green `validate-build-commit`/coverage/`existing-tests-pass`/
   `new-tests-fail`).

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
