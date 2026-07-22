import { describe, it, expect, vi, beforeEach } from "vitest";
import { fn, requiredArgs } from "@magpieweaver/gate-checks/src/checks/get-inbound-commits.js";
import type { GitInspector } from "@magpieweaver/gate-checks/dist/git-interface.js";
import type { CoverageInspector } from "@magpieweaver/gate-checks/dist/coverage-interface.js";
import type { Inspectors } from "@magpieweaver/gate-checks/dist/types.js";

function createMockInspectors(): Inspectors {
  return {
    git: {
      mergeBase: vi.fn(),
      diffTree: vi.fn(),
      lsTree: vi.fn(),
      commitMessages: vi.fn(),
      added: vi.fn(),
      modified: vi.fn(),
      deleted: vi.fn(),
      revList: vi.fn(),
    } as unknown as GitInspector,
    coverage: {
      runTestsWithCoverage: vi.fn(),
      getNewLineCoverage: vi.fn(),
      getCoverage: vi.fn(),
    } as unknown as CoverageInspector,
  };
}

describe("get-inbound-commits", () => {
  let inspectors: Inspectors;

  beforeEach(() => {
    inspectors = createMockInspectors();
  });

  describe("§3.3.1 Commits Present", () => {
    it("returns passed=true with commits when revList returns SHAs", async () => {
      const mockRevList = inspectors.git.revList as ReturnType<typeof vi.fn>;
      mockRevList.mockResolvedValue(["abc123", "def456", "ghi789"]);

      const result = await fn(inspectors, {
        "base-ref": "sha-base",
        "head-ref": "sha-head",
      });

      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
      expect(result.values.commits).toEqual(["abc123", "def456", "ghi789"]);
      expect(mockRevList).toHaveBeenCalledWith("sha-base", "sha-head");
    });

    it("exposes the check name and args in the result", async () => {
      const mockRevList = inspectors.git.revList as ReturnType<typeof vi.fn>;
      mockRevList.mockResolvedValue(["abc123"]);

      const result = await fn(inspectors, {
        "base-ref": "base",
        "head-ref": "head",
      });

      expect(result.check).toBe("get-inbound-commits");
      expect(result.args).toEqual({
        "base-ref": "base",
        "head-ref": "head",
      });
    });
  });

  describe("§3.3.2 No Commits (Refs Equal)", () => {
    it("returns passed=false when base ref equals head ref", async () => {
      const mockRevList = inspectors.git.revList as ReturnType<typeof vi.fn>;

      const result = await fn(inspectors, {
        "base-ref": "same-ref",
        "head-ref": "same-ref",
      });

      expect(result.passed).toBe(false);
      expect(result.violations).toContain(
        "No commits between --base-ref and --head-ref",
      );
      expect(mockRevList).not.toHaveBeenCalled();
    });
  });

  describe("Invalid ref (throws)", () => {
    it("throws when revList rejects with an error (invalid ref)", async () => {
      const mockRevList = inspectors.git.revList as ReturnType<typeof vi.fn>;
      mockRevList.mockRejectedValue(new Error("fatal: ambiguous argument"));

      await expect(
        fn(inspectors, {
          "base-ref": "bad-ref",
          "head-ref": "also-bad",
        }),
      ).rejects.toThrow(
        "Invalid argument: --base-ref=\"bad-ref\" or --head-ref=\"also-bad\" could not be resolved",
      );
    });
  });

  describe("revList returns empty", () => {
    it("returns passed=false when revList returns an empty array", async () => {
      const mockRevList = inspectors.git.revList as ReturnType<typeof vi.fn>;
      mockRevList.mockResolvedValue([]);

      const result = await fn(inspectors, {
        "base-ref": "base",
        "head-ref": "head",
      });

      expect(result.passed).toBe(false);
      expect(result.violations).toContain(
        "No commits between --base-ref and --head-ref",
      );
    });
  });

  describe("requiredArgs", () => {
    it("exports the correct required argument names", () => {
      expect(requiredArgs).toEqual(["base-ref", "head-ref"]);
    });
  });
});
