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
