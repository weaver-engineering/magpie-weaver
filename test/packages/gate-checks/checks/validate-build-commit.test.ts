import { describe, it, expect, vi, beforeEach } from "vitest";
import { fn, requiredArgs } from "@magpieweaver/gate-checks/src/checks/validate-build-commit.js";
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

describe("validate-build-commit", () => {
  let inspectors: Inspectors;

  beforeEach(() => {
    inspectors = createMockInspectors();
    (inspectors.git.commitMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
      "MAG-30 Build implementation\n\nBuild body description",
    ]);
    (inspectors.git.diffTree as ReturnType<typeof vi.fn>).mockResolvedValue([
      "packages/gate-checks/src/index.ts",
    ]);
    (inspectors.git.added as ReturnType<typeof vi.fn>).mockResolvedValue([
      "packages/gate-checks/src/new-file.ts",
    ]);
    (inspectors.git.modified as ReturnType<typeof vi.fn>).mockResolvedValue([
      "packages/gate-checks/src/index.ts",
    ]);
    (inspectors.git.deleted as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  describe("§3.6.1 Valid Build Commit", () => {
    it("returns passed=true with newFiles, modifiedFiles, deletedFiles values", async () => {
      const result = await fn(inspectors, { "build-commit-sha": "abc123" });
      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
      expect(result.values.newFiles).toEqual(["packages/gate-checks/src/new-file.ts"]);
      expect(result.values.modifiedFiles).toEqual(["packages/gate-checks/src/index.ts"]);
      expect(result.values.deletedFiles).toEqual([]);
    });

    it("allows changes in apps/ directory", async () => {
      (inspectors.git.diffTree as ReturnType<typeof vi.fn>).mockResolvedValue([
        "apps/web/src/app.ts",
      ]);
      (inspectors.git.added as ReturnType<typeof vi.fn>).mockResolvedValue([
        "apps/web/src/app.ts",
      ]);
      const result = await fn(inspectors, { "build-commit-sha": "abc123" });
      expect(result.passed).toBe(true);
    });

    it("allows changes to package.json and pnpm-lock.yaml", async () => {
      (inspectors.git.diffTree as ReturnType<typeof vi.fn>).mockResolvedValue([
        "package.json",
        "pnpm-lock.yaml",
      ]);
      (inspectors.git.modified as ReturnType<typeof vi.fn>).mockResolvedValue([
        "package.json",
        "pnpm-lock.yaml",
      ]);
      const result = await fn(inspectors, { "build-commit-sha": "abc123" });
      expect(result.passed).toBe(true);
    });
  });

  describe("§3.6.2 Invalid Commit Message", () => {
    it("returns passed=false when title does not start with ref", async () => {
      (inspectors.git.commitMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
        "Bad title\n\nBody",
      ]);
      const result = await fn(inspectors, { "build-commit-sha": "abc123" });
      expect(result.passed).toBe(false);
      expect(result.violations[0]).toContain("must start with a valid ref");
    });

    it("returns passed=false when title is only the ref", async () => {
      (inspectors.git.commitMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
        "MAG-30\n\nBody",
      ]);
      const result = await fn(inspectors, { "build-commit-sha": "abc123" });
      expect(result.passed).toBe(false);
      expect(result.violations[0]).toBe("Commit message title must continue beyond the ref");
    });

    it("returns passed=false when body is empty", async () => {
      (inspectors.git.commitMessages as ReturnType<typeof vi.fn>).mockResolvedValue([
        "MAG-30 Title",
      ]);
      const result = await fn(inspectors, { "build-commit-sha": "abc123" });
      expect(result.passed).toBe(false);
      expect(result.violations[0]).toBe("Commit message body must not be empty");
    });
  });

  describe("§3.6.3 Changes Outside Allowed Paths", () => {
    it("returns passed=false when changes outside apps/, packages/, or config", async () => {
      (inspectors.git.diffTree as ReturnType<typeof vi.fn>).mockResolvedValue([
        "docs/readme.md",
      ]);
      const result = await fn(inspectors, { "build-commit-sha": "abc123" });
      expect(result.passed).toBe(false);
      expect(result.violations[0]).toContain("Changes outside allowed paths");
      expect(result.violations[0]).toContain("docs/readme.md");
    });

    it("returns passed=false when changes outside allowed paths plus allowed", async () => {
      (inspectors.git.diffTree as ReturnType<typeof vi.fn>).mockResolvedValue([
        "packages/core/src/index.ts",
        "docs/readme.md",
      ]);
      const result = await fn(inspectors, { "build-commit-sha": "abc123" });
      expect(result.passed).toBe(false);
      expect(result.violations[0]).toContain("docs/readme.md");
    });
  });

  describe("throws on invalid sha", () => {
    it("throws when commitMessages rejects", async () => {
      (inspectors.git.commitMessages as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("fatal"),
      );
      await expect(
        fn(inspectors, { "build-commit-sha": "bad-sha" }),
      ).rejects.toThrow("Invalid argument");
    });
  });

  describe("requiredArgs", () => {
    it("exports the correct required argument names", () => {
      expect(requiredArgs).toEqual(["build-commit-sha"]);
    });
  });
});
