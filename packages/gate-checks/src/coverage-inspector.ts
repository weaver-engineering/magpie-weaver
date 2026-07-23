import { exec, execSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { type CoverageInspector, type TestResults } from "./coverage-interface.js";

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

    return summary.total.lines.pct;
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
      const coverage = fileLineCoverage[filePath];
      if (!coverage) continue;

      for (const lineNum of lineNumbers) {
        totalNewLines++;
        if (coverage.has(lineNum)) {
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

  private parseLcov(
    lcovContent: string,
  ): Record<string, Set<number>> {
    const files: Record<string, Set<number>> = {};
    let currentFile = "";

    for (const line of lcovContent.split("\n")) {
      if (line.startsWith("SF:")) {
        currentFile = line.slice(3);
        files[currentFile] = new Set();
      } else if (line.startsWith("DA:")) {
        const [, data] = line.split(":");
        const [lineNum, hitCount] = data.split(",");
        if (currentFile && parseInt(hitCount) > 0) {
          files[currentFile].add(parseInt(lineNum));
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
