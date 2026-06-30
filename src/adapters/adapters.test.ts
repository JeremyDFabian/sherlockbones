import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { claudeCodeAdapter } from "./claude-code.js";
import { codexAdapter } from "./codex.js";
import { detectAgents } from "./index.js";

function tempRoot(): string {
  return mkdtempSync(path.join(tmpdir(), "bones-adapter-"));
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, "utf8"));
}

describe("claudeCodeAdapter", () => {
  it("detects the presence of a .claude directory", () => {
    const root = tempRoot();
    expect(claudeCodeAdapter.detect(root)).toBe(false);
    mkdirSync(path.join(root, ".claude"));
    expect(claudeCodeAdapter.detect(root)).toBe(true);
  });

  it("installs a PostToolUse hook and is idempotent", () => {
    const root = tempRoot();
    expect(claudeCodeAdapter.install(root)).toBe(true);
    expect(claudeCodeAdapter.install(root)).toBe(false); // already present

    const settings = readJson(path.join(root, ".claude", "settings.json")) as {
      hooks: { PostToolUse: Array<{ matcher: string; hooks: Array<{ command: string }> }> };
    };
    expect(settings.hooks.PostToolUse).toHaveLength(1);
    expect(settings.hooks.PostToolUse[0]!.matcher).toBe("Edit|Write|MultiEdit");
    expect(settings.hooks.PostToolUse[0]!.hooks[0]!.command).toBe("bones hook");
  });

  it("preserves existing settings and removes only its own hook on uninstall", () => {
    const root = tempRoot();
    const file = path.join(root, ".claude", "settings.json");
    mkdirSync(path.join(root, ".claude"));
    writeFileSync(
      file,
      JSON.stringify({
        model: "opus",
        hooks: {
          PostToolUse: [
            { matcher: "Bash", hooks: [{ type: "command", command: "other-tool" }] },
          ],
        },
      }),
    );

    claudeCodeAdapter.install(root);
    expect(readJson(file).model).toBe("opus");

    claudeCodeAdapter.uninstall(root);
    const after = readJson(file) as {
      model: string;
      hooks: { PostToolUse: Array<{ hooks: Array<{ command: string }> }> };
    };
    expect(after.model).toBe("opus");
    expect(after.hooks.PostToolUse).toHaveLength(1);
    expect(after.hooks.PostToolUse[0]!.hooks[0]!.command).toBe("other-tool");
  });
});

describe("codexAdapter", () => {
  it("installs a PostToolUse hook into .codex/hooks.json with the apply_patch matcher", () => {
    const root = tempRoot();
    mkdirSync(path.join(root, ".codex"));
    expect(codexAdapter.detect(root)).toBe(true);
    expect(codexAdapter.install(root)).toBe(true);

    const hooksFile = readJson(path.join(root, ".codex", "hooks.json")) as {
      hooks: { PostToolUse: Array<{ matcher: string; hooks: Array<{ command: string }> }> };
    };
    expect(hooksFile.hooks.PostToolUse[0]!.matcher).toBe("apply_patch");
    expect(hooksFile.hooks.PostToolUse[0]!.hooks[0]!.command).toBe("bones hook");
  });
});

describe("detectAgents", () => {
  it("returns only the agents present in the project", () => {
    const root = tempRoot();
    mkdirSync(path.join(root, ".codex"));
    expect(detectAgents(root).map((a) => a.id)).toEqual(["codex"]);
  });
});
