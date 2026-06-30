import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ProjectContext } from "../cli/context.js";
import { generateCaptureConfig, init } from "./init.js";

function tempProject(): string {
  const root = mkdtempSync(path.join(tmpdir(), "bones-init-"));
  writeFileSync(path.join(root, "vitest.config.ts"), "export default {};\n");
  return root;
}

function ctxFor(root: string): ProjectContext {
  return { root, dbPath: path.join(root, ".sherlockbones/index.db"), vitestBin: "vitest" };
}

describe("generateCaptureConfig", () => {
  it("extends the user config and enables istanbul coverage with our setup", () => {
    const out = generateCaptureConfig("/p/vitest.config.ts", "/pkg/dist/coverage/setup.js");
    expect(out).toContain('import base from "/p/vitest.config.ts"');
    expect(out).toContain('"/pkg/dist/coverage/setup.js"');
    expect(out).toContain('provider: "istanbul"');
    expect(out).toContain("mergeConfig");
  });

  it("uses an empty base when there is no user config", () => {
    const out = generateCaptureConfig(undefined, "/pkg/dist/coverage/setup.js");
    expect(out).toContain("const base = {}");
  });
});

describe("init", () => {
  it("installs detected adapters and writes the capture config", () => {
    const root = tempProject();
    mkdirSync(path.join(root, ".claude"));

    const result = init(ctxFor(root), { rebuild: false });

    expect(result.agents).toEqual(["Claude Code"]);
    expect(existsSync(path.join(root, ".claude", "settings.json"))).toBe(true);

    const capture = readFileSync(path.join(root, ".sherlockbones", "capture.config.mjs"), "utf8");
    expect(capture).toContain("vitest.config.ts");
    expect(capture).toContain('provider: "istanbul"');
  });
});
