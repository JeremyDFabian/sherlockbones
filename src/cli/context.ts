import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { Store } from "../store/store.js";

export interface ProjectContext {
  /** Project root, which is also the Vitest root. */
  root: string;
  dbPath: string;
  vitestBin: string;
  configPath?: string;
}

const CONFIG_CANDIDATES = [
  "vitest.config.ts",
  "vitest.config.mts",
  "vitest.config.js",
  "vitest.config.mjs",
  "vite.config.ts",
  "vite.config.js",
];

/** Resolve where the index lives and how to invoke Vitest for a project root. */
export function resolveContext(root: string = process.cwd()): ProjectContext {
  const localBin = path.join(root, "node_modules", ".bin", "vitest");
  const configPath = CONFIG_CANDIDATES.map((f) => path.join(root, f)).find(existsSync);
  return {
    root,
    dbPath: path.join(root, ".sherlockbones", "index.db"),
    vitestBin: existsSync(localBin) ? localBin : "vitest",
    configPath,
  };
}

/** Open the index store, creating the `.sherlockbones` directory if needed. */
export function openStore(ctx: ProjectContext): Store {
  mkdirSync(path.dirname(ctx.dbPath), { recursive: true });
  return new Store(ctx.dbPath);
}
