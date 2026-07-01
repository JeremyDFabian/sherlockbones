import path from "node:path";
import type { ProjectContext } from "../cli/context.js";
import { isSourceFile } from "../project/project.js";
import type { RunOptions, RunResult } from "./run.js";

const PATCH_FILE_RE = /\*\*\* (?:Update|Add|Rename) File: ([^\n"\\]+)/g;
const PATCH_MOVE_RE = /\*\*\* Move to: ([^\n"\\]+)/g;

function toRelative(root: string, file: string): string {
  const rel = path.isAbsolute(file) ? path.relative(root, file) : file;
  return rel.replace(/^\.\//, "").split(path.sep).join("/");
}

/**
 * Pull the edited source files out of an agent's PostToolUse payload. Handles both
 * Claude Code (`tool_input.file_path`) and Codex apply_patch markers
 * (`*** Update/Add/Rename File:` and `*** Move to:`) in the patch text. A rename
 * contributes both its old and new paths. Non-source files are dropped.
 */
export function extractChangedFiles(payload: unknown, root: string): string[] {
  const found = new Set<string>();
  const toolInput = (payload as { tool_input?: unknown })?.tool_input;

  if (toolInput && typeof toolInput === "object") {
    const filePath = (toolInput as { file_path?: unknown }).file_path;
    if (typeof filePath === "string") found.add(toRelative(root, filePath));

    const patch = JSON.stringify(toolInput);
    for (const match of patch.matchAll(PATCH_FILE_RE)) {
      // A rename marker is "old -> new"; record both sides.
      for (const part of match[1]!.split(/\s*->\s*/)) {
        found.add(toRelative(root, part.trim()));
      }
    }
    for (const match of patch.matchAll(PATCH_MOVE_RE)) {
      found.add(toRelative(root, match[1]!.trim()));
    }
  }

  return [...found].filter(isSourceFile);
}

export interface HookDeps {
  run: (ctx: ProjectContext, opts: RunOptions) => RunResult | Promise<RunResult>;
}

/**
 * Handle a PostToolUse hook invocation: parse the JSON payload from the agent,
 * run the affected tests in agent format, and return the result. Returns null
 * (a quiet no-op) when the payload is unparseable or touches no source files.
 */
export async function handleHook(
  rawStdin: string,
  ctx: ProjectContext,
  deps: HookDeps,
): Promise<RunResult | null> {
  let payload: unknown;
  try {
    payload = JSON.parse(rawStdin);
  } catch {
    return null;
  }

  const changed = extractChangedFiles(payload, ctx.root);
  if (changed.length === 0) return null;

  return deps.run(ctx, { changed, format: "agent", budget: {}, daemon: true });
}
