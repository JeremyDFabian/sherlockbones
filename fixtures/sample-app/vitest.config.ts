import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const fixtureDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(fixtureDir, "../..");

// A self-contained sample project used to prove the coverage capture end to end.
// The sherlockbones setup file lives in the repo's src/, so allow Vite to read it.
export default defineConfig({
  test: {
    root: fixtureDir,
    include: ["test/**/*.test.ts"],
    setupFiles: [path.join(repoRoot, "src/coverage/setup.ts")],
    coverage: {
      provider: "istanbul",
      enabled: true,
      include: ["src/**"],
      reporter: [],
    },
  },
  server: {
    fs: { allow: [repoRoot] },
  },
});
