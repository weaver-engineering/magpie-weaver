import { describe, it, expect, vi } from "vitest";
import { fn, requiredArgs } from "@magpieweaver/gate-checks/src/checks/coverage.js";
import type { CoverageInspector, GitInspector, Inspectors } from "@magpieweaver/gate-checks/dist/types.js";

function createMockInspectors(
  coverageExists: boolean,
  testsPass: boolean,
  lineCoverage: number,
  newLineCoverage: number,
): Inspectors {
  return {
    git: {} as GitInspector,
    coverage: {
      getCoverage: vi.fn().mockImplementation(async () => {
        if (!coverageExists) throw new Error("No coverage data");
        return lineCoverage;
      }),
      getNewLineCoverage: vi.fn().mockImplementation(async () => {
        if (!coverageExists) throw new Error("No coverage data");
        return newLineCoverage;
      }),
      runTestsWithCoverage: vi.fn().mockImplementation(() => {
        if (!testsPass) throw new Error("Tests failed");
      }),
    } as CoverageInspector,
  };
}

describe("coverage", () => {
  describe("§3.10.1 Coverage Thresholds Met", () => {
    it("returns passed=true when both thresholds met", async () => {
      const inspectors = createMockInspectors(true, true, 85, 95);
      const result = await fn(inspectors, { "expect-failure": false });
      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
      expect(result.values.lineCoverage).toBe(85);
      expect(result.values.newLineCoverage).toBe(95);
    });
  });

  describe("§3.10.2 New Line Coverage Below Threshold", () => {
    it("returns passed=false when new line coverage <= 90%", async () => {
      const inspectors = createMockInspectors(true, true, 85, 85);
      const result = await fn(inspectors, { "expect-failure": false });
      expect(result.passed).toBe(false);
      expect(result.violations[0]).toContain("below threshold");
      expect(result.violations[0]).toContain("90%");
    });
  });

  describe("§3.10.3 Line Coverage Below Threshold", () => {
    it("returns passed=false when line coverage <= 80%", async () => {
      const inspectors = createMockInspectors(true, true, 75, 95);
      const result = await fn(inspectors, { "expect-failure": false });
      expect(result.passed).toBe(false);
      expect(result.violations[0]).toContain("Line coverage");
      expect(result.violations[0]).toContain("80%");
    });

    it("reports both violations when both thresholds missed", async () => {
      const inspectors = createMockInspectors(true, true, 70, 80);
      const result = await fn(inspectors, { "expect-failure": false });
      expect(result.passed).toBe(false);
      expect(result.violations).toHaveLength(2);
    });
  });

  describe("§3.10.4 Expect Failure With Failing Tests", () => {
    it("returns passed=true when --expect-failure and tests fail", async () => {
      const inspectors = createMockInspectors(true, false, 0, 0);
      const result = await fn(inspectors, { "expect-failure": true });
      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });
  });

  describe("§3.10.5 Expect Failure With Passing Tests", () => {
    it("returns passed=false when --expect-failure but tests pass", async () => {
      const inspectors = createMockInspectors(true, true, 0, 0);
      const result = await fn(inspectors, { "expect-failure": true });
      expect(result.passed).toBe(false);
      expect(result.violations[0]).toContain("expected to fail");
    });
  });

  describe("§3.10.6 Coverage Not Run", () => {
    it("returns passed=false when coverage data does not exist", async () => {
      const inspectors = createMockInspectors(false, true, 0, 0);
      const result = await fn(inspectors, { "expect-failure": false });
      expect(result.passed).toBe(false);
      expect(result.violations).toContain("Coverage must be run first");
    });
  });

  describe("requiredArgs", () => {
    it("exports the correct required argument names", () => {
      expect(requiredArgs).toEqual(["expect-failure"]);
    });
  });
});
