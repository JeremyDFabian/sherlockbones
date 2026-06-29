import path from "node:path";

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/;
const TEST_EXT = /\.(test|spec)\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/;

/** Filename stem with test/spec markers and the extension stripped. */
function stem(file: string): string {
  const base = path.basename(file);
  if (TEST_EXT.test(base)) return base.replace(TEST_EXT, "");
  return base.replace(SOURCE_EXT, "");
}

/**
 * Last-resort impact tier: with no coverage and no import graph, guess the tests
 * for a changed file by filename convention — `cart.ts` → `cart.test.ts`,
 * `cart.spec.ts`, etc. Matches any known test file sharing the source file's stem.
 */
export function guessTests(changedFile: string, testFiles: string[]): string[] {
  // A changed test file is its own impact — run it directly, not its stem-siblings.
  if (TEST_EXT.test(path.basename(changedFile))) return [changedFile];

  const target = stem(changedFile);
  return testFiles.filter((f) => stem(f) === target).sort();
}
