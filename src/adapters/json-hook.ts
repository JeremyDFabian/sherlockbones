import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * The command both adapters register; reads the PostToolUse payload on stdin.
 * Uses `npx` with the package name (not the `bones` bin) so it resolves a
 * project-local install — `npx bones` would fetch an unrelated `bones` package
 * from the registry. Stays portable when the config is committed.
 */
export const HOOK_COMMAND = "npx sherlockbones hook";

interface CommandHandler {
  type: "command";
  command: string;
}

interface MatcherGroup {
  matcher?: string;
  hooks?: CommandHandler[];
}

interface HookFile {
  hooks?: { PostToolUse?: MatcherGroup[]; [event: string]: unknown };
  [key: string]: unknown;
}

function readJson(file: string): HookFile {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8")) as HookFile;
  } catch {
    return {};
  }
}

function writeJson(file: string, data: HookFile): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

/**
 * Add a PostToolUse command hook to a JSON config (Claude Code settings.json and
 * Codex hooks.json share this `hooks.PostToolUse` matcher-group shape). Idempotent:
 * returns false if our command is already registered. Other config is preserved.
 */
export function installJsonHook(
  file: string,
  matcher: string,
  command: string = HOOK_COMMAND,
): boolean {
  const config = readJson(file);
  const hooks = (config.hooks ??= {});
  const groups = (hooks.PostToolUse ??= []);

  if (groups.some((g) => g.hooks?.some((h) => h.command === command))) {
    return false;
  }

  groups.push({ matcher, hooks: [{ type: "command", command }] });
  writeJson(file, config);
  return true;
}

/** Remove our command hook from a JSON config, dropping now-empty matcher groups. */
export function uninstallJsonHook(file: string, command: string = HOOK_COMMAND): void {
  if (!existsSync(file)) return;
  const config = readJson(file);
  const groups = config.hooks?.PostToolUse;
  if (!groups) return;

  config.hooks!.PostToolUse = groups
    .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => h.command !== command) }))
    .filter((g) => g.hooks.length > 0);
  writeJson(file, config);
}
