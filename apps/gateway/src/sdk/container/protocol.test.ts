import { describe, expect, it } from "vitest";
import {
  CONTAINER_EVENT_PREFIX,
  CONTAINER_OUTPUT_END,
  CONTAINER_OUTPUT_START,
} from "@aihub/shared";
import {
  ContainerProtocolDecoder,
  getMeaningfulStderr,
  parseProtocolOutput,
} from "./protocol.js";

describe("container protocol", () => {
  it("decodes split event frames and final output", () => {
    const decoder = new ContainerProtocolDecoder();
    const event = { type: "assistant_text", text: "hi", timestamp: 1 };
    const line = `${CONTAINER_EVENT_PREFIX}${JSON.stringify(event)}\n`;

    expect(decoder.write(line.slice(0, 12))).toEqual([]);
    expect(decoder.write(line.slice(12))).toEqual([
      { type: "event", payload: JSON.stringify(event) },
    ]);

    decoder.write(
      `${CONTAINER_OUTPUT_START}\n${JSON.stringify({
        text: "done",
      })}\n${CONTAINER_OUTPUT_END}\n`
    );

    expect(decoder.parseOutput()).toEqual({ text: "done" });
  });

  it("flushes a final unterminated event line", () => {
    const decoder = new ContainerProtocolDecoder();
    const event = { type: "assistant_text", text: "tail", timestamp: 1 };

    decoder.write(`${CONTAINER_EVENT_PREFIX}${JSON.stringify(event)}`);

    expect(decoder.flush()).toEqual([
      { type: "event", payload: JSON.stringify(event) },
    ]);
  });

  it("parses output blocks and filters benign runner stderr", () => {
    expect(parseProtocolOutput([JSON.stringify({ text: "ok" })])).toEqual({
      text: "ok",
    });
    expect(
      getMeaningfulStderr(
        "[agent-runner] Running agent cloud with SDK pi\nreal error\n"
      )
    ).toBe("real error");
  });
});
