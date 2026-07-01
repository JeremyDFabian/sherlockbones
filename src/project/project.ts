import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"]);
const IGNORED_DIRS = new Set([
  "node_modules",
  "dist",
  "coverage",
  ".sherlockbones",
  ".git",
]);
const TEST_RE = /\.(test|spec)\.[cm]?[jt]sx?$/;

export function isTestFile(file: string): boolean {
  return TEST_RE.test(path.basename(file));
}

export function isSourceFile(file: string): boolean {
  return SOURCE_EXT.has(path.extname(file));
}

export function hashContent(content: string): string {
  return createHash("sha1").update(content).digest("hex");
}

/** Recursively collect source/test files under `root`, skipping ignored dirs. */
export function findSourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
      } else if (SOURCE_EXT.has(path.extname(entry.name))) {
        out.push(path.join(dir, entry.name));
      }
    }
  };
  walk(root);
  return out;
}

export interface LoadedProject {
  files: Record<string, string>;
  testFiles: string[];
}

/** Read every source file under `root` into memory for graph/heuristic tiers. */
export function loadProject(root: string): LoadedProject {
  const files: Record<string, string> = {};
  const testFiles: string[] = [];
  for (const file of findSourceFiles(root)) {
    files[file] = readFileSync(file, "utf8");
    if (isTestFile(file)) testFiles.push(file);
  }
  return { files, testFiles };
}

const HUNK_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm;

/** New-file line numbers touched by a unified diff (added or, for deletions, the anchor). */
export function parseDiffHunks(diff: string): number[] {
  const lines = new Set<number>();
  for (const match of diff.matchAll(HUNK_RE)) {
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    if (count === 0) {
      lines.add(start);
    } else {
      for (let line = start; line < start + count; line++) lines.add(line);
    }
  }
  return [...lines].sort((a, b) => a - b);
}

/** Source files changed versus HEAD (uncommitted edits). Empty if git is unavailable. */
export function changedSourceFiles(root: string): string[] {
  try {
    const out = execFileSync("git", ["diff", "--name-only", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    });
    return out
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && isSourceFile(line));
  } catch {
    return [];
  }
}

/**
 * Lines changed in `file` versus HEAD (uncommitted edits the agent just made).
 * Returns an empty array when git is unavailable or the file is untracked/new — the
 * caller treats empty as a whole-file lookup, which is recall-safe.
 */
export function changedLines(root: string, file: string): number[] {
  try {
    const diff = execFileSync("git", ["diff", "-U0", "HEAD", "--", file], {
      cwd: root,
      encoding: "utf8",
    });
    return parseDiffHunks(diff);
  } catch {
    return [];
  }
}
