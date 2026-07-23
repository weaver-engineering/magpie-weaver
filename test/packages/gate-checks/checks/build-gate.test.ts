import { describe, it, expect, vi, beforeEach } from "vitest";
import { fn, requiredArgs } from "@magpieweaver/gate-checks/src/checks/build-gate.js";
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
      currentBranch: vi.fn().mockResolvedValue("build/MAG-30"),
      workingTreeChanges: vi.fn(),
    } as unknown as GitInspector,
    coverage: {
      runTestsWithCoverage: vi.fn(),
      getNewLineCoverage: vi.fn(),
      getCoverage: vi.fn(),
      getTestResults: vi.fn(),
    } as unknown as CoverageInspector,
  };
}

function setupCoverageMocks(inspectors: Inspectors): void {
  (inspectors.coverage.runTestsWithCoverage as ReturnType<typeof vi.fn>).mockImplementation(() => {
    throw new Error("Tests failed");
  });
  (inspectors.coverage.getCoverage as ReturnType<typeof vi.fn>).mockResolvedValue(85);
  (inspectors.coverage.getNewLineCoverage as ReturnType<typeof vi.fn>).mockResolvedValue(95);
  (inspectors.coverage.getTestResults as ReturnType<typeof vi.fn>).mockResolvedValue({
    numTotalTests: 10,
    numFailedTests: 1,
    failingTestFiles: ["test/new.test.ts"],
  });
  (inspectors.git.workingTreeChanges as ReturnType<typeof vi.fn>).mockResolvedValue([]);
}

describe("build-gate", () => {
  let inspectors: Inspectors;

  beforeEach(() => {
    inspectors = createMockInspectors();
  });

  describe("Valid build gate", () => {
    it("returns passed=true for exactly 2 commits with valid spec and test commits", async () => {
      (inspectors.git.currentBranch as ReturnType<typeof vi.fn>).mockResolvedValue("build/MAG-30");

      const mockMergeBase = inspectors.git.mergeBase as ReturnType<typeof vi.fn>;
      mockMergeBase.mockResolvedValue("merge-base-sha");

      const mockRevList = inspectors.git.revList as ReturnType<typeof vi.fn>;
      mockRevList.mockResolvedValueOnce(["test-commit-sha", "spec-commit-sha"]);
      mockRevList.mockResolvedValueOnce([]);

      const mockCommitMessages = inspectors.git.commitMessages as ReturnType<typeof vi.fn>;
      mockCommitMessages.mockImplementation((ref: string) => {
        if (ref === "spec-commit-sha") {
          return Promise.resolve(["MAG-30 Add spec\n\nBody"]);
        }
        return Promise.resolve(["MAG-30 Add tests\n\nTest body"]);
      });

      const mockLsTree = inspectors.git.lsTree as ReturnType<typeof vi.fn>;
      mockLsTree.mockResolvedValue([
        "docs/tasks/task-MAG-30/task-MAG-30.md",
        "docs/tasks/task-MAG-30/task-MAG-30-04-spec.md",
      ]);

      const mockDiffTree = inspectors.git.diffTree as ReturnType<typeof vi.fn>;
      mockDiffTree.mockImplementation((ref: string) => {
        if (ref === "test-commit-sha") {
          return Promise.resolve(["test/new.test.ts"]);
        }
        return Promise.resolve([
          "docs/tasks/task-MAG-30/task-MAG-30-04-spec.md",
        ]);
      });

      const mockAdded = inspectors.git.added as ReturnType<typeof vi.fn>;
      mockAdded.mockImplementation((ref: string) => {
        if (ref === "test-commit-sha") {
          return Promise.resolve(["test/new.test.ts"]);
        }
        return Promise.resolve([]);
      });

      const mockModified = inspectors.git.modified as ReturnType<typeof vi.fn>;
      mockModified.mockResolvedValue([]);

      setupCoverageMocks(inspectors);

      const result = await fn(inspectors, {
        "destination-branch": "main",
      });

      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
      expect(result.check).toBe("build-gate");
      expect(mockMergeBase).toHaveBeenCalledWith("HEAD", "main");
    });

    it("defaults destination-branch to main when not provided", async () => {
      (inspectors.git.currentBranch as ReturnType<typeof vi.fn>).mockResolvedValue("build/MAG-30");

      const mockMergeBase = inspectors.git.mergeBase as ReturnType<typeof vi.fn>;
      mockMergeBase.mockResolvedValue("merge-base-sha");

      const mockRevList = inspectors.git.revList as ReturnType<typeof vi.fn>;
      mockRevList.mockResolvedValueOnce(["test-sha", "spec-sha"]);
      mockRevList.mockResolvedValueOnce([]);

      const mockCommitMessages = inspectors.git.commitMessages as ReturnType<typeof vi.fn>;
      mockCommitMessages.mockImplementation((ref: string) => {
        if (ref === "spec-sha") {
          return Promise.resolve(["MAG-30 Add spec\n\nBody"]);
        }
        return Promise.resolve(["MAG-30 Add tests\n\nTest body"]);
      });

      const mockLsTree = inspectors.git.lsTree as ReturnType<typeof vi.fn>;
      mockLsTree.mockResolvedValue([
        "docs/tasks/task-MAG-30/task-MAG-30.md",
        "docs/tasks/task-MAG-30/task-MAG-30-04-spec.md",
      ]);

      const mockDiffTree = inspectors.git.diffTree as ReturnType<typeof vi.fn>;
      mockDiffTree.mockImplementation((ref: string) => {
        if (ref === "test-sha") {
          return Promise.resolve(["test/new.test.ts"]);
        }
        return Promise.resolve([
          "docs/tasks/task-MAG-30/task-MAG-30-04-spec.md",
        ]);
      });

      const mockAdded = inspectors.git.added as ReturnType<typeof vi.fn>;
      mockAdded.mockImplementation((ref: string) => {
        if (ref === "test-sha") {
          return Promise.resolve(["test/new.test.ts"]);
        }
        return Promise.resolve([]);
      });

      const mockModified = inspectors.git.modified as ReturnType<typeof vi.fn>;
      mockModified.mockResolvedValue([]);

      setupCoverageMocks(inspectors);

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
      expect(result.check).toBe("build-gate");
    });
  });

  describe("Not exactly 2 commits", () => {
    it("returns passed=false when no commits between HEAD and merge base", async () => {
      const mockMergeBase = inspectors.git.mergeBase as ReturnType<typeof vi.fn>;
      mockMergeBase.mockResolvedValue("merge-base-sha");

      const mockRevList = inspectors.git.revList as ReturnType<typeof vi.fn>;
      mockRevList.mockResolvedValue([]);

      const result = await fn(inspectors, { "destination-branch": "main" });

      expect(result.passed).toBe(false);
      expect(result.violations[0]).toContain("Expected exactly 2 commits");
      expect(result.violations[0]).toContain("found 0");
    });

    it("returns passed=false when 1 commit between HEAD and merge base", async () => {
      const mockMergeBase = inspectors.git.mergeBase as ReturnType<typeof vi.fn>;
      mockMergeBase.mockResolvedValue("merge-base-sha");

      const mockRevList = inspectors.git.revList as ReturnType<typeof vi.fn>;
      mockRevList.mockResolvedValue(["only-one"]);

      const result = await fn(inspectors, { "destination-branch": "main" });

      expect(result.passed).toBe(false);
      expect(result.violations[0]).toContain("Expected exactly 2 commits");
      expect(result.violations[0]).toContain("found 1");
    });
  });

  describe("Destination branch has advanced", () => {
    it("returns passed=false when destination branch has commits past merge base", async () => {
      const mockMergeBase = inspectors.git.mergeBase as ReturnType<typeof vi.fn>;
      mockMergeBase.mockResolvedValue("merge-base-sha");

      const mockRevList = inspectors.git.revList as ReturnType<typeof vi.fn>;
      mockRevList.mockResolvedValueOnce(["commit-a", "commit-b"]);
      mockRevList.mockResolvedValueOnce(["dest-commit-1"]);

      const result = await fn(inspectors, { "destination-branch": "main" });

      expect(result.passed).toBe(false);
      expect(result.violations[0]).toContain("advanced past the merge base");
    });
  });

  describe("Spec validation fails", () => {
    it("returns passed=false when spec commit validation fails", async () => {
      const mockMergeBase = inspectors.git.mergeBase as ReturnType<typeof vi.fn>;
      mockMergeBase.mockResolvedValue("merge-base-sha");

      const mockRevList = inspectors.git.revList as ReturnType<typeof vi.fn>;
      mockRevList.mockResolvedValueOnce(["test-sha", "spec-sha"]);
      mockRevList.mockResolvedValueOnce([]);

      const mockCommitMessages = inspectors.git.commitMessages as ReturnType<typeof vi.fn>;
      mockCommitMessages.mockResolvedValue(["Bad title\n\nBody"]);

      const result = await fn(inspectors, { "destination-branch": "main" });

      expect(result.passed).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.check).toBe("build-gate");
    });
  });

  describe("Test validation fails", () => {
    it("returns passed=false when test commit validation fails", async () => {
      const mockMergeBase = inspectors.git.mergeBase as ReturnType<typeof vi.fn>;
      mockMergeBase.mockResolvedValue("merge-base-sha");

      const mockRevList = inspectors.git.revList as ReturnType<typeof vi.fn>;
      mockRevList.mockResolvedValueOnce(["test-sha", "spec-sha"]);
      mockRevList.mockResolvedValueOnce([]);

      const mockCommitMessages = inspectors.git.commitMessages as ReturnType<typeof vi.fn>;
      mockCommitMessages
        .mockResolvedValueOnce(["MAG-30 Add spec\n\nBody"])
        .mockResolvedValueOnce(["MAG-30 Bad test\n\nBody"]);

      const mockLsTree = inspectors.git.lsTree as ReturnType<typeof vi.fn>;
      mockLsTree.mockResolvedValue([
        "docs/tasks/task-MAG-30/task-MAG-30.md",
        "docs/tasks/task-MAG-30/task-MAG-30-04-spec.md",
      ]);

      const mockDiffTree = inspectors.git.diffTree as ReturnType<typeof vi.fn>;
      mockDiffTree.mockResolvedValue([
        "docs/tasks/task-MAG-30/task-MAG-30-04-spec.md",
      ]);

      const mockAdded = inspectors.git.added as ReturnType<typeof vi.fn>;
      mockAdded.mockResolvedValue([]);

      const mockModified = inspectors.git.modified as ReturnType<typeof vi.fn>;
      mockModified.mockResolvedValue([]);

      const result = await fn(inspectors, { "destination-branch": "main" });

      expect(result.passed).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.check).toBe("build-gate");
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
