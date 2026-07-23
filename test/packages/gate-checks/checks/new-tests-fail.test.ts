import { describe, it, expect, vi } from "vitest";
import { fn, requiredArgs } from "@magpieweaver/gate-checks/src/checks/new-tests-fail.js";
import type { CoverageInspector, GitInspector, Inspectors } from "@magpieweaver/gate-checks/dist/types.js";

function createMockInspectors(
  coverageExists: boolean,
  failingTestFiles: string[] = [],
  uncommitted: string[] = [],
  getTestResultsThrows = false,
): Inspectors {
  const testResults = {
    numTotalTests: 10,
    numFailedTests: failingTestFiles.length,
    failingTestFiles,
  };

  return {
    git: {
      workingTreeChanges: vi.fn().mockResolvedValue(uncommitted),
    } as unknown as GitInspector,
    coverage: {
      getCoverage: vi.fn().mockImplementation(async () => {
        if (!coverageExists) throw new Error("No coverage data");
        return 85;
      }),
      getNewLineCoverage: vi.fn(),
      runTestsWithCoverage: vi.fn(),
      getTestResults: vi.fn().mockImplementation(async () => {
        if (getTestResultsThrows) throw new Error("No test results");
        return testResults;
      }),
    } as CoverageInspector,
  };
}

describe("new-tests-fail", () => {
  describe("at least one new test fails", () => {
    it("returns passed=true when a new test fails", async () => {
      const inspectors = createMockInspectors(true, ["test/new.test.ts"]);
      const result = await fn(inspectors, { newTests: ["test/new.test.ts"] });
      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("returns passed=true when multiple new tests fail", async () => {
      const inspectors = createMockInspectors(true, ["test/a.test.ts", "test/b.test.ts"]);
      const result = await fn(inspectors, {
        newTests: ["test/a.test.ts", "test/b.test.ts"],
      });
      expect(result.passed).toBe(true);
    });

    it("returns passed=true when only some new tests fail", async () => {
      const inspectors = createMockInspectors(true, ["test/a.test.ts"]);
      const result = await fn(inspectors, {
        newTests: ["test/a.test.ts", "test/b.test.ts"],
      });
      expect(result.passed).toBe(true);
    });

    it("returns correct values with newTestFailures", async () => {
      const inspectors = createMockInspectors(true, ["test/new.test.ts"]);
      const result = await fn(inspectors, { newTests: ["test/new.test.ts"] });
      expect(result.values.newTests).toEqual(["test/new.test.ts"]);
      expect(result.values.newTestFailures).toEqual(["test/new.test.ts"]);
    });
  });

  describe("no new tests fail", () => {
    it("returns passed=false when all tests pass", async () => {
      const inspectors = createMockInspectors(true);
      const result = await fn(inspectors, { newTests: ["test/new.test.ts"] });
      expect(result.passed).toBe(false);
      expect(result.violations).toContain("No new tests fail");
    });

    it("returns passed=false when only existing tests fail", async () => {
      const inspectors = createMockInspectors(true, ["test/existing.test.ts"]);
      const result = await fn(inspectors, { newTests: ["test/new.test.ts"] });
      expect(result.passed).toBe(false);
      expect(result.violations).toContain("No new tests fail");
    });
  });

  describe("no new tests defined", () => {
    it("returns passed=false when --newTests is not given", async () => {
      const inspectors = createMockInspectors(true, ["test/new.test.ts"]);
      const result = await fn(inspectors, {});
      expect(result.passed).toBe(false);
      expect(result.violations).toContain("At least one new test must be defined");
    });

    it("returns passed=false when --newTests is empty", async () => {
      const inspectors = createMockInspectors(true, []);
      const result = await fn(inspectors, { newTests: [] });
      expect(result.passed).toBe(false);
      expect(result.violations).toContain("At least one new test must be defined");
    });
  });

  describe("coverage not run", () => {
    it("returns passed=false when coverage data does not exist", async () => {
      const inspectors = createMockInspectors(false);
      const result = await fn(inspectors, { newTests: ["test/new.test.ts"] });
      expect(result.passed).toBe(false);
      expect(result.violations).toContain("Coverage must be run first");
    });
  });

  describe("uncommitted test changes", () => {
    it("returns passed=false when there are uncommitted changes in test/", async () => {
      const inspectors = createMockInspectors(true, [], ["test/foo.test.ts"]);
      const result = await fn(inspectors, { newTests: ["test/new.test.ts"] });
      expect(result.passed).toBe(false);
      expect(result.violations[0]).toContain("Uncommitted changes");
    });
  });

  describe("getTestResults throws", () => {
    it("returns passed=false when test results cannot be read", async () => {
      const inspectors = createMockInspectors(true, [], [], true);
      const result = await fn(inspectors, { newTests: ["test/new.test.ts"] });
      expect(result.passed).toBe(false);
      expect(result.violations).toContain("Could not read test results");
    });
  });

  describe("requiredArgs", () => {
    it("exports an empty required args list", () => {
      expect(requiredArgs).toEqual([]);
    });
  });
});
