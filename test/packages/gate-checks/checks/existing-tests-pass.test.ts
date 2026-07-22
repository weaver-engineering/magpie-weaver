import { describe, it, expect, vi } from "vitest";
import { fn, requiredArgs } from "@magpieweaver/gate-checks/src/checks/existing-tests-pass.js";
import type { CoverageInspector, GitInspector, Inspectors } from "@magpieweaver/gate-checks/dist/types.js";

function createMockInspectors(coverageExists: boolean, testsPass: boolean): Inspectors {
  return {
    git: {} as GitInspector,
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
    it("returns passed=true when coverage exists and tests pass", async () => {
      const inspectors = createMockInspectors(true, true);
      const result = await fn(inspectors, { "pr-base-sha": "base", "pr-head-sha": "head" });
      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("exposes check name and args in result", async () => {
      const inspectors = createMockInspectors(true, true);
      const result = await fn(inspectors, { "pr-base-sha": "base", "pr-head-sha": "head" });
      expect(result.check).toBe("existing-tests-pass");
      expect(result.args).toEqual({ "pr-base-sha": "base", "pr-head-sha": "head" });
    });
  });

  describe("§3.8.2 Some Existing Tests Fail", () => {
    it("returns passed=false when tests fail", async () => {
      const inspectors = createMockInspectors(true, false);
      const result = await fn(inspectors, { "pr-base-sha": "base", "pr-head-sha": "head" });
      expect(result.passed).toBe(false);
      expect(result.violations).toContain("Some existing tests fail");
    });
  });

  describe("§3.8.3 Coverage Not Run", () => {
    it("returns passed=false when coverage data does not exist", async () => {
      const inspectors = createMockInspectors(false, true);
      const result = await fn(inspectors, { "pr-base-sha": "base", "pr-head-sha": "head" });
      expect(result.passed).toBe(false);
      expect(result.violations).toContain("Coverage must be run first");
    });
  });

  describe("requiredArgs", () => {
    it("exports the correct required argument names", () => {
      expect(requiredArgs).toEqual(["pr-base-sha", "pr-head-sha"]);
    });
  });
});
