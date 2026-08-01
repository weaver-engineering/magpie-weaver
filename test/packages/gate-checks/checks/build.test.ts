import { describe, it, expect, vi } from "vitest";
import { fn, requiredArgs } from "@magpieweaver/gate-checks/src/checks/build.js";
import type { CoverageInspector, GitInspector, Inspectors } from "@magpieweaver/gate-checks/dist/types.js";

function createMockInspectors(success: boolean, output: string): Inspectors {
  return {
    git: {} as GitInspector,
    coverage: {
      runBuild: vi.fn().mockReturnValue({ success, output }),
    } as CoverageInspector,
  };
}

describe("build", () => {
  it("returns passed=true when the build succeeds", async () => {
    const inspectors = createMockInspectors(true, "");
    const result = await fn(inspectors, {});
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.check).toBe("build");
  });

  it("returns passed=false with the compiler output when the build fails", async () => {
    const inspectors = createMockInspectors(false, "src/foo.ts(3,5): error TS2322");
    const result = await fn(inspectors, {});
    expect(result.passed).toBe(false);
    expect(result.violations).toContain("Build failed");
    expect(result.values.output).toBe("src/foo.ts(3,5): error TS2322");
  });

  describe("requiredArgs", () => {
    it("exports no required arguments", () => {
      expect(requiredArgs).toEqual([]);
    });
  });
});
