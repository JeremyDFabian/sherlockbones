#!/usr/bin/env node
import { Command } from "commander";
import { rebuildIndex } from "../commands/rebuild.js";
import { runChanged } from "../commands/run.js";
import { computeStats, formatStats } from "../commands/stats.js";
import { openStore, resolveContext } from "./context.js";

const program = new Command();

program
  .name("bones")
  .description("Run only the tests that cover the code you just changed.")
  .version("0.1.0");

const toInt = (v: string): number => parseInt(v, 10);
const toFloat = (v: string): number => parseFloat(v);

program
  .command("run")
  .description("Run the tests covering the changed files")
  .requiredOption("--changed <files...>", "changed files (project-relative)")
  .option("--format <mode>", "output format: agent | human", "human")
  .option("--budget-tests <n>", "maximum tests to run", toInt)
  .option("--budget-secs <t>", "maximum estimated seconds", toFloat)
  .action((opts: {
    changed: string[];
    format: string;
    budgetTests?: number;
    budgetSecs?: number;
  }) => {
    const mode = opts.format === "agent" ? "agent" : "human";
    const result = runChanged(resolveContext(), {
      changed: opts.changed,
      format: mode,
      budget: { maxTests: opts.budgetTests, maxSeconds: opts.budgetSecs },
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

await program.parseAsync();
