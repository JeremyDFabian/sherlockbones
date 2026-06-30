import { existsSync } from "node:fs";
import path from "node:path";
import { installJsonHook, uninstallJsonHook } from "./json-hook.js";
import type { Adapter } from "./types.js";

const hooksPath = (root: string): string => path.join(root, ".codex", "hooks.json");

/** Codex: PostToolUse hook in .codex/hooks.json fired after the apply_patch tool. */
export const codexAdapter: Adapter = {
  id: "codex",
  name: "Codex",
  detect: (root) => existsSync(path.join(root, ".codex")),
  install: (root) => installJsonHook(hooksPath(root), "apply_patch"),
  uninstall: (root) => uninstallJsonHook(hooksPath(root)),
};
