import { describe, it, expect, vi, beforeEach } from "vitest";
import { fn, requiredArgs } from "@magpieweaver/gate-checks/src/checks/branch-ref.js";
import type { GitInspector } from "@magpieweaver/gate-checks/dist/git-interface.js";
import type { CoverageInspector, Inspectors } from "@magpieweaver/gate-checks/dist/types.js";

function createMockInspectors(branch = "task/MAG-30"): Inspectors {
  return {
    git: {
      currentBranch: vi.fn().mockResolvedValue(branch),
    } as unknown as GitInspector,
    coverage: {} as unknown as CoverageInspector,
  };
}

describe("branch-ref", () => {
  let inspectors: Inspectors;

  beforeEach(() => {
    inspectors = createMockInspectors();
  });

  describe("valid branch ref", () => {
    it("returns passed=true with valid head-ref", async () => {
      const result = await fn(inspectors, { "head-ref": "task/MAG-30" });
      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
      expect(result.values.ref).toBe("MAG-30");
    });

    it("defaults head-ref to current branch name", async () => {
      const result = await fn(inspectors, {});
      expect(result.passed).toBe(true);
      expect(result.values.ref).toBe("MAG-30");
      expect(inspectors.git.currentBranch).toHaveBeenCalled();
    });

    it("accepts --ref matching the branch ref", async () => {
      const result = await fn(inspectors, { "head-ref": "task/MAG-30", ref: "MAG-30" });
      expect(result.passed).toBe(true);
      expect(result.values.ref).toBe("MAG-30");
    });
  });

  describe("invalid head-ref format", () => {
    it("returns passed=false when head-ref does not match */{ref}", async () => {
      const result = await fn(inspectors, { "head-ref": "invalid-branch" });
      expect(result.passed).toBe(false);
      expect(result.violations[0]).toContain("does not match pattern */{ref}");
    });
  });

  describe("invalid ref pattern", () => {
    it("returns passed=false when extracted ref is not [A-Z]+-[0-9]+", async () => {
      inspectors = createMockInspectors("task/FOO");
      const result = await fn(inspectors, {});
      expect(result.passed).toBe(false);
      expect(result.violations[0]).toContain("does not match required pattern");
    });
  });

  describe("--ref validation", () => {
    it("returns passed=false when --ref does not match extracted ref", async () => {
      const result = await fn(inspectors, { "head-ref": "task/MAG-30", ref: "MAG-99" });
      expect(result.passed).toBe(false);
      expect(result.violations[0]).toContain("Ref mismatch");
    });

    it("returns passed=false when --ref has invalid format", async () => {
      const result = await fn(inspectors, { "head-ref": "task/MAG-30", ref: "bad-ref" });
      expect(result.passed).toBe(false);
      expect(result.violations[0]).toContain("does not match required pattern");
    });
  });

  describe("requiredArgs", () => {
    it("exports an empty required args list", () => {
      expect(requiredArgs).toEqual([]);
    });
  });
});
