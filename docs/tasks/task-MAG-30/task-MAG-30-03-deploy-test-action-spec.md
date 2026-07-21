# Task MAG-30 - Deploy Test Action Specification

**Companion to:** `task-MAG-30.md`
**Governs phases:** `deploy` (`deploy-test`) — the automatic action triggered
immediately after a `build/{ref}` or `task/{ref}` PR is merged into `uat`
**Gate model:** Architecture Definition Document, "Gates And Actions" → Deploy
Test Action, and the User Acceptance Test Phase of the branching diagram. This
is not a gate: it does not block a PR, and it is not human-approved. It is an
automatic post-merge action that deploys the test environment and hands off
to the (manual) Main Gate by raising a PR from `uat` to `main`.

## 1. Interface Under Test
Not applicable. This spec defines the requirements for the GitHub workflow
action that runs after a merge to `uat`.

## 2. Deliverable
This spec delivers the Deploy Test Action GitHub workflow action.
`.github/workflows/deploy-test.yaml`
The action triggers automatically whenever a commit is pushed to `uat` (i.e.
whenever a `build/{ref}` or `task/{ref}` PR is merged, per the repository's
Squash and Merge only setting — see task-MAG-30.md §5). It deploys the test
environment and raises a PR from `uat` to `main`, which the (manual) Main Gate
subsequently validates.

### 2.1 Deliverable Notes For Agent
Implement the solution using multiple steps in the action, using
`.github/workflows/test-gate.yaml` as a structural guide.
Include a single success step and a single failure step, following the same
pattern as BuildGate/TestGate (raise a commit status on the `uat` HEAD commit,
post details on failure).
Each step should test all the validations in the step and only exit with
failure at the end of the step.
Squashing the inbound PR's commits into a single commit on `uat` is performed
by GitHub's Squash and Merge feature when the `build/{ref}`/`task/{ref}` PR is
merged — it is a repository setting (task-MAG-30.md §5), not a step in this
action. By the time this action runs, `uat[HEAD]` is already a single commit
whose message is the squashed specification+test+build commit messages (for a
`build/{ref}` merge) or the task commit message (for a `task/{ref}` merge).
Deploying the test environment is explicitly out of scope for task-MAG-30 (the
test environment is not yet defined) — implement the deploy step as a stub
(e.g. `echo`) in the same way BuildGate/TestGate stub `pnpm install`/`pnpm
test`, so it is ready to be filled in once the test environment exists.

## 3. Required Behaviours
* A valid task ref `{ref}` matches regex `[A-Z]+-[0-9]+`
* All references to `{ref}` in this spec refer to text matching the above regex.
* Commit status context is `DeployTestAction`
* The action triggers on push to `uat`

### 3.1 The Deploy Test Action triggers only on push to uat
* Given - a push event on a branch other than `uat`
* When - the workflow evaluates its trigger
* Then -
  * The job does not run

### 3.2 The Deploy Test Action derives {ref} from the uat[HEAD] commit message
* Given - a push to `uat`
* When - the action runs
* Then -
  * The action reads the subject of `uat[HEAD]`
  * The action extracts the leading `{ref}` token from the subject

### 3.3 The Deploy Test Action fails safe when {ref} cannot be derived
* Given -
  * A push to `uat`
  * `uat[HEAD]`'s commit message does not start with a valid `{ref}`
* When - the action runs
* Then -
  * The action does not attempt to deploy or raise a PR
  * A GitHub 'failure' commit status (context `DeployTestAction`) is raised on `uat[HEAD]`
  * This should not occur in practice — the TestGate that governed the merge into `uat` already validated the commit message; this is a defensive check, not a routine path

### 3.4 The Deploy Test Action deploys the test environment
* Given -
  * A push to `uat`
  * `{ref}` was successfully derived from `uat[HEAD]`
* When - the action runs
* Then -
  * The action runs the (stubbed) deploy-to-test step for `uat[HEAD]`

### 3.5 The Deploy Test Action does not raise a PR if the deploy step fails
* Given -
  * A push to `uat`
  * `{ref}` was successfully derived from `uat[HEAD]`
  * The deploy-to-test step fails
* When - the action runs
* Then -
  * The action does not raise a PR to `main`
  * A GitHub 'failure' commit status (context `DeployTestAction`) is raised on `uat[HEAD]`

### 3.6 The Deploy Test Action raises a PR from uat to main after a successful deploy
* Given -
  * A push to `uat`
  * `{ref}` was successfully derived from `uat[HEAD]`
  * The deploy-to-test step succeeds
  * No open PR from `uat` to `main` already exists
* When - the action runs
* Then -
  * A PR from `uat` to `main` is raised
  * The PR title starts with `{ref}` and includes a description, taken from the subject of `uat[HEAD]`
  * The PR body includes the full message of `uat[HEAD]` (the squashed specification+test+build, or task, commit message)
  * A GitHub 'success' commit status (context `DeployTestAction`) is raised on `uat[HEAD]`

### 3.7 The Deploy Test Action does not raise a duplicate PR
* Given -
  * A push to `uat`
  * `{ref}` was successfully derived from `uat[HEAD]`
  * The deploy-to-test step succeeds
  * An open PR from `uat` to `main` already exists
* When - the action runs
* Then -
  * No new PR is raised
  * A GitHub 'success' commit status (context `DeployTestAction`) is raised on `uat[HEAD]`
