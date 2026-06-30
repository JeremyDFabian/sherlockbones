import { describe, expect, it, vi } from "vitest";
import { extractChangedFiles, handleHook } from "./hook.js";

const root = "/p";

describe("extractChangedFiles", () => {
  it("reads file_path from a Claude Code edit payload", () => {
    const payload = { tool_name: "Edit", tool_input: { file_path: "/p/src/cart.ts" } };
    expect(extractChangedFiles(payload, root)).toEqual(["src/cart.ts"]);
  });

  it("ignores non-source edits", () => {
    const payload = { tool_name: "Write", tool_input: { file_path: "/p/README.md" } };
    expect(extractChangedFiles(payload, root)).toEqual([]);
  });

  it("parses apply_patch markers from a Codex payload", () => {
    const payload = {
      tool_name: "apply_patch",
      tool_input: {
        input:
          "*** Begin Patch\n*** Update File: src/cart.ts\n@@\n-old\n+new\n*** Add File: src/new.ts\n+x\n*** End Patch",
      },
    };
    expect(extractChangedFiles(payload, root)).toEqual(["src/cart.ts", "src/new.ts"]);
  });

  it("captures both sides of an apply_patch rename", () => {
    const payload = {
      tool_name: "apply_patch",
      tool_input: { input: "*** Rename File: src/old.ts -> src/new.ts\n" },
    };
    expect(extractChangedFiles(payload, root)).toEqual(["src/old.ts", "src/new.ts"]);
  });

  it("captures a Move to destination", () => {
    const payload = {
      tool_name: "apply_patch",
      tool_input: { input: "*** Update File: src/a.ts\n*** Move to: src/b.ts\n" },
    };
    expect(extractChangedFiles(payload, root)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("de-duplicates and relativizes", () => {
    const payload = {
      tool_input: {
        file_path: "/p/src/cart.ts",
        input: "*** Update File: src/cart.ts\n",
      },
    };
    expect(extractChangedFiles(payload, root)).toEqual(["src/cart.ts"]);
  });
});

describe("handleHook", () => {
  it("runs the changed files in agent format", () => {
    const run = vi.fn().mockReturnValue({ output: "ok", exitCode: 0, summary: {} });
    const ctx = { root, dbPath: "", vitestBin: "vitest" };
    const payload = JSON.stringify({ tool_input: { file_path: "/p/src/cart.ts" } });

    const result = handleHook(payload, ctx, { run });
    expect(run).toHaveBeenCalledWith(ctx, {
      changed: ["src/cart.ts"],
      format: "agent",
      budget: {},
    });
    expect(result?.exitCode).toBe(0);
  });

  it("is a quiet no-op when no source files changed", () => {
    const run = vi.fn();
    const ctx = { root, dbPath: "", vitestBin: "vitest" };
    const payload = JSON.stringify({ tool_input: { file_path: "/p/notes.md" } });

    expect(handleHook(payload, ctx, { run })).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it("is a quiet no-op on unparseable input", () => {
    const run = vi.fn();
    const ctx = { root, dbPath: "", vitestBin: "vitest" };
    expect(handleHook("not json", ctx, { run })).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });
});
