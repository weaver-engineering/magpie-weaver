import { describe, it, expect, vi } from "vitest";
import { fn, requiredArgs } from "@magpieweaver/gate-checks/src/checks/existing-tests-pass.js";
import type { CoverageInspector, GitInspector, Inspectors } from "@magpieweaver/gate-checks/dist/types.js";

function createMockInspectors(
  coverageExists: boolean,
  testsPass: boolean,
  uncommitted: string[] = [],
): Inspectors {
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
      runTestsWithCoverage: vi.fn().mockImplementation(() => {
        if (!testsPass) throw new Error("Tests failed");
      }),
    } as CoverageInspector,
  };
}

describe("existing-tests-pass", () => {
  describe("§3.8.1 All Existing Tests Pass", () => {
    it("returns passed=true when coverage exists, no uncommitted changes, and tests pass", async () => {
      const inspectors = createMockInspectors(true, true);
      const result = await fn(inspectors, {});
      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("exposes check name and args in result", async () => {
      const inspectors = createMockInspectors(true, true);
      const result = await fn(inspectors, {});
      expect(result.check).toBe("existing-tests-pass");
    });
  });

  describe("§3.8.2 Coverage Not Run", () => {
    it("returns passed=false when coverage data does not exist", async () => {
      const inspectors = createMockInspectors(false, true);
      const result = await fn(inspectors, {});
      expect(result.passed).toBe(false);
      expect(result.violations).toContain("Coverage must be run first");
    });
  });

  describe("§3.8.3 Uncommitted Test Changes", () => {
    it("returns passed=false when there are uncommitted changes in test/", async () => {
      const inspectors = createMockInspectors(true, true, ["test/foo.test.ts"]);
      const result = await fn(inspectors, {});
      expect(result.passed).toBe(false);
      expect(result.violations[0]).toContain("Uncommitted changes");
    });
  });

  describe("§3.8.4 Some Existing Tests Fail", () => {
    it("returns passed=false when tests fail and --newTests not given", async () => {
      const inspectors = createMockInspectors(true, false);
      const result = await fn(inspectors, {});
      expect(result.passed).toBe(false);
      expect(result.violations).toContain("Some existing tests fail");
    });
  });

  describe("§3.8.5 New Tests Fail", () => {
    it("returns passed=true when tests fail but only new tests are failing", async () => {
      const inspectors = createMockInspectors(true, false);
      const result = await fn(inspectors, { newTests: ["test/new-failing.test.ts"] });
      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
      expect(result.values.failingTests).toEqual(["test/new-failing.test.ts"]);
    });

    it("returns passed=true when multiple new tests fail", async () => {
      const inspectors = createMockInspectors(true, false);
      const result = await fn(inspectors, {
        newTests: ["test/a.test.ts", "test/b.test.ts"],
      });
      expect(result.passed).toBe(true);
      expect(result.values.failingTests).toEqual(["test/a.test.ts", "test/b.test.ts"]);
    });
  });

  describe("requiredArgs", () => {
    it("exports an empty required args list", () => {
      expect(requiredArgs).toEqual([]);
    });
  });
});
