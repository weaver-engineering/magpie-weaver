import { describe, it, expect } from "vitest";
import { catalog } from "@magpieweaver/gate-checks/src/checks/index.js";

describe("checks/index catalog", () => {
  it("exports catalog as an object", () => {
    expect(catalog).toBeDefined();
    expect(typeof catalog).toBe("object");
  });

  const expectedChecks: Record<string, string[]> = {
    "branch-ref": [],
    "pr-title": ["ref", "pr-title"],
    "get-inbound-commits": ["base-ref", "head-ref"],
    "validate-spec-commit": [],
    "validate-test-commit": [],
    "validate-build-commit": [],
    "validate-task-commit": [],
    "existing-tests-pass": [],
    "new-tests-fail": [],
    "coverage": ["expect-failure"],
    "test-gate": [],
    "build-gate": [],
    "main-gate": [],
  };

  describe("all 13 checks are registered", () => {
    for (const [name, args] of Object.entries(expectedChecks)) {
      it(`has "${name}" with fn and requiredArgs ${JSON.stringify(args)}`, () => {
        const entry = catalog[name];
        expect(entry).toBeDefined();
        expect(typeof entry.fn).toBe("function");
        expect(Array.isArray(entry.requiredArgs)).toBe(true);
        expect(entry.requiredArgs).toEqual(args);
      });
    }
  });
});
