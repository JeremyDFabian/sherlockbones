import { createVitest } from "vitest/node";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Measures the per-warm-run cost of per-test coverage capture (the piece the daemon
// defers). The fixture's own config already enables istanbul + our setup, so that is
// the coverage-ON arm; we generate a stripped, coverage-OFF config for the baseline.
// Also reports whether capture actually wrote records in a resident instance — the
// real gating question for re-enabling self-heal in the daemon.
// Run with: npm run bench:coverage
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = path.join(repoRoot, "fixtures/sample-app");
const onConfig = path.join(fixtureDir, "vitest.config.ts"); // coverage + setup enabled
const testFile = path.join(fixtureDir, "test", "pricing.test.ts");
const ITER = 8;

interface WarmVitest {
  getRootProject(): { createSpecification(id: string): unknown };
  runTestSpecifications(specs: unknown[], all: boolean): Promise<unknown>;
  close(): Promise<void>;
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

async function makeVitest(configPath: string): Promise<WarmVitest> {
  return createVitest("test", {
    root: fixtureDir,
    watch: false,
    reporters: [{ onFinished: () => undefined }],
    config: configPath,
  }) as unknown as WarmVitest;
}

async function timeWarm(vitest: WarmVitest): Promise<number[]> {
  const spec = vitest.getRootProject().createSpecification(testFile);
  await vitest.runTestSpecifications([spec], false); // warm-up (not timed)
  const times: number[] = [];
  for (let i = 0; i < ITER; i++) {
    const s = Date.now();
    await vitest.runTestSpecifications([spec], false);
    times.push(Date.now() - s);
  }
  return times;
}

// A stripped, coverage-OFF config for the baseline (must live in-tree so
// `import "vitest/config"` resolves up to the repo's node_modules).
const genDir = path.join(fixtureDir, ".sherlockbones");
mkdirSync(genDir, { recursive: true });
const offConfig = path.join(genDir, "off.config.mjs");
writeFileSync(
  offConfig,
  `import { defineConfig } from "vitest/config";
export default defineConfig({ test: { root: ${JSON.stringify(fixtureDir)}, include: ["test/**/*.test.ts"] } });
`,
);

const off = await makeVitest(offConfig);
const offTimes = await timeWarm(off);
await off.close();
rmSync(offConfig, { force: true });

// Coverage-ON: the fixture config, with BONES_COVERAGE_OUT set so the setup writes.
const covOut = path.join(mkdtempSync(path.join(tmpdir(), "bones-covbench-")), "cov.jsonl");
process.env["BONES_COVERAGE_OUT"] = covOut;
const on = await makeVitest(onConfig);
const onTimes = await timeWarm(on);
await on.close();

let records = 0;
try {
  records = readFileSync(covOut, "utf8").trim().split("\n").filter(Boolean).length;
} catch {
  records = 0;
}

const offAvg = mean(offTimes);
const onAvg = mean(onTimes);
process.stdout.write(
  [
    "sherlockbones warm coverage-capture overhead",
    "─".repeat(52),
    `  warm, coverage OFF: ${offAvg.toFixed(0)}ms avg  [${offTimes.map((n) => n.toFixed(0)).join(", ")}]`,
    `  warm, coverage ON:  ${onAvg.toFixed(0)}ms avg  [${onTimes.map((n) => n.toFixed(0)).join(", ")}]`,
    "─".repeat(52),
    `  instrumentation overhead: +${(onAvg - offAvg).toFixed(0)}ms/run  (${((onAvg / offAvg - 1) * 100).toFixed(0)}%)`,
    `  per-test records written by the resident instance: ${records}`,
    records === 0
      ? "  ⚠ capture did NOT engage warm — the env/JSONL side-channel needs a\n    Node-API rewrite before self-heal can be re-enabled in the daemon."
      : "  ✓ capture engaged warm — fold is viable in the daemon.",
    "",
  ].join("\n"),
);
