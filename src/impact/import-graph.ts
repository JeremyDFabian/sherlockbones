import path from "node:path";

const FROM_RE = /\b(?:import|export)\b[^;'"]*?\bfrom\s*["']([^"']+)["']/g;
const SIDE_EFFECT_RE = /\bimport\s+["']([^"']+)["']/g;
const CALL_RE = /\b(?:require|import)\s*\(\s*["']([^"']+)["']\s*\)/g;

/**
 * Extract every module specifier a source file references: static imports,
 * `export ... from`, side-effect imports, dynamic `import()`, and `require()`.
 * Bare specifiers (e.g. "react") are returned too; resolution decides what to keep.
 */
export function parseImportSpecifiers(source: string): string[] {
  const found = new Set<string>();
  for (const re of [FROM_RE, SIDE_EFFECT_RE, CALL_RE]) {
    for (const match of source.matchAll(re)) {
      if (match[1]) found.add(match[1]);
    }
  }
  return [...found];
}

/** Candidate on-disk paths a relative specifier could resolve to, in priority order. */
function resolutionCandidates(base: string): string[] {
  if (/\.(ts|tsx)$/.test(base)) return [base];
  if (base.endsWith(".js")) {
    return [base.replace(/\.js$/, ".ts"), base.replace(/\.js$/, ".tsx"), base];
  }
  return [
    `${base}.ts`,
    `${base}.tsx`,
    base,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ];
}

function resolveImport(
  importer: string,
  specifier: string,
  known: Set<string>,
): string | null {
  if (!specifier.startsWith(".")) return null; // bare specifier (node_modules)
  const base = path.resolve(path.dirname(importer), specifier);
  for (const candidate of resolutionCandidates(base)) {
    if (known.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Static import dependency graph over a project's source files. Used as the
 * cold-start impact tier: with no coverage yet, the tests that (transitively)
 * import a changed module are the best available estimate of what it affects.
 */
export class ImportGraph {
  private constructor(
    private readonly importedBy: Map<string, Set<string>>,
    private readonly testFiles: Set<string>,
  ) {}

  /** Build the graph from a map of absolute file path → file contents. */
  static build(
    files: Record<string, string>,
    isTestFile: (file: string) => boolean,
  ): ImportGraph {
    const known = new Set(Object.keys(files));
    const importedBy = new Map<string, Set<string>>();
    const testFiles = new Set<string>();

    for (const [file, source] of Object.entries(files)) {
      if (isTestFile(file)) testFiles.add(file);
      for (const specifier of parseImportSpecifiers(source)) {
        const target = resolveImport(file, specifier, known);
        if (!target) continue;
        let importers = importedBy.get(target);
        if (!importers) {
          importers = new Set<string>();
          importedBy.set(target, importers);
        }
        importers.add(file);
      }
    }

    return new ImportGraph(importedBy, testFiles);
  }

  /** Test files that transitively import `changedFile` (including it, if a test). */
  testsImporting(changedFile: string): string[] {
    const visited = new Set<string>([changedFile]);
    const queue = [changedFile];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const importer of this.importedBy.get(current) ?? []) {
        if (!visited.has(importer)) {
          visited.add(importer);
          queue.push(importer);
        }
      }
    }

    return [...visited].filter((f) => this.testFiles.has(f)).sort();
  }
}
