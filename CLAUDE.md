# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working in this repository.

## `gate-checks` and `task-phases`: use the CLIs, not ad hoc git/gh

Two packages in this monorepo — `@magpieweaver/gate-checks` and `@magpieweaver/task-phases` — are also exposed as structured OpenCode tools (`.opencode/tool/gate-check.ts`, `.opencode/tool/task.ts`), wrapping the same CLIs with a discovery contract. Claude Code has no equivalent tool integration for these yet — an MCP server is planned, but only once the scheduler work requires a long-running server process anyway (no point standing one up before then). Until that lands, call the CLIs directly via Bash — don't reconstruct their logic with raw `git`/`gh` commands.

### `@magpieweaver/gate-checks` — `pnpm gate-check`

Runs any of the 14 checks in the catalog independently — not just `test-gate`/`build-gate`/`main-gate`, also `branch-ref`, `pr-title`, `coverage`, `existing-tests-pass`, `new-tests-fail`, `build`, and the four `validate-*-commit` checks.

- **Discover what's available first:** `pnpm gate-check --list --json` returns every check's name, description, required arguments, and per-argument descriptions. Don't guess a check's arguments from its name — read this.
- **Run one:** `pnpm gate-check <checkName> --json [--flag value ...]`
- Exit 0 = passed, 1 = ran and failed (or a caught error, e.g. an invalid `--base-ref`), 2 = invalid arguments or an unknown check name — all three still write valid JSON to stdout with `--json`, so parsing doesn't need to branch on exit code.

### `@magpieweaver/task-phases` — `pnpm task`

Drives the task-phasing workflow: `init`, `status`, `list`, `promote`, `wip`, or a bare task ref (e.g. `AAA-001`) for the `ref`-switch command.

- `pnpm task <command> [...args] --json`
- Every command's `--json` output is one line: `{command, args, result, success}`.
- `list`/`promote`/`ref` are still unimplemented placeholders (`throw new Error("not implemented")`, landing with MAG-46-10/11/16/17) — they'll return a clean `success: false` result with `violation: "not implemented"`, not an error. Check `docs/tasks/task-MAG-46/task-MAG-46.md`'s "Current Scope" section for what's actually landed before relying on one.
- Exit 0/1 both write valid JSON with `--json` (0 = success, 1 = ran and failed). **Exit 2 is the one exception** — an unknown command or bad top-level argument writes plain text (`Error: <message>`) regardless of `--json`.
