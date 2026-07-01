import { createServer, type Server, type Socket } from "node:net";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { findVitestConfig } from "../cli/context.js";
import type { TestResult, TestStatus } from "../runner/runner.js";
import { createParser, frame, pidPath, socketPath, type Request } from "./protocol.js";

const DEFAULT_IDLE_MS = 15 * 60 * 1000;

// Minimal structural views of the Vitest Node API we drive (see the design doc).
interface WarmProject {
  createSpecification(moduleId: string): unknown;
}
interface WarmVitest {
  getRootProject(): WarmProject;
  runTestSpecifications(specs: unknown[], allTestsRun: boolean): Promise<unknown>;
  close(): Promise<void>;
}
interface TaskLike {
  type?: string;
  name: string;
  tasks?: TaskLike[];
  location?: { line?: number };
  result?: { state?: string; errors?: Array<{ message?: string }> };
}
interface FileLike {
  name: string;
  tasks?: TaskLike[];
}

function toStatus(state: string | undefined): TestStatus {
  if (state === "pass") return "passed";
  if (state === "fail") return "failed";
  return "skipped";
}

/** Flatten Vitest's task tree into the same TestResult shape the cold runner emits. */
function collect(files: FileLike[]): { results: TestResult[]; passed: boolean } {
  const results: TestResult[] = [];
  const walk = (file: string, tasks: TaskLike[], prefix: string[]): void => {
    for (const task of tasks) {
      if (task.type === "suite") {
        walk(file, task.tasks ?? [], [...prefix, task.name]);
        continue;
      }
      const result: TestResult = {
        file,
        name: [...prefix, task.name].join(" > "),
        status: toStatus(task.result?.state),
      };
      const message = task.result?.errors?.[0]?.message;
      if (message) result.message = message;
      if (task.location?.line !== undefined) result.line = task.location.line;
      results.push(result);
    }
  };
  for (const file of files) walk(file.name, file.tasks ?? [], []);
  return { results, passed: results.every((r) => r.status !== "failed") };
}

/**
 * A resident Vitest instance driven per request. Runs are serialized (single-flight)
 * because one instance can't run concurrent test batches; the instance is created
 * lazily on the first run so `ping` stays cheap.
 */
class WarmRunner {
  private vitest: WarmVitest | null = null;
  private captured: FileLike[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly root: string) {}

  private async ensure(): Promise<WarmVitest> {
    if (this.vitest) return this.vitest;
    const { createVitest } = (await import("vitest/node")) as {
      createVitest: (mode: string, options: unknown) => Promise<WarmVitest>;
    };
    const reporter = {
      onFinished: (files: FileLike[] = []): void => {
        this.captured = files;
      },
    };
    this.vitest = await createVitest("test", {
      root: this.root,
      watch: false,
      reporters: [reporter],
      config: findVitestConfig(this.root),
    });
    return this.vitest;
  }

  /** Run the given absolute test files warm, serialized behind any in-flight run. */
  run(files: string[]): Promise<{ results: TestResult[]; passed: boolean; durationMs: number }> {
    const task = this.queue.then(async () => {
      const vitest = await this.ensure();
      const project = vitest.getRootProject();
      const specs = files.map((f) => project.createSpecification(f));
      const start = Date.now();
      this.captured = [];
      await vitest.runTestSpecifications(specs, false);
      const { results, passed } = collect(this.captured);
      return { results, passed, durationMs: Date.now() - start };
    });
    // Keep the queue chained even if this run rejects, so the next run still proceeds.
    this.queue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  async close(): Promise<void> {
    if (this.vitest) await this.vitest.close();
    this.vitest = null;
  }
}

export interface DaemonOptions {
  root: string;
  idleMs?: number;
}

/**
 * Run the warm-Vitest daemon for a project. Resolves when the server closes
 * (idle timeout, `shutdown` request, or a termination signal).
 */
export function runDaemon(opts: DaemonOptions): Promise<void> {
  const { root } = opts;
  const idleMs = opts.idleMs ?? DEFAULT_IDLE_MS;
  const sock = socketPath(root);
  const pid = pidPath(root);
  const runner = new WarmRunner(root);

  mkdirSync(path.dirname(sock), { recursive: true });
  rmSync(sock, { force: true }); // clear any stale socket from a crashed daemon

  return new Promise<void>((resolve) => {
    let idleTimer: NodeJS.Timeout;
    let closing = false;

    const cleanup = async (): Promise<void> => {
      if (closing) return;
      closing = true;
      clearTimeout(idleTimer);
      server.close();
      await runner.close().catch(() => undefined);
      rmSync(sock, { force: true });
      rmSync(pid, { force: true });
      resolve();
    };

    const touch = (): void => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => void cleanup(), idleMs);
    };

    const server: Server = createServer((socket: Socket) => {
      touch();
      const parse = createParser<Request>();
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => {
        let requests: Request[];
        try {
          requests = parse(chunk);
        } catch {
          socket.end(frame({ type: "error", message: "malformed request" }));
          return;
        }
        for (const req of requests) void handle(req, socket, cleanup, touch, runner);
      });
      socket.on("error", () => undefined);
    });

    server.on("error", () => resolve()); // e.g. address in use → let the caller fall back

    server.listen(sock, () => {
      writeFileSync(pid, String(process.pid));
      touch();
    });

    process.on("SIGTERM", () => void cleanup());
    process.on("SIGINT", () => void cleanup());
  });
}

async function handle(
  req: Request,
  socket: Socket,
  cleanup: () => Promise<void>,
  touch: () => void,
  runner: WarmRunner,
): Promise<void> {
  touch();
  if (req.type === "ping") {
    socket.end(frame({ type: "pong" }));
    return;
  }
  if (req.type === "shutdown") {
    socket.end(frame({ type: "pong" }));
    await cleanup();
    return;
  }
  try {
    const outcome = await runner.run(req.files);
    socket.end(frame({ type: "result", ...outcome }));
  } catch (err) {
    socket.end(
      frame({ type: "error", message: err instanceof Error ? err.message : String(err) }),
    );
  }
}
