import { describe, it, expect } from "vitest";
import * as helpers from "../packages/gate-checks/src/checks/helpers.js";

describe("MAG-30", () => {
  it("deleteMe function throws", () => {
    if (typeof helpers.deleteMe !== "function") {
      expect(true).toBe(false);
    } else {
      expect(() => helpers.deleteMe()).toThrow();
    }
  });
});
