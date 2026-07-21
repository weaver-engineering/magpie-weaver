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
