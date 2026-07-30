import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["../../test/packages/task-phases/**/*.test.ts"],
  },
});
