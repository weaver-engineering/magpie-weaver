import { describe, it, expect, vi } from "vitest";
import { fn, requiredArgs } from "@magpieweaver/gate-checks/src/checks/existing-tests-pass.js";
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
      mergeBase: vi.fn(),
      diffTree: vi.fn(),
      lsTree: vi.fn(),
      commitMessages: vi.fn(),
      added: vi.fn(),
      modified: vi.fn(),
      deleted: vi.fn(),
      revList: vi.fn(),
      currentBranch: vi.fn(),
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

describe("existing-tests-pass", () => {
  describe("all tests pass", () => {
    it("returns passed=true when coverage exists, no uncommitted changes, and tests pass", async () => {
      const inspectors = createMockInspectors(true);
      const result = await fn(inspectors, {});
      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("exposes check name and args in result", async () => {
      const inspectors = createMockInspectors(true);
      const result = await fn(inspectors, {});
      expect(result.check).toBe("existing-tests-pass");
    });

    it("returns correct values when all tests pass", async () => {
      const inspectors = createMockInspectors(true);
      const result = await fn(inspectors, {});
      expect(result.values.numTests).toBe(10);
      expect(result.values.numTestFailures).toBe(0);
      expect(result.values.failingTests).toEqual([]);
    });
  });

  describe("coverage not run", () => {
    it("returns passed=false when coverage data does not exist", async () => {
      const inspectors = createMockInspectors(false);
      const result = await fn(inspectors, {});
      expect(result.passed).toBe(false);
      expect(result.violations).toContain("Coverage must be run first");
    });
  });

  describe("uncommitted test changes", () => {
    it("returns passed=false when there are uncommitted changes in test/", async () => {
      const inspectors = createMockInspectors(true, [], ["test/foo.test.ts"]);
      const result = await fn(inspectors, {});
      expect(result.passed).toBe(false);
      expect(result.violations[0]).toContain("Uncommitted changes");
    });
  });

  describe("existing tests fail without --newTests", () => {
    it("returns passed=false when tests fail and --newTests not given", async () => {
      const inspectors = createMockInspectors(true, ["test/old.test.ts"]);
      const result = await fn(inspectors, {});
      expect(result.passed).toBe(false);
      expect(result.violations).toContain("Existing test fails: test/old.test.ts");
    });

    it("returns correct values when tests fail", async () => {
      const inspectors = createMockInspectors(true, ["test/old.test.ts"]);
      const result = await fn(inspectors, {});
      expect(result.values.numTests).toBe(10);
      expect(result.values.numTestFailures).toBe(1);
      expect(result.values.failingTests).toEqual(["test/old.test.ts"]);
    });
  });

  describe("only new tests fail", () => {
    it("returns passed=true when tests fail but only new tests are failing", async () => {
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
      expect(result.values.failingTests).toEqual(["test/a.test.ts", "test/b.test.ts"]);
    });

    it("returns passed=true with mixed pass/fail new tests", async () => {
      const inspectors = createMockInspectors(true, ["test/c.test.ts"]);
      const result = await fn(inspectors, {
        newTests: ["test/a.test.ts", "test/b.test.ts", "test/c.test.ts"],
      });
      expect(result.passed).toBe(true);
    });
  });

  describe("existing and new tests both fail", () => {
    it("returns passed=false when some failures are not in --newTests", async () => {
      const inspectors = createMockInspectors(true, [
        "test/old.test.ts",
        "test/new.test.ts",
      ]);
      const result = await fn(inspectors, { newTests: ["test/new.test.ts"] });
      expect(result.passed).toBe(false);
      expect(result.violations).toContain("Existing test fails: test/old.test.ts");
    });

    it("returns multiple violation messages for multiple unknown failures", async () => {
      const inspectors = createMockInspectors(true, [
        "test/old1.test.ts",
        "test/old2.test.ts",
        "test/new.test.ts",
      ]);
      const result = await fn(inspectors, { newTests: ["test/new.test.ts"] });
      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(2);
    });
  });

  describe("getTestResults throws", () => {
    it("returns passed=false when test results cannot be read", async () => {
      const inspectors = createMockInspectors(true, [], [], true);
      const result = await fn(inspectors, {});
      expect(result.passed).toBe(false);
      expect(result.violations).toContain("Could not read test results");
    });
  });

  describe("--newTests matching uses endsWith", () => {
    it("matches failing tests to newTests when paths end with the same segment", async () => {
      const inspectors = createMockInspectors(true, [
        "/abs/path/test/new.test.ts",
      ]);
      const result = await fn(inspectors, { newTests: ["test/new.test.ts"] });
      expect(result.passed).toBe(true);
    });
  });

  describe("requiredArgs", () => {
    it("exports an empty required args list", () => {
      expect(requiredArgs).toEqual([]);
    });
  });
});
