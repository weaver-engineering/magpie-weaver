import { describe, it, expect, vi, beforeEach } from "vitest";
import { fn, requiredArgs } from "@magpieweaver/gate-checks/src/checks/validate-task-commit.js";
import type { GitInspector } from "@magpieweaver/gate-checks/dist/git-interface.js";

import type { CoverageInspector, Inspectors } from "@magpieweaver/gate-checks/dist/types.js";
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

describe("validate-task-commit", () => {
  let inspectors: Inspectors;

  beforeEach(() => {
    inspectors = createMockInspectors();
    (inspectors.git.commitMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
      "MAG-30 Implement task\n\nTask body description",
    ]);
    (inspectors.git.added as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (inspectors.git.modified as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (inspectors.git.deleted as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  describe("§3.7.1 Valid Task Commit", () => {
    it("returns passed=true for a valid commit message", async () => {
      const result = await fn(inspectors, { "task-commit-ref": "abc123" });
      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
      expect(result.values.ref).toBe("MAG-30");
    });

    it("includes file change values in result", async () => {
      (inspectors.git.modified as ReturnType<typeof vi.fn>).mockResolvedValue(["src/file.ts"]);
      (inspectors.git.added as ReturnType<typeof vi.fn>).mockResolvedValue(["test/new.test.ts"]);
      (inspectors.git.deleted as ReturnType<typeof vi.fn>).mockResolvedValue(["src/old.ts"]);
      const result = await fn(inspectors, { "task-commit-ref": "abc123" });
      expect(result.values.newFiles).toEqual(["test/new.test.ts"]);
      expect(result.values.modifiedFiles).toEqual(["src/file.ts"]);
      expect(result.values.deletedFiles).toEqual(["src/old.ts"]);
      expect(result.values.newTests).toEqual(["test/new.test.ts"]);
    });

    it("accepts --ref matching the commit ref", async () => {
      const result = await fn(inspectors, { "task-commit-ref": "abc123", ref: "MAG-30" });
      expect(result.passed).toBe(true);
    });
  });

  describe("§3.7.2 Invalid Commit Message", () => {
    it("returns passed=false when title does not start with ref", async () => {
      (inspectors.git.commitMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
        "Bad title\n\nBody text",
      ]);
      const result = await fn(inspectors, { "task-commit-ref": "abc123" });
      expect(result.passed).toBe(false);
      expect(result.violations[0]).toContain("must start with a valid ref");
    });

    it("returns passed=false when title does not match --ref", async () => {
      (inspectors.git.commitMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
        "MAG-99 Implement\n\nBody text",
      ]);
      const result = await fn(inspectors, { "task-commit-ref": "abc123", ref: "MAG-30" });
      expect(result.passed).toBe(false);
      expect(result.violations[0]).toContain("must start with ref \"MAG-30\"");
    });

    it("returns passed=false when title is only the ref", async () => {
      (inspectors.git.commitMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
        "MAG-30\n\nBody text",
      ]);
      const result = await fn(inspectors, { "task-commit-ref": "abc123" });
      expect(result.passed).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations[0]).toBe("Commit message title must continue beyond the ref");
    });

    it("returns passed=false when body is empty", async () => {
      (inspectors.git.commitMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
        "MAG-30 Title",
      ]);
      const result = await fn(inspectors, { "task-commit-ref": "abc123" });
      expect(result.passed).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations[0]).toBe("Commit message body must not be empty");
    });
  });

  describe("throws on invalid ref", () => {
    it("throws when commitMessages rejects", async () => {
      (inspectors.git.commitMessages as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("fatal"),
      );
      await expect(
        fn(inspectors, { "task-commit-ref": "bad-ref" }),
      ).rejects.toThrow("Invalid argument");
    });
  });

  describe("requiredArgs", () => {
    it("exports an empty required args list", () => {
      expect(requiredArgs).toEqual([]);
    });
  });
});
