# Task MAG-30 - Test Gate Specification

**Companion to:** `task-MAG-30.md`
**Governs phases:** `deploy` (`deploy-test`) — the gate between `build/{ref}`/`task/{ref}` and `uat`
**Gate model:** Architecture Definition Document, Guard Rails §1/§2 and "Gates And
Actions" → Test Gate. The Test Gate is the second CI checkpoint in the pipeline
(after BuildGate): it re-validates a build's full commit chain (specification,
test, build) structurally, or a task's single commit, and additionally requires
the whole test suite to pass with adequate coverage before the change is allowed
into the `uat` branch (and therefore the test environment, via Deploy Test Action).

## 1. Interface Under Test
Not applicable. This spec defines the requirements for the GitHub workflow
action that provides the guard rail between `build/{ref}` / `task/{ref}` and
`uat`.

## 2. Deliverable
This spec delivers the TestGate GitHub workflow action.
`.github/workflows/test-gate.yaml`
The action validates PRs sent to GitHub whose target branch is `uat`.
It raises a GitHub workflow Status so that a branch protection rule can
validate changes to the `uat` branch.

### 2.1 Deliverable Notes For Agent
Implement the solution using multiple steps in the action, using
`.github/workflows/build-gate.yaml` as a structural guide.
Include a single success step to raise the success commit status.
Include a single failure step to raise the failure commit status.
Each step should test all the validations in the step and only exit with
failure at the end of the step.
The action must branch its validation logic on the PR's head branch: PRs
from `build/{ref}` are validated as a 3-commit chain (§3.5); PRs from
`task/{ref}` are validated as a single commit (§3.7). Both paths converge on
the same test-pass/coverage checks (§3.8–§3.10) before success (§3.11/§3.12).

## 3. Required Behaviours
* A valid task ref `{ref}` matches regex `[A-Z]+-[0-9]+`
* All references to `{ref}` in this spec refer to text matching the above regex.
* The `{ref}` must be constant throughout the commits in the PR.
* Commit status context is `TestGate`
* The PR's head branch must be `build/{ref}` or `task/{ref}`; the base branch
  must be `uat`.

### 3.1 The TestGate blocks PRs that don't contain {ref}
* Given - a PR to `uat` whose title does not contain `{ref}`
* When - the action runs
* Then -
  * The PR review states "The title of the PR must contain `{ref}`, e.g. 'MAG-30'"
  * A GitHub 'failure' commit status is raised

### 3.2 The TestGate blocks PRs that are not on a branch named build/{ref} or task/{ref}
* Given - a PR to `uat` whose branch does not match `build/{ref}` or `task/{ref}`
* When - the action runs
* Then -
  * The PR review states "The branch of the PR must match `build/{ref}` or `task/{ref}`, e.g. 'build/MAG-30' or 'task/MAG-30'"
  * a GitHub 'failure' commit status is raised

### 3.3 The TestGate blocks PRs from build/{ref} with less than 3 commits
* Given - a PR to `uat` from a branch `build/{ref}` with < 3 commits
* When - the action runs
* Then -
  * The PR review states "PRs from build/{ref} to uat must contain 3 commits."
  * a GitHub 'failure' commit status is raised

### 3.4 The TestGate blocks PRs from build/{ref} with more than 3 commits
* Given - a PR to `uat` from a branch `build/{ref}` with > 3 commits
* When - the action runs
* Then -
  * The PR review states "PRs from build/{ref} to uat must contain 3 commits."
  * a GitHub 'failure' commit status is raised

### 3.5 The TestGate allows PRs from build/{ref} with 3 commits
* Given -
  * a PR whose title starts with `{ref}`
  * a PR on a branch `build/{ref}`
  * a PR to `uat` with 3 commits

#### 3.5.1 The TestGate blocks PRs whose 1st commit does not start with {ref}
* Given -
  * The condition of §3.5
  * The 1st commit message does not start with {ref}
* When - the action runs
* Then -
  * The PR review states "The specification commit must start with `{ref}`, e.g. MAG-30"
  * a GitHub 'failure' commit status is raised

#### 3.5.2 The TestGate blocks PRs whose 1st commit does not include a description
* Given -
  * The condition of §3.5
  * The 1st commit message does not include a description
* When - the action runs
* Then -
  * The PR review states "The specification commit must describe the change"
  * a GitHub 'failure' commit status is raised

#### 3.5.3 The TestGate blocks PRs whose 1st commit makes changes outside /docs/tasks/task-{ref}
* Given -
  * The condition of §3.5
  * The 1st commit with changes outside `/docs/tasks/task-{ref}`
* When - the action runs
* Then -
  * The PR review states "The specification commit may only change /docs/tasks/task-{ref}"
  * a GitHub 'failure' commit status is raised

#### 3.5.4 The TestGate blocks PRs whose 1st commit [HEAD] does not define the task
* Given -
  * The condition of §3.5
  * The 1st commit [HEAD] does not include `/docs/tasks/task-{ref}/task-{ref}.md`
* When - the action runs
* Then -
  * The PR review states "The specification commit must define the task"
  * a GitHub 'failure' commit status is raised

#### 3.5.5 The TestGate blocks PRs whose 1st commit [HEAD] does not define the task spec
* Given -
  * The condition of §3.5
  * The 1st commit [HEAD] does not include `/docs/tasks/task-{ref}/task-{ref}-spec.md`
  * The 1st commit [HEAD] does not include `/docs/tasks/task-{ref}/task-{ref}-{NN}-spec.md`
* When - the action runs
* Then -
  * The PR review states "The specification commit must include the task spec"
  * a GitHub 'failure' commit status is raised

#### 3.5.6 The TestGate blocks PRs whose 2nd commit does not start with {ref}
* Given -
  * The condition of §3.5
  * The 2nd commit message does not start with {ref}
* When - the action runs
* Then -
  * The PR review states "The test commit must start with `{ref}`, e.g. MAG-30"
  * a GitHub 'failure' commit status is raised

#### 3.5.7 The TestGate blocks PRs whose 2nd commit does not include a description
* Given -
  * The condition of §3.5
  * The 2nd commit message does not include a description
* When - the action runs
* Then -
  * The PR review states "The test commit must describe the change"
  * a GitHub 'failure' commit status is raised

#### 3.5.8 The TestGate blocks PRs whose 2nd commit makes changes outside /test
* Given -
  * The condition of §3.5
  * The 2nd commit with changes outside `/test`
* When - the action runs
* Then -
  * The PR review states "The test commit may only change /test"
  * a GitHub 'failure' commit status is raised

#### 3.5.9 The TestGate blocks PRs whose 2nd commit updates existing tests
* Given -
  * The condition of §3.5
  * The 2nd commit updates an existing test `*.test.ts`
* When - the action runs
* Then -
  * The PR review states "The test commit may not change existing tests"
  * a GitHub 'failure' commit status is raised

#### 3.5.10 The TestGate blocks PRs whose 2nd commit does not define a new test
* Given -
  * The condition of §3.5
  * The 2nd commit without a new `*.test.ts`
* When - the action runs
* Then -
  * The PR review states "The test commit must define a new test"
  * a GitHub 'failure' commit status is raised

#### 3.5.11 The TestGate blocks PRs whose 3rd commit does not start with {ref}
* Given -
  * The condition of §3.5
  * The 3rd commit message does not start with {ref}
* When - the action runs
* Then -
  * The PR review states "The build commit must start with `{ref}`, e.g. MAG-30"
  * a GitHub 'failure' commit status is raised

#### 3.5.12 The TestGate blocks PRs whose 3rd commit does not include a description
* Given -
  * The condition of §3.5
  * The 3rd commit message does not include a description
* When - the action runs
* Then -
  * The PR review states "The build commit must describe the change"
  * a GitHub 'failure' commit status is raised

#### 3.5.13 The TestGate blocks PRs whose 3rd commit makes changes outside /src
* Given -
  * The condition of §3.5
  * The 3rd commit with changes outside `/src`
* When - the action runs
* Then -
  * The PR review states "The build commit may only change /src"
  * a GitHub 'failure' commit status is raised

### 3.6 The TestGate blocks PRs from task/{ref} whose commit count is not 1
* Given - a PR to `uat` from a branch `task/{ref}` with commit count != 1
* When - the action runs
* Then -
  * The PR review states "PRs from task/{ref} to uat must contain 1 commit."
  * a GitHub 'failure' commit status is raised

### 3.7 The TestGate allows PRs from task/{ref} with 1 commit
* Given -
  * a PR whose title starts with `{ref}`
  * a PR on a branch `task/{ref}`
  * a PR to `uat` with 1 commit

#### 3.7.1 The TestGate blocks PRs whose commit does not start with {ref}
* Given -
  * The condition of §3.7
  * The commit message does not start with {ref}
* When - the action runs
* Then -
  * The PR review states "The task commit must start with `{ref}`, e.g. MAG-30"
  * a GitHub 'failure' commit status is raised

#### 3.7.2 The TestGate blocks PRs whose commit does not include a description
* Given -
  * The condition of §3.7
  * The commit message does not include a description
* When - the action runs
* Then -
  * The PR review states "The task commit must describe the change"
  * a GitHub 'failure' commit status is raised

### 3.8 The TestGate blocks PRs where any test fails
* Given -
  * The condition of §3.5 or §3.7 is satisfied (structurally valid PR)
  * Running the full test suite at the PR head produces at least 1 failing test
* When - the action runs
* Then -
  * The PR review states "All tests must pass"
  * a GitHub 'failure' commit status is raised

### 3.9 The TestGate blocks PRs with less than 85% overall code coverage
* Given -
  * The condition of §3.5 or §3.7 is satisfied (structurally valid PR)
  * All tests pass
  * Overall code coverage at the PR head is < 85%
* When - the action runs
* Then -
  * The PR review states "Code coverage must be at least 85%"
  * a GitHub 'failure' commit status is raised

### 3.10 The TestGate blocks PRs with less than 95% new/changed code coverage
* Given -
  * The condition of §3.5 or §3.7 is satisfied (structurally valid PR)
  * All tests pass
  * Overall code coverage at the PR head is >= 85%
  * Diff coverage of the lines changed since `uat[HEAD]` is < 95%
* When - the action runs
* Then -
  * The PR review states "New or changed code coverage must be at least 95%"
  * a GitHub 'failure' commit status is raised

### 3.11 The TestGate passes valid PRs from build/{ref}
* Given -
  * The condition of §3.5
  * The 1st commit message starts with `{ref}`
  * The 1st commit message includes a description
  * The 1st commit defines `/docs/tasks/task-{ref}/task-{ref}.md`
  * The 1st commit defines `/docs/tasks/task-{ref}/task-{ref}[-NN]-spec.md`
  * The 2nd commit message starts with `{ref}`
  * The 2nd commit message includes a description
  * The 2nd commit defines a new file matching `/test/**/*.test.ts`
  * The 2nd commit does not update any files matching `test/**/*.test.ts`
  * The 3rd commit message starts with `{ref}`
  * The 3rd commit message includes a description
  * The 3rd commit only changes files matching `/src/**`
  * All tests pass
  * Overall code coverage is >= 85%
  * New/changed code coverage is >= 95%
* When - the action runs
* Then -
  * The PR review states "All TestGate validations pass"
  * a GitHub 'success' commit status is raised

### 3.12 The TestGate passes valid PRs from task/{ref}
* Given -
  * The condition of §3.7
  * The commit message starts with `{ref}`
  * The commit message includes a description
  * All tests pass
  * Overall code coverage is >= 85%
  * New/changed code coverage is >= 95%
* When - the action runs
* Then -
  * The PR review states "All TestGate validations pass"
  * a GitHub 'success' commit status is raised
