import type { GitTool, RebaseOutcome } from "./deps/git.js";
import type { GitHubTool } from "./deps/gh.js";
import type { FileSystemTool } from "./deps/fs.js";
import type { GateChecksTool } from "./deps/gate-check.js";

export type { GitTool, RebaseOutcome, GitHubTool, FileSystemTool, GateChecksTool };
export type { PullRequestSummary, MergedPullRequestSummary } from "./deps/gh.js";
export type { GateName } from "./deps/gate-check.js";

/** `.task-phases.json` somewhere in the cwd path (repo root). */
export interface TaskPhasesConfig {
  templates: {
    /** path from `.task-phases.json` to the task template */
    task: string;
  };
  tasks: {
    /** path from `.task-phases.json` to the task docs directory, default
     * `"docs/tasks/"` */
    docs?: string;
    /** pattern for the task dir, default `"task-${ref}"` */
    dirName?: string;
    /** pattern for the task doc name, default `"task-${ref}"` */
    taskDocName?: string;
    /** pattern for the spec docs, default `"task-${ref}-${nn}-spec.md"` */
    specDocNames?: string;
  };
}

/** matches `/^[A-Z]+-[0-9]+$/` */
export type TaskRef = string;

export type Phase = "spec" | "test" | "build" | "quick";

// Phase-local state
export type PhaseState =
  | "not-started"
  | "work-in-progress"
  | "ready?"
  | "ready"
  | "blocked"
  | "awaiting-pr"
  | "merged-pending-pull"
  | "merged-pending-cleanup";

// Task-level state — "not-initialised" only applies before any branch
// exists at all; every other value is a PhaseState for the derived phase
export type TaskState = "not-initialised" | PhaseState;

export interface TaskStatus {
  ref: TaskRef;
  /** `null` iff `state === "not-initialised"` */
  phase: Phase | null;
  /** the branch this phase/state authority is derived against */
  canonicalBranch: string | null;
  /** what's actually checked out locally */
  currentBranch: string | null;
  /** `currentBranch !== canonicalBranch` — `promote` refuses to act while
   * true */
  branchMismatch: boolean;
  state: TaskState;
  gate?: {
    name: string;
    /** `false` only for `spec/{ref}` -> `test/{ref}` */
    enforced: boolean;
    result?: GateCheckResult;
  };
}

// the command invoked
export type Command = "init" | "status" | "list" | "promote" | "wip" | "ref";

export interface TaskPhasingCommandResult {
  /** messages surfaced to the caller by the command execution */
  messages: string[];
  /** true if the command completed successfully, false if it failed */
  success: boolean;
  /** any detected task phasing violation */
  violation?: string;
  /** suggested actions to resolve the violation */
  suggestedActions?: string[];
} // throws invalid-arguments

/** `init`-specific result data. */
export interface InitCommandResult extends TaskPhasingCommandResult {
  ref: TaskRef;
  /** `spec/{ref}` or `task/{ref}`, whichever was created */
  canonicalBranch: string;
  taskDocPath: string | null;
  specDocPaths: string[];
  wipCarriedForward: boolean;
}

/** `status`-specific result data. */
export interface StatusCommandResult extends TaskPhasingCommandResult {
  /** the derived `TaskStatus` this result reports — serialised under the
   * JSON result object so `--json` callers can read the full derivation */
  taskStatus: TaskStatus;
  /** true iff `--check` was given AND actually ran gate-check */
  checked: boolean;
  /** true iff `--check` was given but refused because `--ref` named a task
   * other than the checked-out one */
  checkRefused: boolean;
  /** true iff `--fix` actually performed a branch switch */
  fixed: boolean;
}

/** `list`-specific result data. */
export interface ListCommandResult extends TaskPhasingCommandResult {
  /** every active ref's derived `TaskStatus` */
  tasks: TaskStatus[];
  /** which entry (if any) is the currently checked-out task */
  currentRef: TaskRef | null;
}

/** `promote`-specific result data. */
export interface PromoteCommandResult extends TaskPhasingCommandResult {
  action:
    | "none"
    | "forked"
    | "pr-raised"
    | "rebased"
    | "pulled"
    | "pulled-and-rebased"
    | "cleaned-up";
  /** set when action is `"pr-raised"` */
  prNumber?: number;
  /** set when action is `"pr-raised"` */
  prUrl?: string;
  /** set when action is `"rebased"` or `"pulled-and-rebased"` */
  rebaseOutcome?: RebaseOutcome;
  /** set when action is `"cleaned-up"` */
  branchesDeleted?: string[];
}

/** `wip`-specific result data. */
export interface WipCommandResult extends TaskPhasingCommandResult {
  commitSha: string;
  filesAdded: string[];
  filesChanged: string[];
  filesDeleted: string[];
}

/** `ref`-specific result data — the `pnpm task <ref>` switch command. */
export interface RefCommandResult extends TaskPhasingCommandResult {
  /** branch checked out before the switch */
  switchedFrom: string | null;
  /** the canonical branch switched to */
  switchedTo: string;
  /** set if `--wip` committed work before switching */
  wipCommitSha?: string;
}

export type CommandResultFor<C extends Command> = C extends "init"
  ? InitCommandResult
  : C extends "status"
    ? StatusCommandResult
    : C extends "list"
      ? ListCommandResult
      : C extends "promote"
        ? PromoteCommandResult
        : C extends "wip"
          ? WipCommandResult
          : C extends "ref"
            ? RefCommandResult
            : never;

export interface TaskPhasingResult<C extends Command = Command> {
  /** the task phasing command that was invoked */
  command: C;
  /** a string map of the argument values given */
  args: Record<string, boolean | number | string | string[]>;
  /** the derived status of the task at the end of command execution */
  taskStatus: TaskStatus;
  /** narrowed to the command-specific extension above, not the generic
   * base */
  result: CommandResultFor<C>;
}

/**
 * The signature of all task-phasing functions, generic over which
 * command-specific result extension the function returns. Each function
 * receives the inspectors and parsed CLI arguments, and returns its
 * result synchronously or asynchronously.
 */
export type TaskPhasingFn<R extends TaskPhasingCommandResult = TaskPhasingCommandResult> = (
  tools: ExternalTools,
  args: Record<string, boolean | number | string | string[]>,
) => Promise<R> | R;

/**
 * The function catalog linking function definitions to command names — an
 * explicit per-key interface rather than a generic `Record<Command,
 * TaskPhasingFn>`, so each command's function signature carries its own
 * specific return type instead of the generic base.
 */
export interface FunctionCatalog {
  init: TaskPhasingFn<InitCommandResult>;
  status: TaskPhasingFn<StatusCommandResult>;
  list: TaskPhasingFn<ListCommandResult>;
  promote: TaskPhasingFn<PromoteCommandResult>;
  wip: TaskPhasingFn<WipCommandResult>;
  ref: TaskPhasingFn<RefCommandResult>;
}

/**
 * The external tools to be passed to each task-phasing function call.
 * Provides access to git, github, gate-checks and file-system operations.
 */
export interface ExternalTools {
  /** The git tool instance for the function to use if it needs it */
  git: GitTool;

  /** The github tool for the function to use if it needs it */
  github: GitHubTool;

  /** The gate-checks tool for the function to use if it needs it */
  gateChecks: GateChecksTool;

  /** The file system tool for the function to use if it needs it */
  fileSystem: FileSystemTool;
}

/**
 * The standardised output of `@magpieweaver/gate-checks`. Declared locally
 * rather than imported — the real package doesn't expose a stable public
 * entry point to import from yet — but the shape must stay in lockstep
 * with `@magpieweaver/gate-checks`'s own `GateCheckResult`.
 */
export interface GateCheckResult {
  /** The name of the check */
  check: string;

  /** The arguments passed to the check */
  args: Record<string, boolean | number | string | string[]>;

  /** Whether the check passed or not */
  passed: boolean;

  /** Information messages provided by the check */
  messages: string[];

  /** Violation messages provided by the check */
  violations: string[];

  /** A brief summary of the status of the check */
  summary: string;

  /** Values exported by the check to be passed to other checks */
  values: Record<string, boolean | number | string | string[]>;
}
