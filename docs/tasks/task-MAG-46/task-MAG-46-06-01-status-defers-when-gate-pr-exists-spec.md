# Task MAG-46 - `status` defers when a gate PR exists for `{ref}`

**Companion to:** `task-MAG-46.md`
**Governs phases:** `test`, `build`
**Gate model:** Architecture Definition Document, Guard Rails §1/§2 — Test
phase may only touch the test package; Build phase may only touch
implementation code. New tests must fail against the pre-implementation
codebase and pass, unmodified, after implementation (fail-then-pass rule).

**Test file:** `test/packages/task-phases/status/defers-when-gate-pr-exists.test.ts`.
See `task-MAG-46-test-file-layout-design.md`.

## 1. Interface Under Test
`pnpm task status [--ref <ref>]`, extending MAG-46-06's no-PR
branch-exists derivation with the merge-status/open-PR check the LLD's
§3.2 pipeline runs *before* branch-exists derivation — against injected
`git`/`github` test doubles, same command-level pattern as MAG-46-04/05/06.

## 2. Deliverable
Before deriving `phase`/`state` from the branches themselves (MAG-46-06),
`status` checks whether any of the three gate PRs for `{ref}` — the two
Main Gate pairs (`build/{ref}` → `main`, `task/{ref}` → `main`) and the
Build Gate pair (`test/{ref}` → `build/{ref}`) — has ever been merged or
is currently open. If any one has, `status` defers (reports the same
`"not implemented"` placeholder every not-yet-built path in this command
already uses) rather than deriving a phase/state from branch existence.
The no-PR case itself (MAG-46-06, already implemented and tested) is
unaffected — this chunk only adds the check that runs *before* it.

### 2.1 Deliverable Notes For Agent
- This closes a real gap found while reviewing MAG-46-06's build PR:
  `build-implementer` had already written this exact check
  (`assertNoGatePR`, in `status.ts`) on their own initiative, recognising
  it was needed, but never wired it into `status()` — and nothing caught
  that because MAG-46-06's own tests never asserted `findMergedPR`/
  `findOpenPR` were called at all (its Given clauses only ever set them
  to return `null`, as a precondition, never as a scenario in their own
  right). That function was stripped back out of MAG-46-06's build PR;
  re-implement the same check here, driven by this chunk's own tests.
- Assert `git.hasCommitsBeyond`/`git.headCommitTitle` are **not** called
  on any of these paths — confirming the branch-exists derivation
  (MAG-46-06) genuinely wasn't reached, not merely that the right message
  came out.
- The three base/head pairs don't need to be tested for a specific check
  order relative to each other — any one of the three reporting a merged
  or open PR is sufficient to defer. Do assert both "merged" and "open"
  are each capable of triggering it at least once, not just "merged".

## 3. Required Behaviors
* A merged PR on any of the three gate pairs (`build/{ref}`→`main`,
  `task/{ref}`→`main`, `test/{ref}`→`build/{ref}`) causes `status` to
  defer, without deriving phase/state from branch existence.
* An open PR on any of the three gate pairs causes the same deferral.
* With no merged or open PR on any pair, MAG-46-06's existing no-PR
  derivation still runs unaffected (regression guard — already covered by
  MAG-46-06's own tests; not re-tested here).

### 3.1 Merged Build Gate PR defers
* Given
  * `git.branchExists("test/AAA-101", ...)` returns `true`
  * `github.findMergedPR("build/AAA-101", "test/AAA-101")` returns a
    non-null `MergedPullRequestSummary`
* When - `pnpm task status --ref AAA-101`
* Then -
  * `status` reports the `"not implemented"` deferral
  * `git.hasCommitsBeyond`/`git.headCommitTitle` were **not** called

### 3.2 Open Build Gate PR defers
* Given
  * `git.branchExists("test/AAA-102", ...)` returns `true`
  * `github.findMergedPR("build/AAA-102", "test/AAA-102")` returns `null`
  * `github.findOpenPR("build/AAA-102", "test/AAA-102")` returns a
    non-null `PullRequestSummary`
* When - `pnpm task status --ref AAA-102`
* Then -
  * `status` reports the `"not implemented"` deferral
  * `git.hasCommitsBeyond`/`git.headCommitTitle` were **not** called

### 3.3 Merged Main Gate PR (normal route) defers
* Given
  * `git.branchExists("build/AAA-103", ...)` returns `true`
  * `github.findMergedPR("main", "build/AAA-103")` returns a non-null
    `MergedPullRequestSummary`
* When - `pnpm task status --ref AAA-103`
* Then -
  * `status` reports the `"not implemented"` deferral
  * `git.hasCommitsBeyond`/`git.headCommitTitle` were **not** called

### 3.4 Open Main Gate PR (quick route) defers
* Given
  * `git.branchExists("task/AAA-104", ...)` returns `true`
  * every `findMergedPR` call returns `null`
  * `github.findOpenPR("main", "task/AAA-104")` returns a non-null
    `PullRequestSummary`
* When - `pnpm task status --ref AAA-104`
* Then -
  * `status` reports the `"not implemented"` deferral
  * `git.hasCommitsBeyond`/`git.headCommitTitle` were **not** called
