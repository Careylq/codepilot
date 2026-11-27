import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["repos/**", "node_modules/**", ".next/**"],
  },
});
