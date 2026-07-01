#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { pingDaemon, stopDaemon } from "../daemon/client.js";
import { runDaemon } from "../daemon/server.js";
import { calibrate, formatCalibrate } from "../commands/calibrate.js";
import { handleHook } from "../commands/hook.js";
import { init } from "../commands/init.js";
import { rebuildIndex } from "../commands/rebuild.js";
import { runChanged } from "../commands/run.js";
import { computeStats, formatStats } from "../commands/stats.js";
import { openStore, resolveContext } from "./context.js";

const pkg = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { version: string };

const program = new Command();

program
  .name("bones")
  .description("Run only the tests that cover the code you just changed.")
  .version(pkg.version);

const toInt = (v: string): number => parseInt(v, 10);

program
  .command("run")
  .description("Run the tests covering the changed files")
  .requiredOption("--changed <files...>", "changed files (project-relative)")
  .option("--format <mode>", "output format: agent | human", "human")
  .option("--budget-tests <n>", "maximum tests to run", toInt)
  .option("--no-daemon", "bypass the warm daemon and run cold")
  .action(async (opts: {
    changed: string[];
    format: string;
    budgetTests?: number;
    daemon?: boolean;
  }) => {
    const mode = opts.format === "agent" ? "agent" : "human";
    const result = await runChanged(resolveContext(), {
      changed: opts.changed,
      format: mode,
      budget: { maxTests: opts.budgetTests },
      daemon: opts.daemon !== false,
    });
    if (result.output) {
      const stream = mode === "agent" ? process.stderr : process.stdout;
      stream.write(`${result.output}\n`);
    }
    process.exit(result.exitCode);
  });

program
  .command("map")
  .description("Manage the impact index")
  .option("--rebuild", "rebuild the index from a full coverage run")
  .option("--explain <file>", "show which tests cover a file")
  .action((opts: { rebuild?: boolean; explain?: string }) => {
    const ctx = resolveContext();
    if (opts.rebuild) {
      const result = rebuildIndex(ctx);
      process.stdout.write(`bones: indexed ${result.tests} tests\n`);
      return;
    }
    if (opts.explain) {
      const store = openStore(ctx);
      try {
        const tests = store.getTestsForLines(opts.explain, []);
        process.stdout.write(
          tests.length === 0
            ? `bones: no coverage recorded for ${opts.explain}\n`
            : `Tests covering ${opts.explain}:\n${tests.map((t) => `  ${t}`).join("\n")}\n`,
        );
      } finally {
        store.close();
      }
      return;
    }
    process.stdout.write("bones: specify --rebuild or --explain <file>\n");
  });

program
  .command("calibrate")
  .description("Measure failure recall: run the full suite and compare against selection")
  .option("--changed <files...>", "files to calibrate (default: git diff vs HEAD)")
  .action(async (opts: { changed?: string[] }) => {
    const result = await calibrate(resolveContext(), { changed: opts.changed });
    process.stdout.write(`${formatCalibrate(result)}\n`);
  });

program
  .command("stats")
  .description("Show recall / reduction / speed over recent runs")
  .action(() => {
    const store = openStore(resolveContext());
    try {
      process.stdout.write(`${formatStats(computeStats(store))}\n`);
    } finally {
      store.close();
    }
  });

program
  .command("init")
  .description("Detect agents, install hooks, and build the initial index")
  .option("--no-rebuild", "skip building the initial index")
  .action((opts: { rebuild?: boolean }) => {
    const ctx = resolveContext();
    const result = init(ctx, { rebuild: opts.rebuild !== false });
    const agents = result.agents.length > 0 ? result.agents.join(", ") : "none detected";
    process.stdout.write(`bones: installed hooks for ${agents}\n`);
    process.stdout.write(`bones: wrote ${path.relative(ctx.root, result.captureConfig)}\n`);
    if (result.indexedTests !== undefined) {
      process.stdout.write(`bones: indexed ${result.indexedTests} tests\n`);
    }
    if (result.indexError !== undefined) {
      process.stderr.write(
        `bones: initial index build failed (${result.indexError})\n` +
          `bones: hooks are installed — run \`bones map --rebuild\` once it's fixed.\n`,
      );
    }
  });

program
  .command("daemon")
  .description("Run the warm-Vitest daemon (started automatically by run/hook)")
  .option("--status", "report whether a daemon is running")
  .option("--stop", "stop a running daemon")
  .action(async (opts: { status?: boolean; stop?: boolean }) => {
    const ctx = resolveContext();
    if (opts.status) {
      const up = await pingDaemon(ctx.root);
      process.stdout.write(`bones: daemon ${up ? "running" : "not running"}\n`);
      return;
    }
    if (opts.stop) {
      const stopped = await stopDaemon(ctx.root);
      process.stdout.write(`bones: ${stopped ? "daemon stopped" : "no daemon running"}\n`);
      return;
    }
    await runDaemon({ root: ctx.root });
  });

program
  .command("hook")
  .description("Run as an agent PostToolUse hook (reads the payload on stdin)")
  .argument("[agent]", "agent id (informational)")
  .action(async () => {
    let stdin = "";
    try {
      stdin = readFileSync(0, "utf8");
    } catch {
      stdin = "";
    }
    const result = await handleHook(stdin, resolveContext(), { run: runChanged });
    if (result?.output) process.stderr.write(`${result.output}\n`);
    // Claude Code only feeds a PostToolUse hook's stderr back to the model when the
    // hook exits 2 (a "blocking" error); exit 1 is treated as non-blocking and the
    // agent never sees it. So a failing covering test must exit 2 to reach the agent
    // for same-turn self-correction — the whole point of the loop. Passing runs and
    // no-ops exit 0 (silent). Infra errors are thrown and exit 1 via the boundary
    // below, deliberately non-blocking so a misconfig doesn't nag on every edit.
    process.exit(result && !result.summary.passed ? 2 : 0);
  });

try {
  await program.parseAsync();
} catch (err) {
  // Turn engine failures (Vitest can't start, timeout, bad config) into a concise
  // one-line diagnostic instead of a raw Node stack trace — for humans and for the
  // agent hook, whose stderr this becomes.
  process.stderr.write(`bones: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
