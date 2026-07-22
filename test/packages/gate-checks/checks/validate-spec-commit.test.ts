import { describe, it, expect, vi, beforeEach } from "vitest";
import { fn, requiredArgs } from "@magpieweaver/gate-checks/src/checks/validate-spec-commit.js";
import type { GitInspector } from "@magpieweaver/gate-checks/dist/git-interface";
import type { CoverageInspector, Inspectors } from "@magpieweaver/gate-checks/dist/types";

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
    coverage: {} as unknown as CoverageInspector,
  };
}

describe("validate-spec-commit", () => {
  let inspectors: Inspectors;

  beforeEach(() => {
    inspectors = createMockInspectors();
    (inspectors.git.commitMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
      "MAG-30 Add spec\n\nSpec body description",
    ]);
    (inspectors.git.lsTree as ReturnType<typeof vi.fn>).mockResolvedValue([
      "docs/tasks/task-MAG-30/task-MAG-30.md",
      "docs/tasks/task-MAG-30/task-MAG-30-04-pnpm-gate-check-spec.md",
    ]);
    (inspectors.git.diffTree as ReturnType<typeof vi.fn>).mockResolvedValue([
      "docs/tasks/task-MAG-30/task-MAG-30-04-pnpm-gate-check-spec.md",
    ]);
  });

  describe("§3.4.1 Valid Spec Commit", () => {
    it("returns passed=true with task and specs values", async () => {
      const result = await fn(inspectors, { "spec-commit-sha": "abc123" });
      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
      expect(result.values.task).toBe("docs/tasks/task-MAG-30/task-MAG-30.md");
      expect(result.values.specs).toEqual([
        "docs/tasks/task-MAG-30/task-MAG-30-04-pnpm-gate-check-spec.md",
      ]);
    });
  });

  describe("§3.4.2 Invalid Commit Message Title", () => {
    it("returns passed=false when title does not start with ref", async () => {
      (inspectors.git.commitMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
        "Bad title\n\nBody",
      ]);
      const result = await fn(inspectors, { "spec-commit-sha": "abc123" });
      expect(result.passed).toBe(false);
      expect(result.violations[0]).toContain("must start with a valid ref");
    });

    it("returns passed=false when title is only the ref", async () => {
      (inspectors.git.commitMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
        "MAG-30\n\nBody",
      ]);
      const result = await fn(inspectors, { "spec-commit-sha": "abc123" });
      expect(result.passed).toBe(false);
      expect(result.violations[0]).toBe("Commit message title must continue beyond the ref");
    });

    it("returns passed=false when body is empty", async () => {
      (inspectors.git.commitMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
        "MAG-30 Title",
      ]);
      const result = await fn(inspectors, { "spec-commit-sha": "abc123" });
      expect(result.passed).toBe(false);
      expect(result.violations[0]).toBe("Commit message body must not be empty");
    });
  });

  describe("§3.4.3 Task Directory Missing", () => {
    it("returns passed=false when lsTree returns empty for task dir", async () => {
      (inspectors.git.lsTree as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      const result = await fn(inspectors, { "spec-commit-sha": "abc123" });
      expect(result.passed).toBe(false);
      expect(result.violations[0]).toBe("Task directory \"docs/tasks/task-MAG-30\" does not exist");
    });
  });

  describe("§3.4.4 Changes Outside Task Directory", () => {
    it("returns passed=false when files changed outside task dir", async () => {
      (inspectors.git.diffTree as ReturnType<typeof vi.fn>).mockResolvedValue([
        "docs/tasks/task-MAG-30/spec.md",
        "src/other-file.ts",
      ]);
      const result = await fn(inspectors, { "spec-commit-sha": "abc123" });
      expect(result.passed).toBe(false);
      expect(result.violations[0]).toContain("Changes outside task directory");
      expect(result.violations[0]).toContain("src/other-file.ts");
    });
  });

  describe("§3.4.5 Task File Missing", () => {
    it("returns passed=false when task file not in lsTree result", async () => {
      (inspectors.git.lsTree as ReturnType<typeof vi.fn>).mockResolvedValue([
        "docs/tasks/task-MAG-30/some-other-file.md",
        "docs/tasks/task-MAG-30/task-MAG-30-04-spec.md",
      ]);
      const result = await fn(inspectors, { "spec-commit-sha": "abc123" });
      expect(result.passed).toBe(false);
      expect(result.violations[0]).toBe("Task file \"docs/tasks/task-MAG-30/task-MAG-30.md\" does not exist");
    });
  });

  describe("§3.4.6 No Specification Files", () => {
    it("returns passed=false when no spec files match pattern", async () => {
      (inspectors.git.lsTree as ReturnType<typeof vi.fn>).mockResolvedValue([
        "docs/tasks/task-MAG-30/task-MAG-30.md",
        "docs/tasks/task-MAG-30/readme.md",
      ]);
      const result = await fn(inspectors, { "spec-commit-sha": "abc123" });
      expect(result.passed).toBe(false);
      expect(result.violations).toContain("No specification files found");
    });
  });

  describe("throws on invalid sha", () => {
    it("throws when commitMessages rejects", async () => {
      (inspectors.git.commitMessages as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("fatal"),
      );
      await expect(
        fn(inspectors, { "spec-commit-sha": "bad-sha" }),
      ).rejects.toThrow("Invalid argument");
    });
  });

  describe("requiredArgs", () => {
    it("exports the correct required argument names", () => {
      expect(requiredArgs).toEqual(["spec-commit-sha"]);
    });
  });
});
