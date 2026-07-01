import { describe, expect, it } from "vitest";
import { createParser, frame, type Response } from "./protocol.js";

describe("protocol framing", () => {
  it("frames a message as one newline-terminated JSON line", () => {
    expect(frame({ type: "ping" })).toBe('{"type":"ping"}\n');
  });

  it("reassembles a message split across chunks", () => {
    const parse = createParser<Response>();
    expect(parse('{"type":')).toEqual([]);
    expect(parse('"pong"}\n')).toEqual([{ type: "pong" }]);
  });

  it("parses multiple messages in one chunk and ignores blank lines", () => {
    const parse = createParser<Response>();
    expect(parse('{"type":"pong"}\n\n{"type":"pong"}\n')).toEqual([
      { type: "pong" },
      { type: "pong" },
    ]);
  });
});
