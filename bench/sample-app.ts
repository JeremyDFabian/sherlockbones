import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatBench, runBenchmark, type EditSpec } from "../src/bench/harness.js";
import type { ProjectContext } from "../src/cli/context.js";

// Benchmarks sherlockbones against the bundled sample fixture. The fixture is tiny,
// so the reduction figure is modest; point `ctx` at a larger Vitest repo to produce
// the headline numbers. Run with: npm run bench
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = path.join(repoRoot, "fixtures/sample-app");

const ctx: ProjectContext = {
  root: fixtureDir,
  dbPath: path.join(fixtureDir, ".sherlockbones", "index.db"),
  vitestBin: path.join(repoRoot, "node_modules", ".bin", "vitest"),
  configPath: path.join(fixtureDir, "vitest.config.ts"),
};

const edits: EditSpec[] = [
  {
    label: "invert discount",
    file: "src/pricing.ts",
    find: "amount - (amount * pct)",
    replace: "amount + (amount * pct)",
  },
  {
    label: "break subtotal",
    file: "src/cart.ts",
    find: "sum += item.price * item.qty",
    replace: "sum -= item.price * item.qty",
  },
];

const results = await runBenchmark(ctx, edits);
process.stdout.write(`${formatBench(results)}\n`);
