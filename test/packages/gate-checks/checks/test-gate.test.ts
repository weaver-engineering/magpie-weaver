import { describe, it, expect, vi, beforeEach } from "vitest";
import { fn, requiredArgs } from "@magpieweaver/gate-checks/src/checks/test-gate.js";
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
      currentBranch: vi.fn().mockResolvedValue("task/MAG-30"),
    } as unknown as GitInspector,
    coverage: {
      runTestsWithCoverage: vi.fn(),
      getNewLineCoverage: vi.fn(),
      getCoverage: vi.fn(),
    } as unknown as CoverageInspector,
  };
}

describe("test-gate", () => {
  let inspectors: Inspectors;

  beforeEach(() => {
    inspectors = createMockInspectors();
  });

  describe("§4.13 spec-gate — Valid spec gate", () => {
    it("returns passed=true for exactly 1 commit with valid spec commit", async () => {
      const mockMergeBase = inspectors.git.mergeBase as ReturnType<typeof vi.fn>;
      mockMergeBase.mockResolvedValue("merge-base-sha");

      const mockRevList = inspectors.git.revList as ReturnType<typeof vi.fn>;
      mockRevList.mockResolvedValueOnce(["spec-commit-sha"]);
      mockRevList.mockResolvedValueOnce([]);

      const mockCommitMessages = inspectors.git.commitMessages as ReturnType<typeof vi.fn>;
      mockCommitMessages.mockResolvedValue(["MAG-30 Add spec\n\nBody"]);

      const mockLsTree = inspectors.git.lsTree as ReturnType<typeof vi.fn>;
      mockLsTree.mockResolvedValue([
        "docs/tasks/task-MAG-30/task-MAG-30.md",
        "docs/tasks/task-MAG-30/task-MAG-30-04-spec.md",
      ]);

      const mockDiffTree = inspectors.git.diffTree as ReturnType<typeof vi.fn>;
      mockDiffTree.mockResolvedValue([
        "docs/tasks/task-MAG-30/task-MAG-30-04-spec.md",
      ]);

      const result = await fn(inspectors, {
        "destination-branch": "main",
      });

      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
      expect(result.check).toBe("test-gate");
      expect(result.values.commit).toBe("spec-commit-sha");
      expect(mockMergeBase).toHaveBeenCalledWith("HEAD", "main");
      expect(inspectors.git.currentBranch).toHaveBeenCalled();
    });

    it("defaults destination-branch to main when not provided", async () => {
      const mockMergeBase = inspectors.git.mergeBase as ReturnType<typeof vi.fn>;
      mockMergeBase.mockResolvedValue("merge-base-sha");

      const mockRevList = inspectors.git.revList as ReturnType<typeof vi.fn>;
      mockRevList.mockResolvedValueOnce(["sha"]);
      mockRevList.mockResolvedValueOnce([]);

      const mockCommitMessages = inspectors.git.commitMessages as ReturnType<typeof vi.fn>;
      mockCommitMessages.mockResolvedValue(["MAG-30 Add spec\n\nBody"]);

      const mockLsTree = inspectors.git.lsTree as ReturnType<typeof vi.fn>;
      mockLsTree.mockResolvedValue([
        "docs/tasks/task-MAG-30/task-MAG-30.md",
        "docs/tasks/task-MAG-30/task-MAG-30-04-spec.md",
      ]);

      const mockDiffTree = inspectors.git.diffTree as ReturnType<typeof vi.fn>;
      mockDiffTree.mockResolvedValue([
        "docs/tasks/task-MAG-30/task-MAG-30-04-spec.md",
      ]);

      const result = await fn(inspectors, {});

      expect(result.passed).toBe(true);
      expect(mockMergeBase).toHaveBeenCalledWith("HEAD", "main");
    });
  });

  describe("Branch ref fails", () => {
    it("returns passed=false when branch-ref validation fails", async () => {
      (inspectors.git.currentBranch as ReturnType<typeof vi.fn>).mockResolvedValue("invalid-branch");

      const result = await fn(inspectors, { "destination-branch": "main" });

      expect(result.passed).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.check).toBe("test-gate");
    });
  });

  describe("Not exactly 1 commit", () => {
    it("returns passed=false when no commits between HEAD and merge base", async () => {
      const mockMergeBase = inspectors.git.mergeBase as ReturnType<typeof vi.fn>;
      mockMergeBase.mockResolvedValue("merge-base-sha");

      const mockRevList = inspectors.git.revList as ReturnType<typeof vi.fn>;
      mockRevList.mockResolvedValue([]);

      const result = await fn(inspectors, { "destination-branch": "main" });

      expect(result.passed).toBe(false);
      expect(result.violations[0]).toContain("Expected exactly 1 commit");
      expect(result.violations[0]).toContain("found 0");
    });

    it("returns passed=false when multiple commits between HEAD and merge base", async () => {
      const mockMergeBase = inspectors.git.mergeBase as ReturnType<typeof vi.fn>;
      mockMergeBase.mockResolvedValue("merge-base-sha");

      const mockRevList = inspectors.git.revList as ReturnType<typeof vi.fn>;
      mockRevList.mockResolvedValue(["a", "b", "c"]);

      const result = await fn(inspectors, { "destination-branch": "main" });

      expect(result.passed).toBe(false);
      expect(result.violations[0]).toContain("Expected exactly 1 commit");
      expect(result.violations[0]).toContain("found 3");
    });
  });

  describe("Destination branch has advanced", () => {
    it("returns passed=false when destination branch has commits past merge base", async () => {
      const mockMergeBase = inspectors.git.mergeBase as ReturnType<typeof vi.fn>;
      mockMergeBase.mockResolvedValue("merge-base-sha");

      const mockRevList = inspectors.git.revList as ReturnType<typeof vi.fn>;
      mockRevList.mockResolvedValueOnce(["spec-commit-sha"]);
      mockRevList.mockResolvedValueOnce(["dest-commit-1"]);

      const result = await fn(inspectors, { "destination-branch": "main" });

      expect(result.passed).toBe(false);
      expect(result.violations[0]).toContain("advanced past the merge base");
    });
  });

  describe("Spec validation fail", () => {
    it("returns passed=false when spec validation fails", async () => {
      const mockMergeBase = inspectors.git.mergeBase as ReturnType<typeof vi.fn>;
      mockMergeBase.mockResolvedValue("merge-base-sha");

      const mockRevList = inspectors.git.revList as ReturnType<typeof vi.fn>;
      mockRevList.mockResolvedValueOnce(["spec-commit-sha"]);
      mockRevList.mockResolvedValueOnce([]);

      const mockCommitMessages = inspectors.git.commitMessages as ReturnType<typeof vi.fn>;
      mockCommitMessages.mockResolvedValue(["Bad title\n\nBody"]);

      const result = await fn(inspectors, { "destination-branch": "main" });

      expect(result.passed).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.check).toBe("test-gate");
    });
  });

  describe("throws on invalid destination branch", () => {
    it("throws when mergeBase rejects", async () => {
      const mockMergeBase = inspectors.git.mergeBase as ReturnType<typeof vi.fn>;
      mockMergeBase.mockRejectedValue(new Error("fatal"));

      await expect(
        fn(inspectors, { "destination-branch": "bad-branch" }),
      ).rejects.toThrow("Invalid argument");
    });
  });

  describe("requiredArgs", () => {
    it("exports an empty required args list", () => {
      expect(requiredArgs).toEqual([]);
    });
  });
});
