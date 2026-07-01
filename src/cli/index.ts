#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
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
  .action((opts: {
    changed: string[];
    format: string;
    budgetTests?: number;
  }) => {
    const mode = opts.format === "agent" ? "agent" : "human";
    const result = runChanged(resolveContext(), {
      changed: opts.changed,
      format: mode,
      budget: { maxTests: opts.budgetTests },
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
  .command("hook")
  .description("Run as an agent PostToolUse hook (reads the payload on stdin)")
  .argument("[agent]", "agent id (informational)")
  .action(() => {
    let stdin = "";
    try {
      stdin = readFileSync(0, "utf8");
    } catch {
      stdin = "";
    }
    const result = handleHook(stdin, resolveContext(), { run: runChanged });
    if (result?.output) process.stderr.write(`${result.output}\n`);
    process.exit(result?.exitCode ?? 0);
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
