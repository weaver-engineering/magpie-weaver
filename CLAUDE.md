# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working in this repository.

## `gate-checks` and `task-phases`: use the CLIs, not ad hoc git/gh

Two published packages — `@weaver-engineering/gate-checks` and `@weaver-engineering/task-phases` — are also exposed as structured OpenCode tools (`.opencode/tool/gate-check.ts`, `.opencode/tool/task.ts`), wrapping the same CLIs with a discovery contract. Claude Code has no equivalent tool integration for these yet — an MCP server is planned, but only once the scheduler work requires a long-running server process anyway (no point standing one up before then). Until that lands, call the CLIs directly via Bash — don't reconstruct their logic with raw `git`/`gh` commands.

Both packages are published by the-loom to GitHub Packages and installed here as ordinary registry `devDependencies` — resolving them locally requires a machine set up per [Dev Environment Setup](https://github.com/weaver-engineering/docs/blob/main/onboarding/dev-environment-setup.md) (GitHub Packages auth in `~/.npmrc`).

### `@weaver-engineering/gate-checks` — `pnpm gate-check`

Runs any of the 14 checks in the catalog independently — not just `test-gate`/`build-gate`/`main-gate`, also `branch-ref`, `pr-title`, `coverage`, `existing-tests-pass`, `new-tests-fail`, `build`, and the four `validate-*-commit` checks.

- **Discover what's available first:** `pnpm gate-check --list --json` returns every check's name, description, required arguments, and per-argument descriptions. Don't guess a check's arguments from its name — read this.
- **Run one:** `pnpm gate-check <checkName> --json [--flag value ...]`
- Exit 0 = passed, 1 = ran and failed (or a caught error, e.g. an invalid `--base-ref`), 2 = invalid arguments or an unknown check name — all three still write valid JSON to stdout with `--json`, so parsing doesn't need to branch on exit code.

### `@weaver-engineering/task-phases` — `pnpm task`

Drives the task-phasing workflow: `init`, `status`, `list`, `promote`, `wip`, or a bare task ref (e.g. `AAA-001`) for the `ref`-switch command. All commands are fully implemented (MAG-46, complete as of 2026-08-07) — no stub or placeholder surface remains.

- `pnpm task <command> [...args] --json`
- Every command's `--json` output is one line: `{command, args, result, success}`.
- Exit 0/1 both write valid JSON with `--json` (0 = success, 1 = ran and failed). **Exit 2 is the one exception** — an unknown command or bad top-level argument writes plain text (`Error: <message>`) regardless of `--json`.
