# Warm-Vitest daemon — latency prototype

Status: approved (prototype scope)
Date: 2026-07-01

## Problem

Every per-edit run spawns `npx → node → vitest` as a **cold** process. Vitest
startup (Vite server, transform, module graph) is ~0.5–2s before a single test
executes. That cold cost is paid on every edit and threatens the tool's core
promise of a sub-3s, "feels instant" per-edit signal.

## Hypothesis

Keeping **one Vitest instance resident** removes cold startup from the hot path,
so a per-edit run costs only test execution + IPC.

## Scope (this prototype)

- **In:** a daemon holding a warm Vitest instance; a client with cold fallback;
  transparent use from `run`/`hook`; a cold-vs-warm latency benchmark.
- **Out (deferred):** per-test coverage self-heal in warm mode (the map still
  sharpens via cold `bones map --rebuild`); Windows named pipes (Unix socket
  only); per-test `-t` filtering.

The impact-map **selection stays in the client** (SQLite + git diff are already
sub-millisecond). The daemon is purely a *warm test-runner service*: given a set
of absolute test file paths, it runs them and returns structured pass/fail.

## Approach

Chosen: **programmatic `createVitest('test', { watch: false })`** held resident,
driven per request with `runTestSpecifications(specs)`.

Rejected alternatives:
- Drive `vitest --watch` over its internal WS — loses control of *which* tests
  run (it reacts to file saves with its own selection) and couples to an
  internal protocol.
- `vitest --standalone` via CLI flags — a thinner version of the chosen approach
  with worse structured-result access.

## Components (all new code isolated under `src/daemon/`)

- `protocol.ts` — request/response types and line-delimited JSON framing.
- `server.ts` — owns the warm Vitest instance; listens on a Unix socket at
  `.sherlockbones/daemon.sock`; **single-flight** run serialization (a warm
  instance is not concurrency-safe); idle-exits after 15 minutes; handles
  `ping` / `run` / `shutdown`.
- `client.ts` — `runViaDaemon(files) → ParsedRun | null`. Connects if the socket
  is live; if not, **auto-spawns the daemon detached** (pidfile + socket) and
  returns `null` so the current run falls back to cold while the daemon warms.
  Any error → `null` → cold fallback. Never blocks; self-heals.

## Integration

- `run.ts` tries the warm path first; on `null` it uses the existing cold
  `VitestRunner`. **Coverage fold runs only on the cold path**, so warm runs are
  pass/fail only. Everything from the prior hardening work is unchanged — the
  daemon is purely additive with a guaranteed fallback.
- CLI: `bones daemon [--status|--stop]`; `run`/`hook` use the daemon
  transparently.

## Transport & lifecycle (chosen defaults)

- **Unix domain socket** (`.sherlockbones/daemon.sock`); macOS/Linux only for
  the prototype.
- **Lazy auto-spawn**: no manual start step. First run with no live daemon spawns
  it detached and falls back to cold; subsequent runs hit the warm instance.

## Measurement

`bench/daemon-latency.ts` times cold vs. warm on the fixture (and a synthetic
larger suite), reporting the per-edit delta — the hypothesis under test.

## Risks

- Exact result-extraction API from `runTestSpecifications` (via `vitest.state`
  or a lightweight in-process reporter); confirm repeated warm runs work with
  `watch:false`. Spike during build; adapt if details differ.
- A stale socket/pidfile from a crashed daemon — client treats a failed connect
  as dead, removes the socket, and respawns.

## Testing

- protocol framing (unit)
- client fallback-to-cold when no socket (unit)
- daemon integration: start → run a fixture file → assert results → close
  (guarded with a timeout)
