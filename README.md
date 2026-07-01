<div align="center">

# sherlockbones

**Sniffs out the tests that actually cover your change — and runs just those.** 🦴

</div>

<p align="center">
  <!-- These two populate automatically once `sherlockbones` is published to npm. -->
  <a href="https://www.npmjs.com/package/sherlockbones"><img alt="npm version" src="https://img.shields.io/npm/v/sherlockbones.svg?color=cb3837&logo=npm"></a>
  <a href="https://www.npmjs.com/package/sherlockbones"><img alt="npm downloads" src="https://img.shields.io/npm/dm/sherlockbones.svg?color=cb3837&logo=npm"></a>
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="node" src="https://img.shields.io/badge/node-%E2%89%A524-339933?logo=node.js&logoColor=white">
</p>

<p align="center">
  <a href="#why-agent-time">Why</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#usage">Usage</a> ·
  <a href="#architecture">Architecture</a>
</p>

---

When an AI coding agent edits a file, it has no fast way to know whether it just broke something. It either reruns the whole suite (too slow, so it gets skipped) or runs nothing and edits on. Breakages are found **late and tangled** — three failures across six changed files, and now it has to play detective.

sherlockbones gives the inner loop a **fast, automatic, per-edit "did I just break this?" signal.** The instant a file changes, it runs *only* the tests that exercise that file — 4 tests in 2s, not 800 in 90s — and feeds a focused pass/fail result back to whoever made the change.

The core insight: **the hard part is the map.** Answering "which tests cover this exact line I just changed?" is the moat — and it's exactly what generic "run tests on save" hooks skip.

## Features

- ⚡ **Per-edit, not per-session** — affected tests run the moment a file changes, inside the agent loop, so a break surfaces at the edit that caused it.
- 🔥 **Warm-Vitest daemon** — a resident Vitest instance runs the selected tests without paying process/transform startup on every edit; `run` and the hook start it automatically and it idles out on its own.
- 🎯 **Per-test line coverage** — an Istanbul-based index maps every source line to the individual tests that executed it; a changed line resolves to exactly its tests.
- 🪜 **Three-tier fallback** — coverage → import graph → filename heuristic, so it works even on a cold cache with zero prior runs.
- 🛟 **Fails open, never silent** — stale or missing coverage widens the selection instead of risking a miss, and always reports what it skipped.
- 🔁 **Self-healing map** — cold runs fold their own coverage back in, so the index sharpens the more you use it.
- 📈 **Live recall calibration** — `bones calibrate` runs the full suite for ground truth and reports what fraction of real failures the selection actually caught.
- 🤖 **Agent-native** — one PostToolUse hook for **Claude Code** and **Codex**; also a plain CLI for humans, pre-commit, and CI.
- 📦 **Zero-infra** — a single local SQLite file (`node:sqlite`, no native build, no server).

## Quick start

```bash
npm install -D sherlockbones vitest @vitest/coverage-istanbul
```

Set it up once — detect your agent, install its hook, and build the initial index:

```bash
npx bones init
```

Then it runs automatically after each edit. Or drive it directly:

```bash
npx bones run --changed src/cart.ts            # run the tests covering cart.ts
npx bones map --explain src/cart.ts            # show which tests cover a file
npx bones stats                                # recall / reduction / speed over recent runs
```

<details>
<summary><strong>Build from source</strong></summary>

<br>

```bash
git clone https://github.com/JeremyDFabian/sherlockbones.git
cd sherlockbones
npm install
npm run build      # compiles to dist/
npm test           # 84 tests
npm run bench      # headline metrics against the sample fixture
```

Requires Node.js 24+ (uses the built-in `node:sqlite`).

</details>

## Why agent-time

Running the full suite after every edit is too slow, so agents skip it and build on a broken foundation. Running it only at the end means untangling several failures across several files at once — expensive in turns and tokens. The value only exists *inside* the loop: catch the break at the introducing edit, while the context is still one file. sherlockbones is that continuous, selective signal; a pre-commit / CI adapter is the safety net for anything that slips through.

## How it works

sherlockbones keeps a SQLite index (`.sherlockbones/index.db`) mapping source lines to covering tests, and answers *"which tests cover this change?"* through three tiers, in decreasing precision:

| Tier | Source | When it's used |
|------|--------|----------------|
| 🟢 **Coverage** | Per-test Istanbul coverage, remapped to original source lines | The changed lines are in the index |
| 🟡 **Import graph** | Tests that transitively import the changed module | No coverage yet (cold start) |
| 🔴 **Heuristic** | Filename convention (`cart.ts` → `cart.test.ts`) | Everything else fails |

On each edit:

1. **Diff** — `git diff` yields the changed line ranges of the file.
2. **Select** — look those lines up in the index → the exact covering tests. If the file's coverage is *stale* (its hash changed since indexing), the selection widens to whole files + the import graph and is reported as `low confidence`.
3. **Run** — run just the selected test files on a resident warm-Vitest daemon (started on first use, idles out on its own) and parse the results. `--no-daemon` forces a cold run.
4. **Report** — a compact result for agents (silent on pass), a colored summary for humans; exit non-zero on failure so the agent self-corrects in the same turn.
5. **Heal** — cold runs fold their coverage back into the index; the warm daemon path skips folding, so the map is refreshed by `map --rebuild` and `calibrate`. Source-file hashes are re-recorded only by `map --rebuild`; between rebuilds an edited file stays low confidence and widens its selection to whole covering files, trading a little reduction for recall.

sherlockbones is the brain that decides *which* tests; [Vitest](https://vitest.dev) is the muscle that runs them and produces the coverage. It is **not** a test runner or a coverage tool — it orchestrates the ones your project already uses.

## Usage

### CLI

```
bones run --changed <files...> [--format agent|human] [--budget-tests N] [--no-daemon]
bones map --rebuild              # rebuild the index from a full coverage run
bones map --explain <file>       # show which tests cover a file
bones calibrate [--changed <files...>]  # run the full suite and measure live recall
bones stats                      # recall / reduction / speed over recent runs
bones init [--no-rebuild]        # detect agents, install hooks, build the index
bones daemon [--status|--stop]   # manage the warm-Vitest daemon (auto-started by run/hook)
bones hook                       # run as an agent PostToolUse hook (reads stdin)
```

A real run against a broken edit:

```console
$ bones run --changed src/pricing.ts --format agent
bones: 2 failed, 2 passed / 2 selected via coverage
FAIL test/pricing.test.ts applyDiscount subtracts the percentage
  AssertionError: expected 110 to be 90
FAIL test/cart.test.ts cart applies a discount to the total
  AssertionError: expected 110 to be 90
```

**Output streams.** `--format human` (default) prints a colored summary to **stdout**. `--format agent` prints a compact report to **stderr** and stays silent on success. Either way the exit code is non-zero when a covering test fails.

### Agent integration

`bones init` installs a `PostToolUse` hook that runs `npx sherlockbones hook` after edits; the hook reads the agent's JSON payload on stdin and runs the affected tests.

- **Claude Code** — `.claude/settings.json`, matching `Edit|Write|MultiEdit`.
- **Codex** — `.codex/hooks.json`, matching the `apply_patch` tool.

Both reuse the same engine and the same `agent`-format output.

## Architecture

```
src/
  store/        # SQLite index — the source-line → test map (owns the schema)
  coverage/     # per-test Istanbul capture + source-map remap + fold  ← the moat
  impact/       # three-tier selection: coverage → import-graph → heuristic
  selector/     # budget-aware test selection (never truncates silently)
  runner/       # vitest shim: run selected files, parse JSON results
  daemon/       # resident warm-Vitest server + client + wire protocol
  formatter/    # agent (compact) + human (colored) output
  project/      # source scanning + git-diff line ranges
  commands/     # run · rebuild · calibrate · stats · init · daemon · hook orchestration
  bench/        # mutation harness + metrics aggregation (unit-tested)
  adapters/     # claude code + codex hook installers (shared json-hook helper)
  cli/          # the `bones` entrypoint
fixtures/       # sample-app: a real Vitest project used by tests + the benchmark
bench/          # runnable harnesses → speedup / recall / reduction, daemon + coverage latency
```

Every adapter and command is a thin consumer of the engine — the selection logic lives in one place, so the CLI and the agent hook always agree.

## Benchmark

`npm run bench` introduces known breaking edits into the sample fixture, runs sherlockbones' selection against the full suite for each, and reports the headline metrics:

```
recall:    100.0%   — every failure the full suite finds is caught
reduction:  62.5%   — fraction of the suite skipped
```

Recall is the metric that matters: a missed failure gives false confidence. The fixture is intentionally tiny, so reduction is modest here — point the harness at a real repo for representative numbers.

## Scope & limitations

- **Vitest only** for now. The runner is a swappable backend, so Jest / pytest / `go test` can follow.
- **Whole-file execution.** Selection is per-test, but a covering test *file* runs in full (recall-safe). So the reported "selected" count can be lower than the number of tests actually run; per-test execution is planned.
- **Recall is measured on demand, not continuously.** `bones calibrate` runs the full suite to measure live recall and records it, so `bones stats` shows real recall once you've calibrated; until then it shows `n/a`. The benchmark also measures recall offline.

## Contributing

Issues and PRs welcome. Bug reports with a minimal Vitest repro, and new fixtures for the benchmark, are especially valued: [github.com/JeremyDFabian/sherlockbones/issues](https://github.com/JeremyDFabian/sherlockbones/issues).

## License

[MIT](LICENSE) © Jeremy Fabian
