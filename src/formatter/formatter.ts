import pc from "picocolors";
import type { ImpactTier } from "../impact/impact-map.js";
import type { TestResult } from "../runner/runner.js";

export type FormatMode = "agent" | "human";

export interface RunSummary {
  results: TestResult[];
  passed: boolean;
  durationMs: number;
  tier: ImpactTier;
  lowConfidence: boolean;
  selectedCount: number;
  skippedCount: number;
  unmapped: string[];
}

function counts(results: TestResult[]): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  for (const r of results) {
    if (r.status === "passed") passed++;
    else if (r.status === "failed") failed++;
  }
  return { passed, failed };
}

function firstLine(message: string | undefined): string {
  return (message ?? "").split("\n")[0]?.trim() ?? "";
}

function locate(result: TestResult): string {
  return result.line !== undefined ? `${result.file}:${result.line}` : result.file;
}

function tierNote(summary: RunSummary): string {
  return summary.lowConfidence ? `${summary.tier}, low confidence` : summary.tier;
}

/**
 * Compact, machine-friendly output for an agent. Silent on success (no noise in the
 * loop); on failure, one header line plus a terse FAIL line per failed test.
 */
export function formatAgent(summary: RunSummary): string {
  if (summary.passed) return "";

  const { passed, failed } = counts(summary.results);
  const lines: string[] = [
    `bones: ${failed} failed, ${passed} passed / ${summary.selectedCount} selected via ${tierNote(summary)}`,
  ];

  for (const result of summary.results) {
    if (result.status !== "failed") continue;
    lines.push(`FAIL ${locate(result)} ${result.name}`);
    const message = firstLine(result.message);
    if (message) lines.push(`  ${message}`);
  }

  if (summary.skippedCount > 0) lines.push(`skipped ${summary.skippedCount} tests (budget)`);
  if (summary.unmapped.length > 0) {
    lines.push(`unmapped: ${summary.unmapped.join(", ")}`);
  }

  return lines.join("\n");
}

/** Pretty, colored output for a human at a terminal. */
export function formatHuman(summary: RunSummary): string {
  const { passed, failed } = counts(summary.results);
  const seconds = (summary.durationMs / 1000).toFixed(2);
  const lines: string[] = [];

  if (summary.passed) {
    lines.push(
      pc.green(`✓ ${passed} passed`) +
        pc.dim(` in ${seconds}s · ${tierNote(summary)}`),
    );
  } else {
    lines.push(
      pc.red(`✗ ${failed} failed`) +
        pc.dim(`, ${passed} passed in ${seconds}s · ${tierNote(summary)}`),
    );
    for (const result of summary.results) {
      if (result.status !== "failed") continue;
      lines.push(`  ${pc.red("FAIL")} ${pc.bold(result.name)} ${pc.dim(locate(result))}`);
      const message = firstLine(result.message);
      if (message) lines.push(`    ${message}`);
    }
  }

  if (summary.skippedCount > 0) {
    lines.push(pc.yellow(`  skipped ${summary.skippedCount} tests (budget)`));
  }
  if (summary.unmapped.length > 0) {
    lines.push(pc.yellow(`  unmapped: ${summary.unmapped.join(", ")}`));
  }

  return lines.join("\n");
}

export function format(summary: RunSummary, mode: FormatMode): string {
  return mode === "agent" ? formatAgent(summary) : formatHuman(summary);
}
