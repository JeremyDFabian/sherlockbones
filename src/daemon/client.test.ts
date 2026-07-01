import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pingDaemon, stopDaemon } from "./client.js";

describe("daemon client", () => {
  it("reports no daemon (and never throws) when the socket is absent", async () => {
    // A fresh dir has no socket; connect fails and both calls resolve falsy rather
    // than rejecting — this is what lets the run path fall back to the cold runner.
    const root = mkdtempSync(path.join(tmpdir(), "bones-nodaemon-"));
    expect(await pingDaemon(root)).toBe(false);
    expect(await stopDaemon(root)).toBe(false);
  });
});
