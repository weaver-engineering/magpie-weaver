import { type CoverageInspector } from "./coverage-interface.js";
import { type GitInspector } from "./git-interface.js";

/**
 * The standardised output of all gate checks.
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

/**
 * The definition of a check function and its required arguments.
 * Contained in the FunctionCatalog.
 */
export interface FunctionDef {
  /** The gate-check function */
  fn: GateCheckFn;

  /** The list of required arguments for the function */
  requiredArgs: [string, ...string[]];
}

/**
 * The signature of all gate-check functions.
 * Each function receives the inspectors and parsed CLI arguments,
 * and returns a GateCheckResult synchronously or asynchronously.
 */
export type GateCheckFn = (
  inspectors: Inspectors,
  args: Record<string, boolean | number | string>,
) => Promise<GateCheckResult> | GateCheckResult;

/**
 * The function catalog linking function definitions to check names.
 * Keys are the check names (e.g. "pr-title"), values are their FunctionDef.
 */
export type FunctionCatalog = Record<string, FunctionDef>;

/**
 * The inspectors to be passed to each gate-check function call.
 * Provides access to git operations and coverage operations.
 */
export interface Inspectors {
  /** The git inspector instance for the function to use if it needs it */
  git: GitInspector;

  /** The coverage inspector for the function to use if it needs it */
  coverage: CoverageInspector;
}
