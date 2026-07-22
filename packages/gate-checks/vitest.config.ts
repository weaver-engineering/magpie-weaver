import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["../../test/packages/gate-checks/**/*.test.ts"],
  },
});
