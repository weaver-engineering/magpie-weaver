export interface TestResults {
  numTotalTests: number;
  numFailedTests: number;
  failingTestFiles: string[];
}

export interface BuildResult {
  success: boolean;
  /** Combined stdout/stderr from the build command — the raw compiler
   * output, surfaced verbatim on failure rather than reworded. */
  output: string;
}

/**
 * A shallow interface to the package manager for running tests and collecting coverage.
 * Required to mock coverage access in unit tests.
 */
export interface CoverageInspector {
  /**
   * Run the tests and collect coverage.
   * If the path is given only run tests at that path.
   *
   * @param path If given only run the tests at the path
   */
  runTestsWithCoverage(path?: string): void;

  /**
   * Inspect the coverage and return the percentage new line coverage.
   *
   * @param path If given return the coverage at the path
   * @returns The percentage new line coverage (0-100)
   */
  getNewLineCoverage(path?: string): Promise<number>;

  /**
   * Inspect the coverage and return the percentage line coverage.
   *
   * @param path If given return the coverage at the path
   * @returns The percentage line coverage (0-100)
   */
  getCoverage(path?: string): Promise<number>;

  /**
   * Read test results from the most recent test run.
   * Returns summary counts and the list of failing test file paths.
   *
   * @throws If test results file has not been generated yet
   */
  getTestResults(): Promise<TestResults>;

  /**
   * Build every package (`pnpm -r build`) — real type-checking compilation,
   * distinct from `runTestsWithCoverage()`: vitest transpiles TypeScript
   * via esbuild (transpile-only, no type-checking), so tests can pass
   * while `tsc` itself would fail. This is the only check in the gate
   * pipeline that actually verifies the code compiles.
   */
  runBuild(): BuildResult;
}
