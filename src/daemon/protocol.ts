import path from "node:path";
import type { TestResult } from "../runner/runner.js";

/** Unix-socket path for a project's daemon. */
export function socketPath(root: string): string {
  return path.join(root, ".sherlockbones", "daemon.sock");
}

/** Pidfile path for a project's daemon. */
export function pidPath(root: string): string {
  return path.join(root, ".sherlockbones", "daemon.pid");
}

/** Client → daemon. Files are absolute test-file paths chosen by the client. */
export type Request =
  | { type: "ping" }
  | { type: "run"; files: string[] }
  | { type: "shutdown" };

/** Daemon → client. */
export type Response =
  | { type: "pong" }
  | { type: "result"; results: TestResult[]; passed: boolean; durationMs: number }
  | { type: "error"; message: string };

/** Frame a message as a single newline-delimited JSON line. */
export function frame(msg: Request | Response): string {
  return `${JSON.stringify(msg)}\n`;
}

/**
 * Incremental newline-delimited JSON parser. Feed it chunks; it returns any
 * complete messages and buffers the remainder. One connection carries one
 * request and one response, but framing keeps reads robust to chunk splits.
 */
export function createParser<T>(): (chunk: string) => T[] {
  let buffer = "";
  return (chunk: string): T[] => {
    buffer += chunk;
    const out: T[] = [];
    let nl = buffer.indexOf("\n");
    while (nl !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line !== "") out.push(JSON.parse(line) as T);
      nl = buffer.indexOf("\n");
    }
    return out;
  };
}
