# Task MAG-46 - real `isDirty`/`hasCommitsBeyond`/`headCommitTitle`/`pullFastForward`/`deleteBranch`

**Companion to:** `task-MAG-46.md`
**Governs phases:** `test`, `build`
**Gate model:** Architecture Definition Document, Guard Rails §1/§2 — Test
phase may only touch the test package; Build phase may only touch
implementation code. New tests must fail against the pre-implementation
codebase and pass, unmodified, after implementation (fail-then-pass rule).

**Test file:** `test/packages/task-phases/deps/git-status-and-cleanup.test.ts`.
See `task-MAG-46-test-file-layout-design.md`.

## 1. Interface Under Test
The remaining `GitTool` (§4.8 of `task-phasing-lld.md`) methods with no
real-world coverage anywhere in the backlog: `isDirty`,
`hasCommitsBeyond`, `headCommitTitle`, `pullFastForward`, `deleteBranch` —
exercised for real via `pnpm task --dev-testing git <method> [-i |
--args-file <path>]`, the entry point built in MAG-46-01.

MAG-46-01 covered `fetch`/`currentBranch`/`branchExists`/`headSha`/
`createBranch`/`checkout`/`commitAll`/`push`; MAG-46-13 covered
`rebase`/`mergeBase`/`isAncestor`. That's 11 of `GitTool`'s 16 methods.
The 5 covered here are the rest — surfaced by MAG-46-05's build phase
discovering that `RealGitTool.isDirty()` still throws `"not implemented"`,
which blocks `init` (and, on inspection, `wip`/`promote`/`switch` too —
MAG-46-07/10/14/15/17 all call one or more of these 5 methods, but every
one of those chunks tests only against mocked `git`, so the gap was
invisible until a real invocation hit it).

## 2. Deliverable
Real implementations of all 5 methods, each matching the LLD's own
prescription (§4.8) exactly:
- `isDirty()` — `git status --porcelain`, nonempty means dirty.
- `hasCommitsBeyond(branch, parentBranch)` — `git rev-list --count
  parentBranch..branch`, nonzero means true.
- `headCommitTitle(branch)` — `git log -1 --format=%s branch`.
- `pullFastForward(branch)` — create-only (`git branch branch
  origin/branch`) when `branch` doesn't exist locally; otherwise verify
  `git merge-base --is-ancestor branch origin/branch` before forcing
  (`git branch -f branch origin/branch`) — refusing rather than forcing
  when that verification fails, since forcing a diverged ref would
  silently discard a local-only commit.
- `deleteBranch(branch)` — `git branch -D branch` (tolerating "doesn't
  exist locally" as a no-op) then `git push origin --delete branch`.

### 2.1 Deliverable Notes For Agent
- This chunk does not touch `commands/*.ts` — `init`/`wip`/`promote`/
  `switch` already call these methods against the `GitTool` interface;
  once `RealGitTool` implements them for real, those commands work
  end-to-end with no command-level change needed.
- `pullFastForward`'s refusal case is the one behavior in this chunk with
  no direct LLD worked example — it's inferred from the LLD's own
  rationale comment (§4.8: "blindly forcing... would silently discard a
  local-only commit"). Report it as a thrown/failed result the same way
  `headSha` on an unknown ref already does in MAG-46-01 §3.3.4 — don't
  invent a new error-shape convention for it.
- `deleteBranch`'s local-absent-but-remote-present case matters because
  it's exactly the state a previously-interrupted cleanup leaves behind
  (LLD line ~734: "reporting a stale earlier phase, and `deleteBranch`
  already tolerates" a partial prior attempt) — re-running it must still
  succeed, not error on the missing local half.
- All example invocations below use the `-i` stdin form for readability;
  `--args-file <path>` is equivalent per the design doc.

## 3. Required Behaviors
* `isDirty()` reports `true` for staged changes, unstaged changes, or
  untracked files; `false` for a clean worktree.
* `hasCommitsBeyond(branch, parentBranch)` reports `true` when `branch`
  has commits `parentBranch` doesn't; `false` when `branch` is at or
  behind `parentBranch`.
* `headCommitTitle(branch)` reports the exact subject line of `branch`'s
  tip commit.
* `pullFastForward(branch)` creates a missing local branch from
  `origin/branch` without checking it out; fast-forwards an existing,
  non-diverged local branch to match `origin/branch`; refuses (without
  mutating anything) when the local branch has diverged from `origin`.
* `deleteBranch(branch)` deletes both the local and remote branch;
  tolerates either half already being absent without error.

### 3.1 isDirty
#### 3.1.1 Clean worktree reports false
* Given - `test/AAA-201` is checked out with no staged, unstaged, or
  untracked changes
* When - `pnpm task --dev-testing git isDirty` (no args)
* Then - the reported value is `false`

#### 3.1.2 Unstaged modification reports true
* Given - `test/AAA-202` is checked out; a tracked file has an unstaged
  edit
* When - `pnpm task --dev-testing git isDirty`
* Then - the reported value is `true`

#### 3.1.3 Untracked file reports true
* Given - `test/AAA-203` is checked out, otherwise clean; a new untracked
  file exists in the worktree
* When - `pnpm task --dev-testing git isDirty`
* Then - the reported value is `true`

### 3.2 hasCommitsBeyond
#### 3.2.1 branch ahead of parentBranch reports true
* Given - `test/AAA-204` has one commit that `spec/AAA-204` (its
  `parentBranch`) doesn't
* When -
  ```bash
  pnpm task --dev-testing git hasCommitsBeyond -i << EOF
  {"branch": "test/AAA-204", "parentBranch": "spec/AAA-204"}
  EOF
  ```
* Then - the reported value is `true`

#### 3.2.2 branch level with parentBranch reports false
* Given - `spec/AAA-205` and `test/AAA-205` point at the same commit (no
  test-phase commit made yet)
* When -
  ```bash
  pnpm task --dev-testing git hasCommitsBeyond -i << EOF
  {"branch": "test/AAA-205", "parentBranch": "spec/AAA-205"}
  EOF
  ```
* Then - the reported value is `false`

### 3.3 headCommitTitle
#### 3.3.1 Reports the tip commit's exact subject
* Given - `build/AAA-206`'s tip commit's subject line is exactly
  `"AAA-206: implement the thing"`
* When -
  ```bash
  pnpm task --dev-testing git headCommitTitle -i << EOF
  {"branch": "build/AAA-206"}
  EOF
  ```
* Then - the reported value is exactly `"AAA-206: implement the thing"`
  (no truncation, no body lines included)

### 3.4 pullFastForward
#### 3.4.1 Missing local branch is created, not checked out
* Given - `origin/build/AAA-207` exists; `build/AAA-207` does not exist
  locally; some other branch is currently checked out
* When -
  ```bash
  pnpm task --dev-testing git pullFastForward -i << EOF
  {"branch": "build/AAA-207"}
  EOF
  ```
* Then -
  * `build/AAA-207` now exists locally, at the same SHA as
    `origin/build/AAA-207`
  * The currently checked-out branch is unchanged

#### 3.4.2 Existing non-diverged local branch is fast-forwarded
* Given - local `build/AAA-208` exists but is behind `origin/build/AAA-208`
  (a genuine ancestor relationship, no local-only commit)
* When -
  ```bash
  pnpm task --dev-testing git pullFastForward -i << EOF
  {"branch": "build/AAA-208"}
  EOF
  ```
* Then - local `build/AAA-208` now matches `origin/build/AAA-208`'s SHA

#### 3.4.3 Diverged local branch is refused, not forced
* Given - local `build/AAA-209` has a commit that is not an ancestor of
  `origin/build/AAA-209` (a genuine local-only commit — the branches have
  diverged)
* When -
  ```bash
  pnpm task --dev-testing git pullFastForward -i << EOF
  {"branch": "build/AAA-209"}
  EOF
  ```
* Then -
  * The command exits nonzero; the failure is reported, not thrown as an
    unhandled stack trace (same treatment as MAG-46-01 §3.3.4)
  * Local `build/AAA-209` is completely unchanged — still at its original,
    diverged SHA

### 3.5 deleteBranch
#### 3.5.1 Deletes both local and remote
* Given - `task/AAA-210` exists both locally and on `origin`
* When -
  ```bash
  pnpm task --dev-testing git deleteBranch -i << EOF
  {"branch": "task/AAA-210"}
  EOF
  ```
* Then -
  * `task/AAA-210` no longer exists locally
  * `origin/task/AAA-210` no longer exists

#### 3.5.2 Tolerates an already-absent local half
* Given - `task/AAA-211` exists on `origin` but was already deleted
  locally (e.g. a previously-interrupted cleanup)
* When -
  ```bash
  pnpm task --dev-testing git deleteBranch -i << EOF
  {"branch": "task/AAA-211"}
  EOF
  ```
* Then -
  * The command exits 0 — the missing local branch is not an error
  * `origin/task/AAA-211` no longer exists
