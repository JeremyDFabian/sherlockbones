import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // The fixture project under fixtures/ is exercised by the runner; it is not
    // part of our own unit suite.
    exclude: ["node_modules", "dist", "fixtures"],
    passWithNoTests: true,
  },
});
