import { describe, it, expect, vi, beforeEach } from "vitest";
import { fn, requiredArgs } from "@magpieweaver/gate-checks/src/checks/main-gate.js";
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
  (inspectors.coverage.runTestsWithCoverage as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
  (inspectors.coverage.getCoverage as ReturnType<typeof vi.fn>).mockResolvedValue(85);
  (inspectors.coverage.getNewLineCoverage as ReturnType<typeof vi.fn>).mockResolvedValue(95);
  (inspectors.coverage.getTestResults as ReturnType<typeof vi.fn>).mockResolvedValue({
    numTotalTests: 10,
    numFailedTests: 1,
    failingTestFiles: ["test/new.test.ts"],
  });
  (inspectors.git.workingTreeChanges as ReturnType<typeof vi.fn>).mockResolvedValue([]);
}

function setupBuildSuccess(inspectors: Inspectors): void {
  const mockMergeBase = inspectors.git.mergeBase as ReturnType<typeof vi.fn>;
  mockMergeBase.mockResolvedValue("merge-base-sha");

  const mockRevList = inspectors.git.revList as ReturnType<typeof vi.fn>;
  mockRevList.mockResolvedValueOnce(["build-commit-sha", "test-commit-sha", "spec-commit-sha"]);
  mockRevList.mockResolvedValueOnce([]);

  const mockCommitMessages = inspectors.git.commitMessages as ReturnType<typeof vi.fn>;
  mockCommitMessages.mockImplementation((ref: string) => {
    if (ref === "spec-commit-sha") {
      return Promise.resolve(["MAG-30 Add spec\n\nBody"]);
    }
    if (ref === "test-commit-sha") {
      return Promise.resolve(["MAG-30 Add tests\n\nTest body"]);
    }
    return Promise.resolve(["MAG-30 Build\n\nBuild body"]);
  });

  const mockLsTree = inspectors.git.lsTree as ReturnType<typeof vi.fn>;
  mockLsTree.mockResolvedValue([
    "docs/tasks/task-MAG-30/task-MAG-30.md",
    "docs/tasks/task-MAG-30/task-MAG-30-04-spec.md",
  ]);

  const mockDiffTree = inspectors.git.diffTree as ReturnType<typeof vi.fn>;
  mockDiffTree.mockImplementation((ref: string) => {
    if (ref === "spec-commit-sha") {
      return Promise.resolve(["docs/tasks/task-MAG-30/task-MAG-30-04-spec.md"]);
    }
    if (ref === "test-commit-sha") {
      return Promise.resolve(["test/new.test.ts"]);
    }
    return Promise.resolve(["packages/foo/src/index.ts"]);
  });

  const mockAdded = inspectors.git.added as ReturnType<typeof vi.fn>;
  mockAdded.mockImplementation((ref: string) => {
    if (ref === "spec-commit-sha") {
      return Promise.resolve(["docs/tasks/task-MAG-30/task-MAG-30-04-spec.md"]);
    }
    if (ref === "test-commit-sha") {
      return Promise.resolve(["test/new.test.ts"]);
    }
    if (ref === "build-commit-sha") {
      return Promise.resolve(["packages/foo/src/index.ts"]);
    }
    return Promise.resolve([]);
  });

  const mockModified = inspectors.git.modified as ReturnType<typeof vi.fn>;
  mockModified.mockResolvedValue([]);

  const mockDeleted = inspectors.git.deleted as ReturnType<typeof vi.fn>;
  mockDeleted.mockResolvedValue([]);
}

describe("main-gate", () => {
  let inspectors: Inspectors;

  beforeEach(() => {
    inspectors = createMockInspectors();
  });

  describe("Valid build branch", () => {
    it("returns passed=true for exactly 3 commits with valid spec, test, build commits", async () => {
      setupBuildSuccess(inspectors);
      setupCoverageMocks(inspectors);

      const result = await fn(inspectors, { "destination-branch": "main" });

      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
      expect(result.check).toBe("main-gate");
    });

    it("defaults destination-branch to main when not provided", async () => {
      setupBuildSuccess(inspectors);
      setupCoverageMocks(inspectors);

      const result = await fn(inspectors, {});

      expect(result.passed).toBe(true);
    });
  });

  describe("Valid task branch", () => {
    it("returns passed=true for exactly 1 commit with valid task commit", async () => {
      (inspectors.git.currentBranch as ReturnType<typeof vi.fn>).mockResolvedValue("task/MAG-30");

      const mockMergeBase = inspectors.git.mergeBase as ReturnType<typeof vi.fn>;
      mockMergeBase.mockResolvedValue("merge-base-sha");

      const mockRevList = inspectors.git.revList as ReturnType<typeof vi.fn>;
      mockRevList.mockResolvedValueOnce(["task-commit-sha"]);
      mockRevList.mockResolvedValueOnce([]);

      const mockCommitMessages = inspectors.git.commitMessages as ReturnType<typeof vi.fn>;
      mockCommitMessages.mockResolvedValue(["MAG-30 Task commit\n\nTask body"]);

      const mockAdded = inspectors.git.added as ReturnType<typeof vi.fn>;
      mockAdded.mockResolvedValue([]);

      const mockModified = inspectors.git.modified as ReturnType<typeof vi.fn>;
      mockModified.mockResolvedValue([]);

      const mockDeleted = inspectors.git.deleted as ReturnType<typeof vi.fn>;
      mockDeleted.mockResolvedValue([]);

      const result = await fn(inspectors, { "destination-branch": "main" });

      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
      expect(result.check).toBe("main-gate");
    });
  });

  describe("Branch ref fails", () => {
    it("returns passed=false when branch-ref validation fails", async () => {
      (inspectors.git.currentBranch as ReturnType<typeof vi.fn>).mockResolvedValue("invalid-branch");

      const result = await fn(inspectors, { "destination-branch": "main" });

      expect(result.passed).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.check).toBe("main-gate");
    });
  });

  describe("Wrong commit count for build branch", () => {
    it("returns passed=false when 2 commits found", async () => {
      const mockMergeBase = inspectors.git.mergeBase as ReturnType<typeof vi.fn>;
      mockMergeBase.mockResolvedValue("merge-base-sha");

      const mockRevList = inspectors.git.revList as ReturnType<typeof vi.fn>;
      mockRevList.mockResolvedValueOnce(["a", "b"]);
      mockRevList.mockResolvedValueOnce([]);

      const result = await fn(inspectors, { "destination-branch": "main" });

      expect(result.passed).toBe(false);
      expect(result.violations[0]).toContain("Expected exactly 3 commits");
    });
  });

  describe("Wrong commit count for task branch", () => {
    it("returns passed=false when 2 commits found on task branch", async () => {
      (inspectors.git.currentBranch as ReturnType<typeof vi.fn>).mockResolvedValue("task/MAG-30");

      const mockMergeBase = inspectors.git.mergeBase as ReturnType<typeof vi.fn>;
      mockMergeBase.mockResolvedValue("merge-base-sha");

      const mockRevList = inspectors.git.revList as ReturnType<typeof vi.fn>;
      mockRevList.mockResolvedValueOnce(["a", "b"]);
      mockRevList.mockResolvedValueOnce([]);

      const result = await fn(inspectors, { "destination-branch": "main" });

      expect(result.passed).toBe(false);
      expect(result.violations[0]).toContain("Expected exactly 1 commit");
    });
  });

  describe("Unrecognized branch", () => {
    it("returns passed=false when branch does not match build/{ref} or task/{ref}", async () => {
      (inspectors.git.currentBranch as ReturnType<typeof vi.fn>).mockResolvedValue("feature/MAG-30");

      const mockMergeBase = inspectors.git.mergeBase as ReturnType<typeof vi.fn>;
      mockMergeBase.mockResolvedValue("merge-base-sha");

      const mockRevList = inspectors.git.revList as ReturnType<typeof vi.fn>;
      mockRevList.mockResolvedValueOnce([]);
      mockRevList.mockResolvedValueOnce([]);

      const result = await fn(inspectors, { "destination-branch": "main" });

      expect(result.passed).toBe(false);
      expect(result.violations[0]).toContain("does not match build/{ref} or task/{ref}");
    });
  });

  describe("Destination branch has advanced", () => {
    it("returns passed=false when destination branch has commits past merge base", async () => {
      const mockMergeBase = inspectors.git.mergeBase as ReturnType<typeof vi.fn>;
      mockMergeBase.mockResolvedValue("merge-base-sha");

      const mockRevList = inspectors.git.revList as ReturnType<typeof vi.fn>;
      mockRevList.mockResolvedValueOnce([]);
      mockRevList.mockResolvedValueOnce(["dest-commit"]);

      const result = await fn(inspectors, { "destination-branch": "main" });

      expect(result.passed).toBe(false);
      expect(result.violations[0]).toContain("advanced past the merge base");
    });
  });

  describe("Spec commit validation fails", () => {
    it("returns passed=false when spec commit validation fails on build branch", async () => {
      const mockMergeBase = inspectors.git.mergeBase as ReturnType<typeof vi.fn>;
      mockMergeBase.mockResolvedValue("merge-base-sha");

      const mockRevList = inspectors.git.revList as ReturnType<typeof vi.fn>;
      mockRevList.mockResolvedValueOnce(["build-sha", "test-sha", "spec-sha"]);
      mockRevList.mockResolvedValueOnce([]);

      const mockCommitMessages = inspectors.git.commitMessages as ReturnType<typeof vi.fn>;
      mockCommitMessages.mockResolvedValue(["Bad title\n\nBody"]);

      const result = await fn(inspectors, { "destination-branch": "main" });

      expect(result.passed).toBe(false);
      expect(result.check).toBe("main-gate");
    });
  });

  describe("Test commit validation fails", () => {
    it("returns passed=false when test commit validation fails on build branch", async () => {
      const mockMergeBase = inspectors.git.mergeBase as ReturnType<typeof vi.fn>;
      mockMergeBase.mockResolvedValue("merge-base-sha");

      const mockRevList = inspectors.git.revList as ReturnType<typeof vi.fn>;
      mockRevList.mockResolvedValueOnce(["build-sha", "test-sha", "spec-sha"]);
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
      mockDiffTree.mockResolvedValue(["docs/tasks/task-MAG-30/task-MAG-30-04-spec.md"]);

      const mockAdded = inspectors.git.added as ReturnType<typeof vi.fn>;
      mockAdded.mockResolvedValue([]);

      const mockModified = inspectors.git.modified as ReturnType<typeof vi.fn>;
      mockModified.mockResolvedValue([]);

      const result = await fn(inspectors, { "destination-branch": "main" });

      expect(result.passed).toBe(false);
      expect(result.check).toBe("main-gate");
    });
  });

  describe("Re-verification after origin/build/{ref} already matches HEAD", () => {
    it("still passes when local build/{ref} has already been pushed (origin === HEAD)", async () => {
      // Regression test: previously this check computed
      // mergeBase(origin/build/{ref}, HEAD) and required it to equal the
      // test commit (commits[1]) — a comparison that only ever holds
      // *before* the build commit reaches origin. Once build/{ref} is
      // pushed (the normal state by the time anyone re-verifies an
      // already-raised build->main PR), origin/build/{ref} === HEAD, so
      // that merge-base trivially becomes HEAD itself (the build commit,
      // commits[0]) — failing a structurally-sound history for a reason
      // unrelated to its actual correctness. The check no longer performs
      // this comparison at all; spec/test/build commits are identified
      // purely by position in the already-ordered `commits` list.
      setupBuildSuccess(inspectors);
      setupCoverageMocks(inspectors);

      // mergeBase is never called with "origin/build/{ref}" post-fix —
      // assert the mock only ever saw the two calls the check still makes
      // (HEAD vs destination, per line 42).
      const mockMergeBase = inspectors.git.mergeBase as ReturnType<typeof vi.fn>;

      const result = await fn(inspectors, { "destination-branch": "main" });

      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
      expect(mockMergeBase).not.toHaveBeenCalledWith(
        expect.stringContaining("origin/build"),
        expect.anything(),
      );
    });
  });

  describe("Task commit validation fails", () => {
    it("returns passed=false when task commit validation fails", async () => {
      (inspectors.git.currentBranch as ReturnType<typeof vi.fn>).mockResolvedValue("task/MAG-30");

      const mockMergeBase = inspectors.git.mergeBase as ReturnType<typeof vi.fn>;
      mockMergeBase.mockResolvedValue("merge-base-sha");

      const mockRevList = inspectors.git.revList as ReturnType<typeof vi.fn>;
      mockRevList.mockResolvedValueOnce(["task-commit-sha"]);
      mockRevList.mockResolvedValueOnce([]);

      const mockCommitMessages = inspectors.git.commitMessages as ReturnType<typeof vi.fn>;
      mockCommitMessages.mockResolvedValue(["Bad title\n\nBody"]);

      const result = await fn(inspectors, { "destination-branch": "main" });

      expect(result.passed).toBe(false);
      expect(result.check).toBe("main-gate");
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
