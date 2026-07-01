import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";
import type { RunOutcome } from "../runner/runner.js";
import { createParser, frame, socketPath, type Response } from "./protocol.js";

/** How long to wait for the daemon to accept a connection before falling back. */
const CONNECT_TIMEOUT_MS = 500;
/** Cap a single warm run so a wedged daemon can't hang the caller. */
const RUN_TIMEOUT_MS = 120_000;

/**
 * Run the given absolute test files via the warm daemon, or return null if the
 * daemon isn't reachable — in which case the caller uses the cold runner. When no
 * daemon is running, spawns one detached so the *next* run is warm; this run still
 * falls back to cold so it never blocks on cold-start.
 */
export function runViaDaemon(root: string, files: string[]): Promise<RunOutcome | null> {
  return request(root, { type: "run", files }).then(
    (res) => {
      if (res?.type === "result") {
        return { results: res.results, passed: res.passed, durationMs: res.durationMs };
      }
      return null;
    },
    () => {
      spawnDaemon(root);
      return null;
    },
  );
}

/** True if a daemon answered a ping. */
export function pingDaemon(root: string): Promise<boolean> {
  return request(root, { type: "ping" }).then(
    (res) => res?.type === "pong",
    () => false,
  );
}

/** Ask a running daemon to shut down. Resolves regardless of whether one was up. */
export function stopDaemon(root: string): Promise<boolean> {
  return request(root, { type: "shutdown" }).then(
    (res) => res?.type === "pong",
    () => false,
  );
}

/** Open a connection, send one request, resolve with the one response. */
function request(
  root: string,
  message: { type: "ping" } | { type: "run"; files: string[] } | { type: "shutdown" },
): Promise<Response | null> {
  return new Promise<Response | null>((resolve, reject) => {
    const socket = createConnection(socketPath(root));
    const parse = createParser<Response>();
    let settled = false;
    const done = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      fn();
    };

    socket.setEncoding("utf8");
    socket.setTimeout(CONNECT_TIMEOUT_MS);
    socket.on("connect", () => {
      socket.setTimeout(RUN_TIMEOUT_MS);
      socket.write(frame(message));
    });
    socket.on("data", (chunk: string) => {
      let responses: Response[];
      try {
        responses = parse(chunk);
      } catch {
        done(() => reject(new Error("malformed response")));
        return;
      }
      if (responses.length > 0) done(() => resolve(responses[0] ?? null));
    });
    socket.on("timeout", () => done(() => reject(new Error("daemon timeout"))));
    socket.on("error", (err) => done(() => reject(err)));
    socket.on("close", () => done(() => resolve(null)));
  });
}

/** Launch a detached daemon for this project using the same CLI entrypoint. */
function spawnDaemon(root: string): void {
  const cliEntry = fileURLToPath(new URL("../cli/index.js", import.meta.url));
  const child = spawn(process.execPath, [cliEntry, "daemon"], {
    cwd: root,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}
