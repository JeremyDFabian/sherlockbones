import { existsSync } from "node:fs";
import path from "node:path";
import { installJsonHook, uninstallJsonHook } from "./json-hook.js";
import type { Adapter } from "./types.js";

const settingsPath = (root: string): string =>
  path.join(root, ".claude", "settings.json");

/** Claude Code: PostToolUse hook in .claude/settings.json fired on Edit/Write/MultiEdit. */
export const claudeCodeAdapter: Adapter = {
  id: "claude-code",
  name: "Claude Code",
  detect: (root) => existsSync(path.join(root, ".claude")),
  install: (root) => installJsonHook(settingsPath(root), "Edit|Write|MultiEdit"),
  uninstall: (root) => uninstallJsonHook(settingsPath(root)),
};
