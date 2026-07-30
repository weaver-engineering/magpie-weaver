# Task MAG-40 — OpenCode configuration

**State:** Done
**Phase:** task (quick route)
**Component:** Development tooling
**Depends on:** none
**Related design docs:**
- `magpieweaver-docs/docs/architecture/opencode/open-code-agent-tools.md`
- `magpieweaver-docs/docs/architecture/opencode/open-code-sub-agents.md`
- `magpieweaver-docs/docs/architecture/opencode/orchestrating-sub-agent-flows.md`
- `magpieweaver-docs/docs/architecture/opencode/standard-chat-requests.md`
- `magpieweaver-docs/docs/architecture/opencode/standard-chat-handover-responses.md`
- `magpieweaver-docs/docs/architecture/opencode/test-writer-instructions.md`
- `magpieweaver-docs/docs/architecture/opencode/build-implementer-instructions.md`
- `magpieweaver-docs/docs/architecture/opencode/quick-scaffolder-instructions.md`

---

## 1. Summary

Set up the OpenCode configuration for the three phase-owning sub-agents
(`test-writer`, `build-implementer`, `quick-scaffolder`) and the
`gate-check` custom tool, per the design agreed in the
`opencode-configuration` chat.

## 2. Why this task, why now

The docs describe the agreed sub-agent roster, their permission scoping,
and the `gate-check` tool that wraps the already-real `pnpm gate-check`
CLI. This task turns those design docs into the actual `.opencode/`
configuration so the agents can be invoked.

## 3. In Scope

- `.opencode/agent/test-writer.md` — standing instructions copied
  verbatim from `test-writer-instructions.md`; permission frontmatter
  adapted from it (see §3a — the exact matrix required changes to
  actually work under real OpenCode).
- `.opencode/agent/build-implementer.md` — standing instructions copied
  verbatim from `build-implementer-instructions.md`; permission
  frontmatter adapted from it (§3a).
- `.opencode/agent/quick-scaffolder.md` — standing instructions copied
  verbatim from `quick-scaffolder-instructions.md`; permission
  frontmatter adapted from it (§3a).
- `.opencode/tool/gate-check.ts` — wraps `pnpm gate-check <checkName>
  --json --ref <ref>`, returning the parsed `GateCheckResult` (matches
  the real `test-gate`/`build-gate`/`main-gate` checks already in
  `packages/gate-checks`).
- `.opencode/tool/session-info.ts` — returns the real `sessionID` from the
  tool's `ToolContext` (see §3c — agents have no other way to learn it).

## 3a. Permission frontmatter deviations from the docs (real-world fixes)

The docs' `permission.bash`/`permission.edit` matrices, copied verbatim,
did not work as written against real OpenCode (v1.18.9). Two independent
problems, found by testing interactively against `quick-scaffolder` and
confirmed via `~/.local/share/opencode/log/opencode.log`'s
`evaluated permission=bash` trace lines:

1. **Rule order, not specificity, decides the winner.** OpenCode
   evaluates permission patterns in declaration order and the
   **last matching rule wins** (`findLast()` semantics) — confirmed
   directly by OpenCode maintainers on `anomalyco/opencode#6856`. The
   docs' matrices all declared the `"*"` catch-all **last**, which —
   since `"*"` matches every command — silently overrode every specific
   `allow`/`deny` rule above it. Fixed by moving `"*"` to be declared
   **first** in every `permission.edit`/`permission.bash` map, with
   specific rules declared after it (this also fixes a latent bug in
   `build-implementer`'s original ordering, where its `"*": deny` would
   have overridden its own `packages/**`/`apps/**` allows).
2. **A suspected second bug (flag-bearing git commands not matching
   per-verb wildcards) turned out to be fully explained by (1).** Before
   the ordering bug was understood, the docs' per-verb git allow-list
   (`git status*`, `git fetch*`, ...) was temporarily collapsed to a
   single `"git *": allow` in all three agents, on the theory that a
   separate tree-sitter tokenization bug (`anomalyco/opencode#6676`,
   real, but affecting *other* reported commands like `kill -9 PID`) was
   also breaking flag-bearing git commands here. Once (1) was fixed and
   re-tested, the original per-verb allow-list (`git status*`,
   `git fetch*`, `git switch*`, `git log*`, `git diff*`,
   `git merge-base*`, `git rebase*`, `git add*`, `git commit*`,
   `git push*`) was restored, plus `git rev-parse*` and `git branch*`
   (needed for OpenCode's own internal branch-display calls, not
   anything the agents' own standing instructions invoke). The narrower,
   docs-specified allow-list is the current, correctly-ordered
   configuration — not the `"git *"` blanket.

`gh`/`pnpm` permission patterns are left as the docs specify (per-command,
not broadened) — they haven't been observed to hit either bug.

3. **Compound commands (`|`, `&&`) are evaluated segment-by-segment, and
   any one unmatched segment blocks the whole thing.** Confirmed via the
   same `evaluated permission=bash` log trace, for both connectors:
   `git diff main..task/MAG-40 -- docs/tasks/task-MAG-40/task-MAG-40.md |
   head -5` splits into `git diff ...` (matched `"git diff*"`, allowed)
   and `head -5` (matched nothing, asked); `git merge-base --is-ancestor
   origin/main main && echo OK` — literally the session-start protocol's
   own check, present in all three agents' §2 — splits into the
   `git merge-base` half (allowed) and `echo OK` (matched nothing,
   asked). Since these connectors are gated on their *least*-permissive
   segment, every routine use of `head`/`tail`/`grep`/`wc`/`cat`/`echo`
   alongside an already-allowed command would otherwise prompt. Added
   `"head*"`, `"tail*"`, `"grep*"`, `"wc*"`, `"cat*"`, and `"echo*"`
   (all read-only, non-mutating) to all three agents' `permission.bash`.
4. **`quick-scaffolder` was missing `"gh pr list*"`.** It needs to check
   for an existing PR before creating one, same as `build-implementer`
   already had. Added to bring it in line.
5. **`"git remote*"` was missing entirely.** Not a compound-command
   artifact this time — `git remote -v` alone fell straight to `"*"`.
   Read-only/informational, same category as the already-allowed
   `status`/`log`/`diff`. Added to all three agents.
6. **A third compound-command connector (`||`), and three more unmatched
   segments.** `test-writer`, investigating the MAG-46 design docs, ran
   `git ls-files --full-name <path> 2>/dev/null || find <dir> -name
   "<file>" -maxdepth 10 2>/dev/null || true` — same segment-by-segment
   evaluation as §3a.3, just with `||` instead of `|`/`&&`. All three
   segments (`git ls-files`, `find`, `true`) were individually unmatched.
   Added `"git ls-files*"` (alongside the other read-only git commands)
   and `"find*"`/`"true*"` (alongside the other read-only utilities) to
   all three agents. (A separate, unrelated `pnpm task --help` probe by
   the same agent was left asking deliberately — per §4, no `task-phases`
   CLI exists yet, so there is no standing reason to pre-allow it.)
7. **`"ls*"` was missing entirely.** `test-writer`, checking whether
   `test/packages/task-phases` and `packages/task-phases/dist/` exist
   yet (via `ls -la <dir> 2>/dev/null || echo "..."`), had both `ls`
   segments fall straight to `"*"` — plain missing pattern, same
   read-only/informational category as `head`/`cat`/`find`. Added to all
   three agents.
8. **`"pnpm --filter*"` was missing entirely — a new, real need, not
   just a missed pattern.** By the time `test-writer` was working
   MAG-46's spec 01, `packages/task-phases` existed (scaffolded by
   MAG-46 spec 00, merged into `main`), but a fresh agent worktree never
   has it *built* — `dist/` is gitignored, and `pnpm gate-check` itself
   needed the same manual `pnpm install && pnpm build` bootstrap the
   first time an agent worktree was created (see the `agentWorkTrees`
   setup notes). Agents need to be able to build a single workspace
   package themselves rather than needing manual intervention every
   time — `pnpm --filter @magpieweaver/task-phases build` was the
   observed case. Added `"pnpm --filter*"` (scoped to single-package
   operations, same risk profile as the already-allowed `pnpm test*`) to
   all three agents.
9. **`"mkdir*"` was missing entirely.** `test-writer` ran `mkdir -p
   test/packages/task-phases/deps` to lay out its test file structure —
   plain missing pattern, fell straight to `"*"`. Non-destructive (only
   creates directories; no delete, no overwrite), and actual file writes
   remain separately gated by `permission.edit` regardless of what bash
   does — same low-risk category as the other utilities. Added to all
   three agents.

## 3b. `gate-check` tool bugs found and fixed

Testing the tool interactively (agent asking "are we good to pass
main-gate?") surfaced two real bugs in `.opencode/tool/gate-check.ts`,
neither related to permissions:

1. **Wrong return shape.** The real `@opencode-ai/plugin` (v1.18.9,
   confirmed by reading the installed package's `dist/tool.d.ts`)
   requires `execute()` to return a `ToolResult` — `string | { output:
   string, title?, metadata? }` — not an arbitrary object. The original
   code returned the parsed `GateCheckResult` directly, with no `output`
   field, which crashed OpenCode's own result rendering (observed as
   `undefined is not an object (evaluating 'u.split')`) even though the
   underlying `pnpm gate-check` call itself succeeded. Fixed by wrapping
   the parsed result in `{ title, output: JSON.stringify(result, null,
   2), metadata: result }`.
2. **Failing checks threw instead of returning a structured result.**
   `pnpm gate-check` exits 1 when a check runs and fails (valid JSON
   already on stdout), which makes `execFile` reject the promise. The
   original code didn't catch this, so a genuine gate failure would have
   surfaced as a thrown tool error rather than the `passed: false`
   structured result `open-code-agent-tools.md` §2 requires. Fixed by
   catching the rejection, and — only when `err.code === 1` and `stdout`
   is non-empty — treating it as an ordinary result rather than an
   error. A separate real quirk this uncovered: `pnpm` appends its own
   `[ELIFECYCLE] Command failed with exit code 1.` banner to stdout
   *after* the JSON on that path, so only the first line of stdout is
   ever parsed as JSON, ignoring anything pnpm appends afterward.

Verified directly against the real CLI (bypassing OpenCode, invoking the
same logic standalone) for all three cases: a passing check, a genuinely
malformed invocation (unknown check name, still throws as intended), and
an actual failing check (`test-gate` on this branch, correctly returns
`passed: false` without throwing).

## 3c. `session-info` tool added — agents have no other way to learn their
own session ID

MAG-46's `test-writer` ended a session with a `sessionId` of `sess_001` in
its final JSON report — not a real session ID, just the literal placeholder
text (`sess_abc123`) from the examples in §6 of its own standing
instructions, lightly mangled. Investigated whether OpenCode gives agents
any real way to know their own session ID:

- Injecting the session ID into the shell command environment
  (`OPENCODE_SESSION_ID`) was proposed (`anomalyco/opencode#12158`) but
  never implemented — no branches or PRs against it.
- Injecting it into the agent's system prompt was proposed
  (`anomalyco/opencode#12324`) and explicitly **closed as not planned** by
  the maintainers.
- Neither is exposed via any documented CLI flag or SDK call an agent could
  reasonably invoke on itself.

So the agent had no way to satisfy the instruction as originally written —
this wasn't the agent being careless. The one place the real ID *is*
available: `ToolContext.sessionID`, passed as the second argument to every
custom tool's `execute()` (confirmed by reading
`@opencode-ai/plugin`'s installed `dist/tool.d.ts` directly, same source
that grounded the `gate-check.ts` fixes in §3b). Added
`.opencode/tool/session-info.ts`, a trivial tool that returns
`context.sessionID`, and added an explicit instruction to all three agents'
§6 ("call `session-info` before writing your final report; never invent or
copy the placeholder") so this is a mechanical step rather than something
the agent has to reason its way to correctly.

## 3d. Proactive permission additions (anticipating the remaining ~20 specs)

Rather than continuing purely reactively — one restart per newly-discovered
gap — added a base layer of low-risk, non-destructive commands likely to
come up across the remaining specs, before they're actually hit:

- `"git show*"`, `"git rev-list*"` — read-only, for inspecting a specific
  commit or commit range.
- `"git stash*"` — shelves changes without discarding them; safe and
  reversible, unlike the ops explicitly excluded below.
- `"git tag*"` — creates/lists simple ref pointers; not part of any
  documented workflow step yet, but low-risk enough to pre-allow.
- `"gh pr view*"`, `"gh pr diff*"`, `"gh pr checks*"` — read-only,
  for an agent to check the state of a PR it already raised.

Deliberately **not** added, and left on `ask` (or effectively blocked):
`git reset*`, `git clean*`, `git push --force*`, `gh pr merge*`. These
are destructive or write to shared/external state in ways that should
stay under human review — none of the standing instructions' own
protocols call for them, and broadening the allow-list here would cut
against the very PR-review-and-reject workflow gap this task surfaced (see
the architect's session notes: the current git-workflow design has no path
for the architect to reject a PR and send it back for rework — being
tracked as follow-on spec work, not fixed here).

(`git reset*` was subsequently narrowed and allowed as `"git reset
--hard*"` — §3p. `gh pr comment*`, deferred here, was subsequently
allowed too — §3ad — once the actual PR-review-and-reply cycle this note
anticipated became a concrete, live need rather than a hypothetical one.)

## 3e. `test-writer` opened its PR against `main` instead of `build/{ref}`
— a workflow gap, not a permission gap

MAG-46's `test-writer` ran `gh pr create --base build/MAG-46 --head
test/MAG-46 ...` per its own §6, but `build/MAG-46` didn't exist on origin,
so the PR landed against `main` instead (however the agent's `gh`
invocation falls back on a missing base — this wasn't a permission
prompt, so it happened silently).

Root cause: nothing in the documented pipeline creates `build/{ref}`
before `test-writer` needs it. `build-implementer`'s own protocol (§2,
step 4a: `git switch -c build/{ref} origin/build/{ref}`, guarded by "the
Build Gate PR has merged") assumes `origin/build/{ref}` already exists —
confirming `test-writer` is the one meant to create it, since the test
phase's PR *is* the "Build Gate" PR. This is the first PR in the
spec → test → build → main sequence, so there's no earlier stage to have
created it.

Fixed by adding an explicit step to `test-writer.md` §6, immediately
before `gh pr create`: check whether `build/{ref}` exists on origin
(`git ls-remote --exit-code origin build/{ref}`), and if not, create it.
Added `"git ls-remote*"` (read-only) to all three agents'
`permission.bash` to support the existence check.

**First attempt at this fix was itself wrong**, and shipped a second bug:
it created `build/{ref}` by pushing `spec/{ref}`'s tip to
`refs/heads/build/{ref}` — reasoning (wrongly) that since `test/{ref}` is
itself based on `spec/{ref}`, the PR would then show just the test commit
as its diff. Consequence: `test-writer` did exactly that for MAG-46
(`origin/build/MAG-46` created from `spec/MAG-46`), and `build-gate`
running on the PR in GitHub CI failed — it requires 2 commits (spec + test)
between `test/{ref}` and `build/{ref}`, but with `build/{ref}` already
sitting on the spec commit, the PR diff only contained the 1 test commit.

Corrected: `build/{ref}` must be created from **`origin/main`**, not
`spec/{ref}`. `build/{ref}` doesn't have *either* the spec or the test
commit yet at that point, so the PR (`test/{ref}` → `build/{ref}`) shows
both — satisfying `build-gate`'s 2-commit requirement. The instruction now
also states the reasoning inline (not just the command), specifically to
prevent an agent from "fixing" this back to the wrong form later. Still
idempotent: a resumed session where `build/{ref}` already exists skips
straight to `gh pr create`.

The already-raised MAG-46 PR (test/MAG-46 → main) and the wrongly-based
`origin/build/MAG-46` are not corrected here — left for the architect to
handle via the simulated review/rework cycle (session notes), consistent
with treating this as a workflow-design fix for future runs rather than a
retroactive repair of this one PR/branch.

This is also the concrete case for why `task-phases` (MAG-46 itself) is
worth building: encoding "create `build/{ref}` from `origin/main`, not
`spec/{ref}`" as a single tested CLI method removes an entire category of
mistake like this one — an LLM agent improvising the right git incantation
from freeform prose gets it wrong exactly this way; a function it just
calls can't.

## 3f. `"pnpm install*"` was missing entirely

`build-implementer`, starting fresh in its own worktree (`build/MAG-46`),
ran `pnpm install 2>&1 | tail -20` to bootstrap its dependencies — same
underlying cause as the `pnpm --filter*`/`§3d` gap: a fresh worktree
checkout never has `node_modules` populated, so every agent needs to be
able to install for itself rather than needing it done by hand each time.
`pnpm install` was the one bare invocation not yet covered by any existing
`pnpm *` pattern. Added `"pnpm install*"` to all three agents.

## 3g. `"sed -n*"` added — deliberately narrower than the other utility
patterns

`build-implementer` ran `sed -n '4690,4730p' node_modules/.pnpm/.../simple-git/dist/esm/index.js`
to read a line range of a dependency's source while implementing
`RealGitTool` — plain missing pattern, same as the other utilities.

Unlike `head`/`tail`/`cat`/`grep`/`find`/`ls`, `sed` is not purely
read-only — `sed -i` edits files in place, directly through the bash
tool, which would bypass `permission.edit` entirely (`build-implementer`'s
`"test/**": deny` and `"packages/**/*.interface.ts": deny` exist
specifically to stop it editing those paths — a blanket `"sed*": allow`
would hand back exactly that ability through a side door). Added
`"sed -n*"` instead of `"sed*"` — narrow enough to cover the observed
read-only use (printing a line range) without matching any `sed -i`
invocation, since those start `sed -i`, not `sed -n`. Added to all three
agents for consistency, though the risk this guards against is specific
to `build-implementer` and `test-writer` (both have real `edit` deny
rules to protect).

## 3h. `"python3 -c*"` added — a deliberate, discussed policy exception,
not a scoped-utility fix

`build-implementer` ran `python3 -c "<inline script>" 2>/dev/null` to parse
`packages/gate-checks/coverage/coverage-summary.json`. Unlike every other
addition in this section, there is no safe glob here: `sed -n*` could be
scoped narrowly because `-n` vs `-i` is a clean syntactic boundary, but
`python3 -c "..."` is arbitrary code execution with no equivalent
boundary — any pattern broad enough to match this legitimate read would
also match a script that writes files, spawns processes, or does
anything else a shell can do.

Put to the architect directly rather than resolved unilaterally. Decision:
add `"python3 -c*": allow` anyway, and accept the broadened risk, for a
stated architectural reason — the intended security boundary for these
agents is OS-level containment of their workspace (a harness restricting
what an agent can touch outside it, with "raise a PR that gets approved"
as the only sanctioned way out), not fine-grained shell-command
allow-listing. Fine-grained `permission.bash` patterns are a stopgap for
the current bootstrap phase, not the long-term control. Headless operation
is the actual goal — an agent that has to stop and ask a human just to
check a coverage summary isn't headless. Dedicated tooling (in the
`gate-check.ts`/`session-info.ts` mould) to remove the need for ad-hoc
scripting entirely is expected later, but isn't being built now.

## 3i. `"git init*"` and `"git config*"` were missing entirely

`build-implementer`, manually verifying git behaviour in a throwaway
sandbox (`magtest/`) while implementing `RealGitTool`, ran `git init`,
`git init --bare`, and `git config user.email`/`user.name`/
`commit.gpgsign false` — plain missing patterns, same read-only-adjacent
category as the rest of §3a/§3d: `git init` doesn't destroy existing
history (worst case, reinitializes an already-empty repo), and `git
config` only sets values, never deletes data. Notably, the `commit.gpgsign
false` here is the agent applying exactly the fix from the review comment
on the MAG-46 test PR (§ session notes) — proof the instruction landed.
Added `"git init*"` and `"git config*"` to all three agents.

The same compound command also included `rm -rf magtest` — genuinely
destructive, unlike everything else added in this task. Put to the
architect as a policy decision, same as `python3 -c` (§3h). Decision:
allow it, same rationale as §3h — the intended security boundary is
OS-level containment of the agent's workspace, not shell-command
allow-listing, so a fine-grained scope here (e.g. matching only
`rm -rf magtest*`) would be false comfort rather than real protection.
Added `"rm -rf*": allow` to all three agents.

## 3j. `"node*"` added — same policy, applied directly rather than re-asked

`build-implementer` ran `node <absolute-path>/packages/task-phases/dist/cli.js
--dev-testing git branchExists -i` — invoking the project's own built CLI
directly against its sandbox repo (exactly the `--dev-testing` entry
point's intended use, mirroring what `git-basics.test.ts` itself does via
`execFileSync("node", [cliPath, ...])`). `node <script>` is the same
arbitrary-code-execution risk class as `python3 -c` — and here there
isn't even a portable narrow glob available, since the absolute path to
`dist/cli.js` differs per agent worktree. Rather than raise this as a
third separate policy question, applied the architect's already-stated
decision from §3h/§3i directly: `"node*": allow` added to all three
agents.

## 3k. `"git check-ignore*"` was missing entirely

`build-implementer` ran `git check-ignore packages/task-phases/dist/cli.js`
to confirm `dist/` is gitignored before deciding it was safe to build
locally without polluting a commit — plain missing pattern, read-only
(only reports whether a path is ignored, never modifies anything). Added
to all three agents.

## 3l. `"pnpm exec eslint*"` was missing entirely

`build-implementer` ran `pnpm exec eslint packages/task-phases/src/deps/git.ts`
to lint its own new code — plain missing pattern, same low-risk category
as the already-allowed `pnpm test*`. Added to all three agents.

## 3m. `test-writer` was missing `"gh pr list*"`

Same gap as §3a.4 (`quick-scaffolder` missing `gh pr list*`), just never
extended to `test-writer` at the time — it only ever had `gh pr create*`.
Surfaced when `test-writer`, on spec 02, checked existing PR state before
proceeding. Added `"gh pr list*"` to `test-writer` (already present on the
other two agents).

## 3n. `"git ls-tree*"` was missing entirely

`test-writer`, resumed after `spec/MAG-46` was deliberately amended
(architect correction to §3.3.1's repo-root-bounded wording, to test
self-handled rebase-forward), ran `git ls-tree -r --name-only <commit> --
test/` to compare what test files existed at different commits while
re-deriving state — plain missing pattern, read-only (only lists a
commit's tree, never modifies anything). Added to all three agents.

## 3o. `build-implementer`'s own reorder instruction (§2 step 6) was a
real bug, not just a permission gap

The deliberate spec-01 amendment cascaded further than the `test-writer`
rebase-forward alone: `test-writer` correctly rebased `test/MAG-46` onto
the amended `spec/MAG-46`, but `build-implementer` had already merged the
*old* spec+test into `build/MAG-46` (via the already-merged Build Gate
PR) and committed its own implementation on top of that old
understanding. The new Build Gate PR (`test/MAG-46` → `build/MAG-46`)
came back from GitHub as `CONFLICTING` — old and new spec/test are
sibling histories from the same base, not a linear continuation, so
GitHub can't reconcile them as a normal merge.

`build-implementer.md`'s own §2 step 6 said `git rebase origin/build/{ref}`
— a **plain** rebase. That would have replayed the old spec commit, the
old test commit, *and* the agent's own commit onto the new base, producing
duplicate/conflicting spec and test commits rather than the clean 3-commit
history `main-gate` requires. This was true regardless of the permission
work in this task — a real bug in the standing instructions themselves,
only surfaced because this session happened to hit the case.

Fixed by replacing step 6 with a `git rebase --onto <base> HEAD~1`
transplant: since `build-implementer` never touches `test/**` or the spec
doc (§3's exclusions), its own commit doesn't overlap with whatever
changed between old and new spec/test, so transplanting just that one
commit onto the current tip applies with no git-level conflict — the
only remaining work is updating the implementation if it no longer
satisfies the (possibly-changed) tests, which is ordinary "make the
failing test pass" work, not conflict resolution. Also handles the
specific case hit here: the newer Build Gate PR wasn't a clean merge into
`origin/build/{ref}` at all (it's the PR that's `CONFLICTING`) — the
instruction now names `test/{ref}` directly as the transplant target when
that's the situation, rather than assuming `origin/build/{ref}` always
carries the update.

## 3p. `"git reset --hard*"` added — same already-established policy

`build-implementer`, resuming into the reorder scenario above, chose a
different (also valid) resolution than the `--onto` transplant: reset
`build/MAG-46` directly to `test/MAG-46`'s current tip
(`git reset --hard cbe8c7c`), discarding its own stale implementation
commit entirely rather than transplanting it, planning to re-implement
from scratch against the corrected tests. `git reset --hard` is
destructive by nature — same policy category as `python3 -c`/`rm -rf`/
`node*` (§3h/§3i/§3j). Applied the same already-established decision
directly: OS-level containment of the agent's workspace is the intended
security boundary, not shell-command allow-listing. Added
`"git reset --hard*"` to all three agents.

## 3q. `"git cherry-pick*"` was missing entirely

Continuing the same reorder: having reset `build/MAG-46` to `test/MAG-46`'s
tip, `build-implementer` ran `git cherry-pick de579e2` to re-apply its own
old implementation commit rather than rewriting it from scratch — a
different, also-valid route to the same transplant `--onto` was meant to
achieve. Plain missing pattern, same risk profile as the already-allowed
`git rebase*` (applies an existing commit's diff; not fundamentally more
dangerous). Added to all three agents.

## 3r. `"gh pr edit*"` and `"gh pr close*"` were missing entirely

Finishing the reorder, `build-implementer` ran `gh pr edit 39` to update
PR #39's description to describe the amended-spec reorder, and `gh pr
close 40` to close the now-superseded test→build PR (its content is
already fully contained in the reordered `build/MAG-46`) — exactly the
cleanup anticipated when the conflict was first diagnosed. Both plain
missing patterns, same low-risk category as the already-allowed `gh pr
view*`/`diff*`/`checks*` — neither merges or deletes anything; closing a
PR is reversible (can be reopened). Added to all three agents.

## 3s. `"gh --version*"`, `"gh auth status*"`, `"gh api user*"` were
missing entirely

`test-writer`, beginning spec 03 (the `GitHubTool` wrapper spec), checked
its own `gh` tooling/auth/identity before writing tests that exercise real
`gh` calls — plain missing patterns, all read-only diagnostics. Scoped
`"gh api user*"` narrowly rather than a blanket `"gh api*"`, since `gh
api` can hit arbitrary GitHub endpoints (including mutating ones); this
task only needs the read-only identity check. Added all three to every
agent.

## 3t. `"gh repo list*"` was missing entirely

`test-writer`, looking for the dedicated sandbox repo spec 03's tests need
(none existed yet; the architect created
`weaver-engineering/sandbox-task-phases-DO-NOT-DELETE` — a persistent
fixture, not part of this task), ran `gh repo list` against both the
user's own account and the `weaver-engineering` org to check what was
available. Plain missing pattern, read-only. Added to all three agents.

## 3u. `"gh repo view*"` and a sandbox-scoped `"gh api repos/..."` pattern
were missing entirely

`test-writer`, having found the sandbox repo via `gh repo list`, ran `gh
repo view` (its details) and `gh api repos/weaver-engineering/
sandbox-task-phases-DO-NOT-DELETE/branches` (its branch list) — both
read-only. `"gh repo view*"` added generally, same category as `gh repo
list*`. The `gh api` pattern is scoped to this one specific repo path
rather than a blanket `"gh api*"`, but — unlike the narrower `"gh api
user*"` (§3s) — allows any operation against it, not just reads: the
sandbox repo is an explicitly disposable test fixture, not production
code, so even a mutating call there carries none of the risk a blanket
`gh api*` would against the real repo. Added to all three agents.

## 3v. `"git clone*"` was missing entirely

`test-writer` cloned the sandbox repo into a temp dir to probe/verify its
state before writing tests against it — plain missing pattern. Cloning
is no more dangerous than the already-allowed `git fetch*`/`git push*`;
added to all three agents.

## 3w. `"git checkout*"` and `"date*"` were missing entirely

Building sandbox fixtures for the `gh` spec (probe branches, a timestamped
probe commit), `test-writer` ran `git checkout -b <branch> [<start>]` —
only `git switch*` had ever been added, since the docs' own protocol
examples always use `switch`, not the older `checkout` form. Same risk
category (branch creation/switching), just the alternate command name.
Also ran `date +%s` for a unique probe value — trivial, read-only. Both
added to all three agents.

## 3x. `"base64*"` was missing entirely

`test-writer`, reading the sandbox repo's README (via `gh api
repos/.../readme --jq .content | base64 -d`, since GitHub's API returns
file contents base64-encoded), hit a missing pattern for `base64 -d` —
trivial, read-only decoding. Added `"base64*"` to all three agents. (The
`gh api repos/weaver-engineering/sandbox-task-phases-DO-NOT-DELETE*`
half of that same command was already fixed in §3u — the live session
just hadn't been restarted since, so it was still running on stale
config.)

## 3y. `"pnpm exec vitest*"` was missing entirely

`test-writer` ran `pnpm exec vitest run --coverage ...` directly (custom
coverage reporters/output file) rather than `pnpm test`, which the
existing `"pnpm test*"` pattern doesn't cover — a different invocation
shape of the same underlying test runner. Same low-risk category. Added
to all three agents.

## 3z. `"perl -pi*"` added — same already-established policy as §3h/§3i/§3j/§3p

`test-writer` ran `perl -pi -e 's/.../.../' test/packages/task-phases/deps/gh.test.ts`
to bulk-add a timeout option to every `it(...)` in the file. `perl -pi`
is in-place file editing — same bypass-risk category as `sed -i` (§3g):
a blanket allow would let `build-implementer` edit `test/**` via bash
despite its explicit `permission.edit` deny, since bash permissions don't
know about edit-glob restrictions. Unlike `sed -n`/`sed -i`, there's no
equivalent safe/unsafe flag split for `perl -pi` — the `-i` *is* the
in-place edit. Applied the same already-established policy directly
rather than re-asking: OS-level containment of the agent's workspace is
the intended boundary, not shell-command allow-listing. Added
`"perl -pi*"` to all three agents.

## 3aa. `"python3 -c*"` widened to `"python3 -*"`

Still blocked on `perl -pi` pending a restart (config already fixed in
§3z), `test-writer` fell back to `python3 - <<'PYEOF' ... PYEOF` — a
heredoc script piped to `python3 -` (read script from stdin), not the
`python3 -c "..."` shape §3h already allows. Same arbitrary-code-execution
risk, same already-accepted policy — widened the existing pattern from
`"python3 -c*"` to `"python3 -*"` (covers `-c`, `-`, and any other
single-dash flag) rather than adding a parallel narrow pattern for every
new invocation shape the agent happens to try. Applied to all three
agents.

## 3ab. `"gh config get*"` was missing entirely

Resolving the SSH-vs-HTTPS review comment on PR #41, `test-writer` ran
`gh config get git_protocol` to check how `gh` itself is configured to
authenticate — read-only diagnostic, same category as `gh --version`/`gh
auth status`. Added to all three agents.

## 3ac. `"sleep*"` was missing entirely

`test-writer`, polling PR #41's status after pushing an update, ran
`sleep 3` between checks. Trivial and fully harmless — no side effects
of any kind. Added to all three agents.

## 3ad. `"gh pr comment*"` — reversing the §3a.2 (renumbered §3d) deferral

The architect posted a review comment on PR #41 (SSH-vs-`gh repo clone`
portability issue) directly on GitHub, deliberately exercising the real
review/reply cycle rather than relaying feedback through the chat.
`test-writer`, told to resolve it, fixed the clone, verified locally, and
then tried to reply on the PR confirming what was fixed — `gh pr comment*`
was the one `gh pr` write action deferred back in §3d, on the reasoning
that it should stay under human review "until a concrete need exists."
That need is now concrete and exactly matches the intended workflow (an
agent responding to review feedback on its own PR, not merging or closing
anything). Added `"gh pr comment*"` to all three agents.

## 3ae. `"gh run list*"` was missing entirely

`build-implementer`, beginning the spec 03 build phase, checked recent
GitHub Actions workflow runs (`gh run list --workflow=main.yml`, `gh run
list`) — read-only diagnostic, same category as `gh pr checks*`. Added
to all three agents.

## 3af. `test-writer`'s interface-glob prerequisite note removed — the
gap it warned about has landed

`test-writer.md`'s standing instructions carried a prerequisite note
since this task was first set up: `validate-test-commit` didn't yet
permit `packages/**/*.interface.ts` alongside `test/**`, so the
`packages/**/*.interface.ts` edit permission (§3, already granted)
couldn't actually pass `build-gate` — the note said not to deploy the
agent before that landed (tracked in memory as
`mag46_interface_glob_gate_gap`, deferred "resume via MAG-30 if it
actually bites"). It bit: MAG-46's `test-writer` needed exactly this for
spec 02/03's `.interface.ts`-adjacent work. Fixed directly in
`packages/gate-checks` via task/MAG-30 (PR #43, merged) — added a shared
`isInterfaceFile()` helper; `validate-test-commit` now allows these files
alongside `test/**`, `validate-build-commit` now explicitly excludes them.
With the gap closed, removed the now-stale prerequisite note from
`test-writer.md` entirely.

## 4. Explicitly out of scope

- `.opencode/tool/task-phases.ts` — **not** created. Per
  `open-code-agent-tools.md` §3, this tool's methods are added one at a
  time, only once a real, working `pnpm task <command>` CLI exists
  behind them. No such CLI exists in this repo yet (confirmed: no
  `task-phases` package, no `task` script), so no speculative stub is
  added.
- No sub-agent for the `spec` phase (by design — `open-code-sub-agents.md`
  §2).
- No changes to `pnpm-workspace.yaml` or dependencies — OpenCode resolves
  `.opencode/tool/*.ts` and its `@opencode-ai/plugin` import itself at
  runtime; it isn't part of this repo's pnpm workspace or TS project.

## 5. Acceptance criteria

- Three sub-agent config files exist under `.opencode/agent/`, each with
  the standing instructions verbatim and a `permission.edit`/
  `permission.bash` matrix equivalent in intent to its source
  instructions doc, adapted per §3a to actually function under real
  OpenCode.
- Each agent verified interactively: session-start-protocol git commands
  and edits within scope proceed without an unexpected permission
  prompt; edits/commands outside scope are still gated.
- `.opencode/tool/gate-check.ts` exists and matches the example in
  `open-code-agent-tools.md` §2, invoking the real `test-gate` /
  `build-gate` / `main-gate` checks in `packages/gate-checks`, and — per
  §3b — actually returns a valid result for a pass, a fail, and a
  malformed invocation, verified against the real CLI.
- No `task-phases` tool file is added, since no backing CLI exists yet.

## 6. Notes for the agent

- None.
