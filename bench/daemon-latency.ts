import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pingDaemon, runViaDaemon, stopDaemon } from "../src/daemon/client.js";
import { rebuildIndex } from "../src/commands/rebuild.js";
import type { ProjectContext } from "../src/cli/context.js";
import { VitestRunner } from "../src/runner/runner.js";

// Measures cold (fresh `vitest run` subprocess each edit) vs. warm (resident daemon)
// per-edit latency on the sample fixture. Run with: npm run bench:daemon
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = path.join(repoRoot, "fixtures/sample-app");
const ctx: ProjectContext = {
  root: fixtureDir,
  dbPath: path.join(fixtureDir, ".sherlockbones", "index.db"),
  vitestBin: path.join(repoRoot, "node_modules", ".bin", "vitest"),
  configPath: path.join(fixtureDir, "vitest.config.ts"),
};

const testFile = path.join(fixtureDir, "test", "pricing.test.ts");
const ITERATIONS = 5;

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const time = async (fn: () => Promise<unknown>): Promise<number> => {
  const s = Date.now();
  await fn();
  return Date.now() - s;
};

async function waitForDaemon(): Promise<void> {
  for (let i = 0; i < 40; i++) {
    if (await pingDaemon(fixtureDir)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("daemon did not come up");
}

rebuildIndex(ctx);

// Cold: a fresh Vitest subprocess per edit (today's per-edit cost).
const cold: number[] = [];
for (let i = 0; i < ITERATIONS; i++) {
  cold.push(
    await time(async () =>
      new VitestRunner({
        projectRoot: ctx.root,
        vitestBin: ctx.vitestBin,
        configPath: ctx.configPath,
      }).run([testFile]),
    ),
  );
}

// Warm: start the built daemon explicitly (auto-spawn resolves dist paths, which
// this from-source bench doesn't have), wait for it, warm once, then measure.
const distCli = path.join(repoRoot, "dist", "cli", "index.js");
spawn(process.execPath, [distCli, "daemon"], {
  cwd: fixtureDir,
  detached: true,
  stdio: "ignore",
}).unref();
await waitForDaemon();
await runViaDaemon(fixtureDir, [testFile]); // warm-up
const warm: number[] = [];
for (let i = 0; i < ITERATIONS; i++) {
  warm.push(await time(() => runViaDaemon(fixtureDir, [testFile])));
}
await stopDaemon(fixtureDir);

const coldAvg = mean(cold);
const warmAvg = mean(warm);
process.stdout.write(
  [
    "sherlockbones daemon latency",
    "─".repeat(48),
    `  cold (fresh subprocess): ${coldAvg.toFixed(0)}ms avg  [${cold.map((n) => n.toFixed(0)).join(", ")}]`,
    `  warm (resident daemon):  ${warmAvg.toFixed(0)}ms avg  [${warm.map((n) => n.toFixed(0)).join(", ")}]`,
    "─".repeat(48),
    `  speedup: ${(coldAvg / warmAvg).toFixed(1)}x   saved ~${(coldAvg - warmAvg).toFixed(0)}ms/edit`,
    "",
  ].join("\n"),
);
