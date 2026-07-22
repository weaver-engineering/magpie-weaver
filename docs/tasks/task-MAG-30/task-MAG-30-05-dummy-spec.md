# Task MAG-30 -Build Gate Specification 

**Companion to:** `task-MAG-30.md`
**Governs phases:** `test`, `build`
**Gate model:** Architecture Definition Document, Guard Rails §1/§2 — Test
phase may only touch the test package; Build phase may only touch
implementation code. New tests must fail against the pre-implementation
codebase and pass, unmodified, after implementation (fail-then-pass rule).

## 1. Interface Under Test
`pnpm gate-check <check-name> --json` run from anywhere within `magpie-weaver` 

It executes the PR validation step `<check-name>` to assert whether the change would pass the PR gates.

### 1.1 Expected Outputs
* stdout - json document like
```typescript
export interface GateCheckResult {
  check: string,                                               // value = <check-name>
  args: Record<string, boolean | number | string | string[]>   // the arguemnts passed to the check
  passed: boolean,                                             // true if the check passed
  messages: string[],                                          // a list of the info messages emitted by the check 
  violations: string[],                                        // a list of the violations encountered by the check
  summary: string                                              // a summary of state of the check, e.g. "N of M checks passed OK. Some checks failed. Failed!"
  values: Record<string, boolean | number | string | string[]> // named values to be passed to other checks
}
```
* stderr - all logging and debugging so as not to pollute the json output.
* return value - 0 if passed, 1 if failed, 2 if invalid arguments.
 
## 2. Deliverable
This spec delivers the pnpm `gate-check` checks and unit test coverage:
* `pr-and-branch-refs`
* `pr-title`
* `get-inbound-commits`
* `validate-spec-commit`
* `validate-test-commit`
* `validate-build-commit`
* `validate-task-commit`
* `existing-test-pass`
* `new-tests-fail`
* `coverage`

### 2.1 Deliverable Notes For Agent

## 3. Required Behaviors
* A valid task ref `{ref}` matches regex `[A-Z]+-[0-9]+`
* All references to `{ref}` in this spec refer to text matching the above regex.
* Every check returns a `GateCheckResult` via stdout when `--json` is given
* Every check exits 0 for pass, 1 for fail, 2 for invalid arguments
* Every check logs its name in `check`, its arguments in `args`, and its exposed values in `values`
* Every check logs informational messages in `messages` and violations in `violations`
* Argument names without values are interpreted as `boolean true`
* Multiple values for a single argument name are interpreted as `string[]`
* Numerical argument values are interpreted as `number` unless there are many when they are interpreted as `string[]`

The following sections define the specific conditions and behaviors of each gate check.
Each section defines:
* Given - A bullet list of the entry conditions of the behavior
* Either
  * When & Then - When is the action invoking the behavior. Then is a bullet list of expected outcomes of the behavior.
  * One or more sub sections also with Given and (When & Then) or more sub sections.
* The nested sections, each with a `* Given` bullet list define cumulative conditions.

### 3.1 pr-and-branch-refs

#### 3.1.1 Valid Head Ref and Base Ref

* Given
  * The check `pr-and-branch-refs` is invoked
  * `--head-ref` is a branch reference matching `*/{ref}`
  * `--pr-base-ref` is a branch reference matching `build/{ref}`
  * The `{ref}` extracted from both arguments is identical and matches `[A-Z]+-[0-9]+`
* When - the check executes
* Then -
  * `passed` is `true`
  * `args` contains `head-ref` and `pr-base-ref` with their values
  * `values` contains `ref` set to the extracted `{ref}`
  * `violations` is empty
  * exit code 0

#### 3.1.2 Mismatched Refs

* Given
  * The check `pr-and-branch-refs` is invoked
  * `--head-ref` matches `*/{ref1}`
  * `--pr-base-ref` matches `build/{ref2}`
  * `{ref1}` is not equal to `{ref2}`
* When - the check executes
* Then -
  * `passed` is `false`
  * `violations` contains a message describing the ref mismatch
  * exit code 1

#### 3.1.3 Invalid Head Ref Format

* Given
  * The check `pr-and-branch-refs` is invoked
  * `--head-ref` does not match `*/{ref}`
* When - the check executes
* Then -
  * `passed` is `false`
  * `violations` contains a message describing the invalid head ref format
  * exit code 1

#### 3.1.4 Invalid Base Ref Format

* Given
  * The check `pr-and-branch-refs` is invoked
  * `--pr-base-ref` does not match `build/{ref}`
* When - the check executes
* Then -
  * `passed` is `false`
  * `violations` contains a message describing the invalid base ref format
  * exit code 1

#### 3.1.5 Ref Does Not Match Pattern

* Given
  * The check `pr-and-branch-refs` is invoked
  * `--head-ref` matches `*/{ref}`
  * `--pr-base-ref` matches `build/{ref}`
  * The extracted `{ref}` does not match `[A-Z]+-[0-9]+`
* When - the check executes
* Then -
  * `passed` is `false`
  * `violations` contains a message describing that `{ref}` does not match the required pattern
  * exit code 1

#### 3.1.6 Missing Required Arguments

* Given
  * The check `pr-and-branch-refs` is invoked
  * Either `--head-ref` or `--pr-base-ref` is not provided
* When - the check executes
* Then -
  * `passed` is `false`
  * `violations` contains a message listing the missing required arguments
  * exit code 2

### 3.2 pr-title

#### 3.2.1 PR Title Contains Ref

* Given
  * The check `pr-title` is invoked
  * `--ref` is a valid reference matching `[A-Z]+-[0-9]+`
  * The PR title contains the value of `--ref`
  * The PR title is accessible to the check
* When - the check executes
* Then -
  * `passed` is `true`
  * `args` contains `ref` with its value
  * `values` contains `pr-title` set to the PR title
  * `violations` is empty
  * exit code 0

#### 3.2.2 PR Title Does Not Contain Ref

* Given
  * The check `pr-title` is invoked
  * `--ref` is a valid reference
  * The PR title does not contain the value of `--ref`
* When - the check executes
* Then -
  * `passed` is `false`
  * `violations` contains a message stating the PR title is missing the reference
  * exit code 1

#### 3.2.3 Ref Does Not Match Pattern

* Given
  * The check `pr-title` is invoked
  * `--ref` does not match `[A-Z]+-[0-9]+`
* When - the check executes
* Then -
  * `passed` is `false`
  * `violations` contains a message describing that `--ref` does not match the required pattern
  * exit code 1

#### 3.2.4 Missing Required Arguments

* Given
  * The check `pr-title` is invoked
  * `--ref` is not provided
* When - the check executes
* Then -
  * `passed` is `false`
  * `violations` contains a message that `--ref` is required
  * exit code 2

### 3.3 get-inbound-commits

#### 3.3.1 Commits Present

* Given
  * The check `get-inbound-commits` is invoked
  * `--pr-base-sha` and `--pr-head-sha` are provided
  * `--pr-head-sha` differs from `--pr-base-sha`
* When - the check executes
* Then -
  * `passed` is `true`
  * `values` contains `commits` as a `string[]` of commit SHAs from `--pr-base-sha` to `--pr-head-sha`
  * `violations` is empty
  * exit code 0

#### 3.3.2 No Commits (Shas Equal)

* Given
  * The check `get-inbound-commits` is invoked
  * `--pr-base-sha` equals `--pr-head-sha`
* When - the check executes
* Then -
  * `passed` is `false`
  * `violations` contains a message stating no commits between the given refs
  * exit code 1

#### 3.3.3 Missing Required Arguments

* Given
  * The check `get-inbound-commits` is invoked
  * Either `--pr-base-sha` or `--pr-head-sha` is not provided
* When - the check executes
* Then -
  * `passed` is `false`
  * `violations` contains a message listing the missing required arguments
  * exit code 2

### 3.4 validate-spec-commit

#### 3.4.1 Valid Spec Commit

* Given
  * The check `validate-spec-commit` is invoked
  * `--spec-commit-sha` is provided
  * The commit message title starts with `{ref}`
  * The commit message title continues beyond `{ref}`
  * The commit message body is not empty
  * `docs/tasks/task-{ref}` exists and is a directory
  * Changes only exist in `docs/tasks/task-{ref}`
  * `docs/tasks/task-{ref}/task-{ref}.md` exists and is a file
  * At least 1 specification file exists in `docs/tasks/task-{ref}` matching `^task-[A-Z]+-[0-9]+(-[0-9]+)?(-[a-z])?-spec\.md$`
* When - the check executes
* Then -
  * `passed` is `true`
  * `values` contains `task` set to `docs/tasks/task-{ref}/task-{ref}.md`
  * `values` contains `specs` set to a `string[]` of specification file paths
  * `violations` is empty
  * exit code 0

#### 3.4.2 Invalid Commit Message Title

##### 3.4.2.1 Title Does Not Start With Ref

* Given
  * The condition of §3.4
  * The commit message title does not start with `{ref}`
* When - the check executes
* Then -
  * `passed` is `false`
  * `violations` contains a message stating the title must start with `{ref}`
  * exit code 1

##### 3.4.2.2 Title Is Only Ref

* Given
  * The condition of §3.4
  * The commit message title starts with `{ref}`
  * The commit message title does not continue beyond `{ref}`
* When - the check executes
* Then -
  * `passed` is `false`
  * `violations` contains a message stating the title must continue beyond `{ref}`
  * exit code 1

##### 3.4.2.3 Empty Body

* Given
  * The condition of §3.4
  * The commit message title starts with `{ref}` and continues beyond it
  * The commit message body is empty
* When - the check executes
* Then -
  * `passed` is `false`
  * `violations` contains a message stating the body must not be empty
  * exit code 1

#### 3.4.3 Task Directory Missing or Invalid

##### 3.4.3.1 Task Directory Does Not Exist

* Given
  * The condition of §3.4
  * The commit message is valid
  * `docs/tasks/task-{ref}` does not exist
* When - the check executes
* Then -
  * `passed` is `false`
  * `violations` contains a message stating the task directory is missing
  * exit code 1

##### 3.4.3.2 Task Directory Is Not a Directory

* Given
  * The condition of §3.4
  * The commit message is valid
  * `docs/tasks/task-{ref}` exists but is not a directory
* When - the check executes
* Then -
  * `passed` is `false`
  * `violations` contains a message stating the task path is not a directory
  * exit code 1

#### 3.4.4 Changes Outside Task Directory

* Given
  * The condition of §3.4
  * The commit message is valid
  * `docs/tasks/task-{ref}` exists and is a directory
  * The commit changes files outside `docs/tasks/task-{ref}`
* When - the check executes
* Then -
  * `passed` is `false`
  * `violations` contains a message listing files changed outside the task directory
  * exit code 1

#### 3.4.5 Task File Missing or Invalid

##### 3.4.5.1 Task File Does Not Exist

* Given
  * The condition of §3.4
  * The commit message is valid
  * `docs/tasks/task-{ref}` exists and is a directory
  * Changes are restricted to `docs/tasks/task-{ref}`
  * `docs/tasks/task-{ref}/task-{ref}.md` does not exist
* When - the check executes
* Then -
  * `passed` is `false`
  * `violations` contains a message stating the task file is missing
  * exit code 1

##### 3.4.5.2 Task File Is Not a File

* Given
  * The condition of §3.4
  * The commit message is valid
  * `docs/tasks/task-{ref}` exists and is a directory
  * Changes are restricted to `docs/tasks/task-{ref}`
  * `docs/tasks/task-{ref}/task-{ref}.md` exists but is not a file
* When - the check executes
* Then -
  * `passed` is `false`
  * `violations` contains a message stating the task path is not a file
  * exit code 1

#### 3.4.6 No Specification Files

* Given
  * The condition of §3.4
  * The commit message is valid
  * `docs/tasks/task-{ref}` exists and is a directory
  * Changes are restricted to `docs/tasks/task-{ref}`
  * `docs/tasks/task-{ref}/task-{ref}.md` exists and is a file
  * No file in `docs/tasks/task-{ref}` matches `^task-[A-Z]+-[0-9]+(-[0-9]+)?(-[a-z])?-spec\.md$`
* When - the check executes
* Then -
  * `passed` is `false`
  * `violations` contains a message stating no specification file was found
  * exit code 1

#### 3.4.7 Missing Required Arguments

* Given
  * The check `validate-spec-commit` is invoked
  * `--spec-commit-sha` is not provided
* When - the check executes
* Then -
  * `passed` is `false`
  * `violations` contains a message that `--spec-commit-sha` is required
  * exit code 2

### 3.5 validate-test-commit

#### 3.5.1 Valid Test Commit

* Given
  * The check `validate-test-commit` is invoked
  * `--test-commit-sha` is provided
  * The commit message title starts with `{ref}`
  * The commit message title continues beyond `{ref}`
  * The commit message body is not empty
  * The commit only changes files in `test` directory or to `package.json`, `pnpm-lock.yaml`
  * The commit does not change existing tests
  * The commit defines a new test in `test` directory
* When - the check executes
* Then -
  * `passed` is `true`
  * `values` contains `existingTests` as a `string[]` of existing test paths
  * `values` contains `newTests` as a `string[]` of new test paths
  * `violations` is empty
  * exit code 0

#### 3.5.2 Invalid Commit Message

##### 3.5.2.1 Title Does Not Start With Ref

* Given
  * The condition of §3.5
  * The commit message title does not start with `{ref}`
* When - the check executes
* Then -
  * `passed` is `false`
  * `violations` contains a message stating the title must start with `{ref}`
  * exit code 1

##### 3.5.2.2 Title Is Only Ref

* Given
  * The condition of §3.5
  * The commit message title starts with `{ref}`
  * The commit message title does not continue beyond `{ref}`
* When - the check executes
* Then -
  * `passed` is `false`
  * `violations` contains a message stating the title must continue beyond `{ref}`
  * exit code 1

##### 3.5.2.3 Empty Body

* Given
  * The condition of §3.5
  * The commit message title starts with `{ref}` and continues beyond it
  * The commit message body is empty
* When - the check executes
* Then -
  * `passed` is `false`
  * `violations` contains a message stating the body must not be empty
  * exit code 1

#### 3.5.3 Changes Outside Allowed Paths

* Given
  * The condition of §3.5
  * The commit message is valid
  * The commit changes files outside `test/`, `package.json`, and `pnpm-lock.yaml`
* When - the check executes
* Then -
  * `passed` is `false`
  * `violations` contains a message listing files changed outside the allowed paths
  * exit code 1

#### 3.5.4 Changes Existing Tests

* Given
  * The condition of §3.5
  * The commit message is valid
  * The commit changes files only within the allowed paths
  * The commit modifies an existing test file in `test/`
* When - the check executes
* Then -
  * `passed` is `false`
  * `violations` contains a message stating existing tests must not be changed
  * exit code 1

#### 3.5.5 No New Tests Defined

* Given
  * The condition of §3.5
  * The commit message is valid
  * The commit changes files only within the allowed paths
  * The commit does not change existing tests
  * The commit does not add any new test file in `test/`
* When - the check executes
* Then -
  * `passed` is `false`
  * `violations` contains a message stating a new test must be defined
  * exit code 1

#### 3.5.6 Missing Required Arguments

* Given
  * The check `validate-test-commit` is invoked
  * `--test-commit-sha` is not provided
* When - the check executes
* Then -
  * `passed` is `false`
  * `violations` contains a message that `--test-commit-sha` is required
  * exit code 2

### 3.6 validate-build-commit

#### 3.6.1 Valid Build Commit

* Given
  * The check `validate-build-commit` is invoked
  * `--build-commit-sha` is provided
  * The commit message title starts with `{ref}`
  * The commit message title continues beyond `{ref}`
  * The commit message body is not empty
  * The commit only changes files in `apps` or `packages` directory or to `package.json`, `pnpm-lock.yaml`
* When - the check executes
* Then -
  * `passed` is `true`
  * `values` contains `newFiles` as a `string[]` of new file paths
  * `values` contains `modifiedFiles` as a `string[]` of modified file paths
  * `values` contains `deletedFiles` as a `string[]` of deleted file paths
  * `violations` is empty
  * exit code 0

#### 3.6.2 Invalid Commit Message

##### 3.6.2.1 Title Does Not Start With Ref

* Given
  * The condition of §3.6
  * The commit message title does not start with `{ref}`
* When - the check executes
* Then -
  * `passed` is `false`
  * `violations` contains a message stating the title must start with `{ref}`
  * exit code 1

##### 3.6.2.2 Title Is Only Ref

* Given
  * The condition of §3.6
  * The commit message title starts with `{ref}`
  * The commit message title does not continue beyond `{ref}`
* When - the check executes
* Then -
  * `passed` is `false`
  * `violations` contains a message stating the title must continue beyond `{ref}`
  * exit code 1

##### 3.6.2.3 Empty Body

* Given
  * The condition of §3.6
  * The commit message title starts with `{ref}` and continues beyond it
  * The commit message body is empty
* When - the check executes
* Then -
  * `passed` is `false`
  * `violations` contains a message stating the body must not be empty
  * exit code 1

#### 3.6.3 Changes Outside Allowed Paths

* Given
  * The condition of §3.6
  * The commit message is valid
  * The commit changes files outside `apps/`, `packages/`, `package.json`, and `pnpm-lock.yaml`
* When - the check executes
* Then -
  * `passed` is `false`
  * `violations` contains a message listing files changed outside the allowed paths
  * exit code 1

#### 3.6.4 Missing Required Arguments

* Given
  * The check `validate-build-commit` is invoked
  * `--build-commit-sha` is not provided
* When - the check executes
* Then -
  * `passed` is `false`
  * `violations` contains a message that `--build-commit-sha` is required
  * exit code 2

### 3.7 validate-task-commit

#### 3.7.1 Valid Task Commit

* Given
  * The check `validate-task-commit` is invoked
  * `--task-commit-sha` is provided
  * The commit message title starts with `{ref}`
  * The commit message title continues beyond `{ref}`
  * The commit message body is not empty
* When - the check executes
* Then -
  * `passed` is `true`
  * `values` contains `newFiles` as a `string[]` of new file paths
  * `values` contains `modifiedFiles` as a `string[]` of modified file paths
  * `values` contains `deletedFiles` as a `string[]` of deleted file paths
  * `values` contains `newTests` as a `string[]` of new test file paths
  * `values` contains `modifiedTests` as a `string[]` of modified test file paths
  * `values` contains `deletedTests` as a `string[]` of deleted test file paths
  * `violations` is empty
  * exit code 0

#### 3.7.2 Invalid Commit Message

##### 3.7.2.1 Title Does Not Start With Ref

* Given
  * The condition of §3.7
  * The commit message title does not start with `{ref}`
* When - the check executes
* Then -
  * `passed` is `false`
  * `violations` contains a message stating the title must start with `{ref}`
  * exit code 1

##### 3.7.2.2 Title Is Only Ref

* Given
  * The condition of §3.7
  * The commit message title starts with `{ref}`
  * The commit message title does not continue beyond `{ref}`
* When - the check executes
* Then -
  * `passed` is `false`
  * `violations` contains a message stating the title must continue beyond `{ref}`
  * exit code 1

##### 3.7.2.3 Empty Body

* Given
  * The condition of §3.7
  * The commit message title starts with `{ref}` and continues beyond it
  * The commit message body is empty
* When - the check executes
* Then -
  * `passed` is `false`
  * `violations` contains a message stating the body must not be empty
  * exit code 1

#### 3.7.3 Missing Required Arguments

* Given
  * The check `validate-task-commit` is invoked
  * `--task-commit-sha` is not provided
* When - the check executes
* Then -
  * `passed` is `false`
  * `violations` contains a message that `--task-commit-sha` is required
  * exit code 2

### 3.8 existing-tests-pass

#### 3.8.1 All Existing Tests Pass

* Given
  * The check `existing-tests-pass` is invoked
  * Coverage has been run (via `runTestsWithCoverage`)
  * All existing tests pass
* When - the check executes
* Then -
  * `passed` is `true`
  * `values` contains `numTests` set to the total number of tests
  * `values` contains `numTestFailures` set to 0
  * `values` contains `failingTests` as an empty `string[]`
  * `violations` is empty
  * exit code 0

#### 3.8.2 Some Existing Tests Fail

* Given
  * The check `existing-tests-pass` is invoked
  * Coverage has been run
  * One or more existing tests fail
* When - the check executes
* Then -
  * `passed` is `false`
  * `values` contains `numTests` set to the total number of tests
  * `values` contains `numTestFailures` set to the number of failing tests
  * `values` contains `failingTests` as a `string[]` of paths to failing tests
  * `violations` contains a message listing the failing tests
  * exit code 1

#### 3.8.3 Coverage Not Run

* Given
  * The check `existing-tests-pass` is invoked
  * Coverage has not been run
* When - the check executes
* Then -
  * `passed` is `false`
  * `violations` contains a message stating coverage must be run first
  * exit code 1

### 3.9 new-tests-fail

#### 3.9.1 At Least One New Test Fails

* Given
  * The check `new-tests-fail` is invoked
  * Coverage has been run
  * At least one new test fails
* When - the check executes
* Then -
  * `passed` is `true`
  * `values` contains `numTests` set to total number of new tests
  * `values` contains `numTestFailures` set to number of new test failures
  * `values` contains `newTests` as a `string[]` of new test paths
  * `values` contains `newTestFailures` as a `string[]` of failed new test paths
  * `violations` is empty
  * exit code 0

#### 3.9.2 No New Tests Fail

* Given
  * The check `new-tests-fail` is invoked
  * Coverage has been run
  * No new tests fail (all new tests pass)
* When - the check executes
* Then -
  * `passed` is `false`
  * `values` contains `numTests` set to total number of new tests
  * `values` contains `numTestFailures` set to 0
  * `violations` contains a message stating at least one new test must fail
  * exit code 1

#### 3.9.3 No New Tests Defined

* Given
  * The check `new-tests-fail` is invoked
  * Coverage has been run
  * No new tests are defined
* When - the check executes
* Then -
  * `passed` is `false`
  * `violations` contains a message stating no new tests were found
  * exit code 1

#### 3.9.4 Coverage Not Run

* Given
  * The check `new-tests-fail` is invoked
  * Coverage has not been run
* When - the check executes
* Then -
  * `passed` is `false`
  * `violations` contains a message stating coverage must be run first
  * exit code 1

### 3.10 coverage

#### 3.10.1 Coverage Thresholds Met

* Given
  * The check `coverage` is invoked
  * `--expect-failure` is not set or is `false`
  * Coverage has been run
  * New line coverage is greater than 90%
  * Line coverage is greater than 80%
* When - the check executes
* Then -
  * `passed` is `true`
  * `values` contains `lineCoverage` as the percentage line coverage
  * `values` contains `newLineCoverage` as the percentage new line coverage
  * `violations` is empty
  * exit code 0

#### 3.10.2 New Line Coverage Below Threshold

* Given
  * The check `coverage` is invoked
  * `--expect-failure` is not set or is `false`
  * Coverage has been run
  * New line coverage is 90% or below
* When - the check executes
* Then -
  * `passed` is `false`
  * `violations` contains a message stating the new line coverage threshold was not met
  * `values` contains `newLineCoverage` as the percentage new line coverage
  * exit code 1

#### 3.10.3 Line Coverage Below Threshold

* Given
  * The check `coverage` is invoked
  * `--expect-failure` is not set or is `false`
  * Coverage has been run
  * New line coverage is greater than 90%
  * Line coverage is 80% or below
* When - the check executes
* Then -
  * `passed` is `false`
  * `violations` contains a message stating the line coverage threshold was not met
  * `values` contains `lineCoverage` as the percentage line coverage
  * exit code 1

#### 3.10.4 Expect Failure With Failing Tests

* Given
  * The check `coverage` is invoked
  * `--expect-failure` is `true`
  * Tests fail (non-zero exit)
* When - the check executes
* Then -
  * `passed` is `true`
  * exit code 0

#### 3.10.5 Expect Failure With Passing Tests

* Given
  * The check `coverage` is invoked
  * `--expect-failure` is `true`
  * All tests pass (zero exit)
* When - the check executes
* Then -
  * `passed` is `false`
  * `violations` contains a message stating tests were expected to fail but passed
  * exit code 1

#### 3.10.6 Coverage Not Run

* Given
  * The check `coverage` is invoked
  * Coverage has not been run
* When - the check executes
* Then -
  * `passed` is `false`
  * `violations` contains a message stating coverage must be run first
  * exit code 1

#### 3.10.7 Missing Required Arguments

* Given
  * The check `coverage` is invoked
  * `--expect-failure` is not provided
* When - the check executes
* Then -
  * `passed` is `false`
  * `violations` contains a message that `--expect-failure` is required
  * exit code 2
