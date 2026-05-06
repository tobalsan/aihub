import { describe, expect, it } from "vitest";
import { getSubagentHarnessAdapter } from "./harness-adapter.js";

describe("SubagentHarnessAdapter", () => {
  it("builds codex start and resume args", () => {
    const adapter = getSubagentHarnessAdapter("codex");

    expect(
      adapter.buildArgs({
        prompt: "hello",
        model: "gpt-5.3-codex",
        reasoningEffort: "medium",
      })
    ).toEqual([
      "exec",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "-m",
      "gpt-5.3-codex",
      "-c",
      "reasoning_effort=medium",
      "hello",
    ]);

    expect(adapter.buildArgs({ prompt: "next", sessionId: "s1" })).toEqual([
      "exec",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "resume",
      "s1",
      "next",
    ]);
  });

  it("builds claude resume args", () => {
    const adapter = getSubagentHarnessAdapter("claude");

    expect(
      adapter.buildArgs({
        prompt: "hello",
        sessionId: "c1",
        model: "opus",
        reasoningEffort: "high",
      })
    ).toEqual([
      "-r",
      "c1",
      "-p",
      "hello",
      "--output-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
      "--model",
      "opus",
      "--effort",
      "high",
    ]);
  });

  it("requires and passes pi session file", () => {
    const adapter = getSubagentHarnessAdapter("pi");

    expect(() => adapter.buildArgs({ prompt: "hello" })).toThrow(
      "Missing Pi session file path"
    );
    expect(
      adapter.buildArgs({
        prompt: "hello",
        sessionFile: "/tmp/pi.jsonl",
        model: "qwen",
        thinking: "high",
      })
    ).toEqual([
      "--mode",
      "json",
      "--session",
      "/tmp/pi.jsonl",
      "--model",
      "qwen",
      "--thinking",
      "high",
      "hello",
    ]);
  });

  it("extracts harness session ids from native JSON lines", () => {
    expect(
      getSubagentHarnessAdapter("codex").extractSessionId(
        '{"type":"thread.started","thread_id":"codex-1"}'
      )
    ).toBe("codex-1");
    expect(
      getSubagentHarnessAdapter("claude").extractSessionId(
        '{"type":"system","session_id":"claude-1"}'
      )
    ).toBe("claude-1");
    expect(
      getSubagentHarnessAdapter("pi").extractSessionId(
        '{"type":"session","id":"pi-1"}'
      )
    ).toBe("pi-1");
    expect(
      getSubagentHarnessAdapter("codex").extractSessionId("plain")
    ).toBeUndefined();
  });
});
