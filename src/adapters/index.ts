import { claudeCodeAdapter } from "./claude-code.js";
import { codexAdapter } from "./codex.js";
import type { Adapter } from "./types.js";

export type { Adapter, AgentId } from "./types.js";
export { HOOK_COMMAND } from "./json-hook.js";

export const ADAPTERS: Adapter[] = [claudeCodeAdapter, codexAdapter];

/** Adapters whose agent is configured in the given project. */
export function detectAgents(root: string): Adapter[] {
  return ADAPTERS.filter((adapter) => adapter.detect(root));
}
