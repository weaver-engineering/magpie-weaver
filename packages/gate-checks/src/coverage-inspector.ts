import { exec, execSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { type BuildResult, type CoverageInspector, type TestResults } from "./coverage-interface.js";

const execAsync = promisify(exec);

/**
 * Implementation of CoverageInspector using pnpm for test execution
 * and reading coverage data from the coverage directory.
 */
export class CoverageInspectorImpl implements CoverageInspector {
  private cwd: string;
  private coverageDir: string;
  private gitBaseRef: string;

  /**
   * @param options.cwd Working directory for running commands (defaults to process.cwd())
   * @param options.coverageDir Path to the coverage output directory (defaults to `<cwd>/coverage`)
   * @param options.gitBaseRef Git base ref for diff comparison (defaults to "origin/main")
   */
  private json: boolean;

  constructor(options?: { cwd?: string; coverageDir?: string; gitBaseRef?: string; json?: boolean }) {
    this.cwd = options?.cwd ?? process.cwd();
    this.coverageDir = resolve(this.cwd, options?.coverageDir ?? "coverage");
    this.gitBaseRef = options?.gitBaseRef ?? "origin/main";
    this.json = options?.json ?? false;
  }

  /**
   * Run tests with coverage using pnpm.
   * Tests are run via `pnpm test -- --coverage` with json-summary and lcov reporters.
   * Also outputs JSON test results to `coverage/test-results.json`.
   * If path is given, tests are filtered using `pnpm --filter <path>`.
   *
   * @param path If given, only run tests for the package at the path
   */
  runTestsWithCoverage(path?: string): void {
    const filterFlag = path ? ` --project ${path}` : "";
    const command = [
      "pnpm",
      "exec",
      "vitest",
      "run",
      "--coverage",
      "--coverage.reporter=json-summary",
      "--coverage.reporter=lcov",
      "--coverage.reportOnFailure",
      "--reporter=default",
      "--reporter=json",
      `--outputFile.json="${resolve(this.coverageDir, "test-results.json")}"`,
      filterFlag,
    ].filter(Boolean).join(" ");

    execSync(this.json ? `${command} >/dev/null 2>&1` : command, { cwd: this.cwd, stdio: "inherit" });
  }

  /**
   * Build every package via `pnpm -r build` — real `tsc` compilation,
   * never run by `runTestsWithCoverage()` (vitest's esbuild transform
   * strips types rather than checking them).
   *
   * @returns Whether the build succeeded, with the combined stdout/stderr
   */
  runBuild(): BuildResult {
    try {
      const output = execSync("pnpm -r build", { cwd: this.cwd, encoding: "utf-8" });
      return { success: true, output };
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; message?: string };
      const output = [err.stdout, err.stderr].filter(Boolean).join("\n") || err.message || "Build failed";
      return { success: false, output };
    }
  }

  /**
   * Read test results from the most recent test run.
   *
   * @returns TestResults with counts and failing test file paths
   * @throws If test results file has not been generated yet
   */
  async getTestResults(): Promise<TestResults> {
    const resultsPath = resolve(this.coverageDir, "test-results.json");
    let content: string;
    try {
      content = await readFile(resultsPath, "utf-8");
    } catch {
      throw new Error(
        `Test results not found at ${resultsPath}. Run runTestsWithCoverage() first.`,
      );
    }

    const data = JSON.parse(content);
    const failingTestFiles: string[] = [];
    for (const result of data.testResults ?? []) {
      if (result.status === "failed") {
        failingTestFiles.push(result.name);
      }
    }

    return {
      numTotalTests: data.numTotalTests ?? 0,
      numFailedTests: data.numFailedTests ?? 0,
      failingTestFiles,
    };
  }

  /**
   * Read the coverage summary and return the line coverage percentage.
   * Reads from `coverage/coverage-summary.json` in the configured coverage directory.
   * If path is given, returns per-file coverage for that specific path.
   *
   * @param path If given, return the line coverage for the specific file or path
   * @returns The line coverage percentage (0-100)
   * @throws If coverage summary has not been generated yet
   */
  async getCoverage(path?: string): Promise<number> {
    const summary = await this.readCoverageSummary();

    if (path) {
      const normalizedPath = resolve(this.cwd, path);
      const entry = this.findFileEntry(summary, normalizedPath);
      if (!entry) {
        throw new Error(`No coverage data found for path: ${path}`);
      }
      return entry.lines.pct;
    }

    return this.computeAggregateLineCoverage(summary);
  }

  /** Recomputes the overall line-coverage percentage across every file in
   * `summary` except `total`, excluding `deps/*.ts` files (see
   * `isExcludedFromCoverage`). Doesn't just filter `summary.total` because
   * that figure is pre-aggregated across every file, deps/*.ts included. */
  private computeAggregateLineCoverage(
    summary: Record<string, { lines: { total: number; covered: number; pct: number } }>,
  ): number {
    let total = 0;
    let covered = 0;
    for (const [filePath, entry] of Object.entries(summary)) {
      if (filePath === "total" || this.isExcludedFromCoverage(filePath)) continue;
      total += entry.lines.total;
      covered += entry.lines.covered;
    }
    if (total === 0) return 100;
    return Math.round((covered / total) * 100 * 100) / 100;
  }

  /** These files are deliberately thin boundary wrappers: every
   * system-level command test mocks this exact boundary rather than
   * exercising it in-process, and their real behavior is instead proven
   * by tests that spawn the built CLI as a subprocess — invisible to
   * vitest's own coverage instrumentation, which only tracks code running
   * in its own process. Some of this code may also be genuinely
   * untestable in-process at all (thin pass-throughs to a real external
   * tool).
   *
   * Two families match:
   * - `deps/*.ts`: per-command boundary wrappers mocked by every
   *   system-level command test and proven by `--dev-testing` tests that
   *   spawn the built CLI as a subprocess.
   * - the gate-checks public entry chain (`index.ts`, `run-check.ts`,
   *   `coverage-inspector.ts`, `git-inspector.ts`, `workspace-root.ts`):
   *   the package's own `cli.test.ts` exercises these for real by spawning
   *   the built CLI as a subprocess, and in-process tests mock the
   *   inspectors instead. When another package imports this entry point
   *   (e.g. task-phases' RealGateChecksTool), those files enter the
   *   in-process coverage graph at ~0% even though they are fully proven
   *   by the subprocess tests.
   *
   * Excluded from both the overall and new-line coverage figures rather
   * than penalizing every change that touches them for a measurement gap,
   * not a real testing gap. */
  private isExcludedFromCoverage(filePath: string): boolean {
    return /\/deps\/[^/]+\.ts$/.test(filePath) ||
      /\/gate-checks\/src\/(index|run-check|coverage-inspector|git-inspector|workspace-root)\.ts$/.test(filePath);
  }

  /**
   * Read the LCOV coverage report and compute the percentage of new lines that are covered.
   * New lines are determined by running `git diff` against the configured base ref.
   * If path is given, only consider new lines within that path.
   *
   * @param path If given, only compute new line coverage for files under this path
   * @returns The new line coverage percentage (0-100). Returns 100 if no new lines detected.
   * @throws If LCOV file has not been generated yet
   */
  async getNewLineCoverage(path?: string): Promise<number> {
    const lcovPath = resolve(this.coverageDir, "lcov.info");
    let lcovContent: string;
    try {
      lcovContent = await readFile(lcovPath, "utf-8");
    } catch {
      throw new Error(
        `LCOV file not found at ${lcovPath}. Run runTestsWithCoverage() first.`,
      );
    }

    const fileLineCoverage = this.parseLcov(lcovContent);

    const newLines = await this.getNewLinesFromGit(path);

    let totalNewLines = 0;
    let coveredNewLines = 0;

    for (const [filePath, lineNumbers] of Object.entries(newLines)) {
      if (this.isExcludedFromCoverage(filePath)) continue;
      const coverage = fileLineCoverage[filePath];
      if (!coverage) continue;

      for (const lineNum of lineNumbers) {
        // Comments, blank lines, and pure data literals never get a DA:
        // record from lcov at all — they're not instrumentable, so no
        // test could ever make them "covered". Only count a new line
        // toward the denominator if lcov actually instrumented it;
        // otherwise a documentation-heavy diff tanks this metric for
        // lines that were never executable in the first place.
        if (!coverage.instrumentable.has(lineNum)) continue;
        totalNewLines++;
        if (coverage.covered.has(lineNum)) {
          coveredNewLines++;
        }
      }
    }

    if (totalNewLines === 0) return 100;
    return Math.round((coveredNewLines / totalNewLines) * 100 * 100) / 100;
  }

  private async readCoverageSummary(): Promise<Record<string, { lines: { total: number; covered: number; pct: number } }>> {
    const summaryPath = resolve(this.coverageDir, "coverage-summary.json");
    let content: string;
    try {
      content = await readFile(summaryPath, "utf-8");
    } catch {
      throw new Error(
        `Coverage summary not found at ${summaryPath}. Run runTestsWithCoverage() first.`,
      );
    }
    return JSON.parse(content);
  }

  private findFileEntry(
    summary: Record<string, { lines: { total: number; covered: number; pct: number } }>,
    targetPath: string,
  ): { lines: { total: number; covered: number; pct: number } } | undefined {
    if (summary[targetPath]) return summary[targetPath];

    for (const [key, value] of Object.entries(summary)) {
      if (key === targetPath || key.endsWith(targetPath)) {
        return value;
      }
    }
    return undefined;
  }

  /** For each file, `instrumentable` is every line lcov emitted a `DA:`
   * record for (i.e. every line the coverage tool considered executable),
   * and `covered` is the subset of those with a nonzero hit count.
   * Comment lines, blank lines, and other non-executable lines never get
   * a `DA:` record, so they appear in neither set. */
  private parseLcov(
    lcovContent: string,
  ): Record<string, { instrumentable: Set<number>; covered: Set<number> }> {
    const files: Record<string, { instrumentable: Set<number>; covered: Set<number> }> = {};
    let currentFile = "";

    for (const line of lcovContent.split("\n")) {
      if (line.startsWith("SF:")) {
        currentFile = line.slice(3);
        files[currentFile] = { instrumentable: new Set(), covered: new Set() };
      } else if (line.startsWith("DA:")) {
        const [, data] = line.split(":");
        const [lineNum, hitCount] = data.split(",");
        if (currentFile) {
          files[currentFile].instrumentable.add(parseInt(lineNum));
          if (parseInt(hitCount) > 0) {
            files[currentFile].covered.add(parseInt(lineNum));
          }
        }
      }
    }

    return files;
  }

  private async getNewLinesFromGit(
    pathFilter?: string,
  ): Promise<Record<string, Set<number>>> {
    const files: Record<string, Set<number>> = {};
    let diffOutput: string;

    try {
      const { stdout } = await execAsync(
        `git diff ${this.gitBaseRef}...HEAD --unified=0 --diff-filter=AM`,
        { cwd: this.cwd },
      );
      diffOutput = stdout;
    } catch {
      const { stdout } = await execAsync(
        "git diff HEAD~1 --unified=0 --diff-filter=AM",
        { cwd: this.cwd },
      );
      diffOutput = stdout;
    }

    let currentFile = "";
    let currentNewLine = 0;

    for (const line of diffOutput.split("\n")) {
      if (line.startsWith("+++ b/")) {
        currentFile = line.slice(6);
        if (!pathFilter || currentFile.startsWith(pathFilter) || currentFile.includes(pathFilter)) {
          files[currentFile] = new Set();
        } else {
          currentFile = "";
        }
      } else if (line.startsWith("@@")) {
        const match = line.match(/\+(\d+)/);
        currentNewLine = match ? parseInt(match[1]) : 0;
      } else if (line.startsWith("+") && !line.startsWith("+++") && currentFile && currentNewLine > 0) {
        files[currentFile].add(currentNewLine);
        currentNewLine++;
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        // removed lines are not tracked
      } else if (line.startsWith(" ") && currentNewLine > 0) {
        currentNewLine++;
      }
    }

    return files;
  }
}
