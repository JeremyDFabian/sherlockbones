export type AgentId = "claude-code" | "codex";

/** Per-agent glue that wires `bones hook` to fire after the agent edits a file. */
export interface Adapter {
  id: AgentId;
  name: string;
  /** Is this agent configured in the project? */
  detect(root: string): boolean;
  /** Install the PostToolUse hook. Returns true if added, false if already present. */
  install(root: string): boolean;
  /** Remove the sherlockbones hook, leaving other config intact. */
  uninstall(root: string): void;
}
