import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { streamMessage } from "./client";

type MessageEventLike = { data: string };

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;

  url: string;
  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];
  onopen?: () => void;
  onmessage?: (event: MessageEventLike) => void;
  onerror?: () => void;
  onclose?: () => void;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  receive(event: unknown) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }

  triggerError() {
    this.onerror?.();
  }
}

describe("streamMessage", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
    vi.stubGlobal("window", { location: { protocol: "http:", host: "localhost:5173" } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("routes streaming events to callbacks", () => {
    const onText = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();
    const onThinking = vi.fn();
    const onToolCall = vi.fn();
    const onToolStart = vi.fn();
    const onToolEnd = vi.fn();
    const onSessionReset = vi.fn();

    const cleanup = streamMessage(
      "agent-1",
      "hello",
      "main",
      onText,
      onDone,
      onError,
      {
        onThinking,
        onToolCall,
        onToolStart,
        onToolEnd,
        onSessionReset,
      }
    );

    const ws = MockWebSocket.instances[0];
    expect(ws).toBeTruthy();

    ws.open();
    expect(ws.sent.length).toBe(1);
    expect(JSON.parse(ws.sent[0] ?? "{}")).toEqual({
      type: "send",
      agentId: "agent-1",
      sessionKey: "main",
      message: "hello",
    });

    ws.receive({ type: "text", data: "hi" });
    ws.receive({ type: "thinking", data: "plan" });
    ws.receive({ type: "tool_call", id: "1", name: "bash", arguments: { cmd: "ls" } });
    ws.receive({ type: "tool_start", toolName: "bash" });
    ws.receive({ type: "tool_end", toolName: "bash", isError: false });
    ws.receive({ type: "session_reset", sessionId: "s1" });
    ws.receive({ type: "done", meta: { durationMs: 12 } });
    ws.receive({ type: "error", message: "nope" });

    expect(onText).toHaveBeenCalledWith("hi");
    expect(onThinking).toHaveBeenCalledWith("plan");
    expect(onToolCall).toHaveBeenCalledWith("1", "bash", { cmd: "ls" });
    expect(onToolStart).toHaveBeenCalledWith("bash");
    expect(onToolEnd).toHaveBeenCalledWith("bash", false);
    expect(onSessionReset).toHaveBeenCalledWith("s1");
    expect(onDone).toHaveBeenCalledWith({ durationMs: 12 });
    expect(onError).toHaveBeenCalledWith("nope");

    cleanup();
    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
  });

  it("reports connection errors", () => {
    const onText = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();

    streamMessage("agent-2", "hi", "main", onText, onDone, onError);

    const ws = MockWebSocket.instances[0];
    ws.triggerError();

    expect(onError).toHaveBeenCalledWith("Connection error");
  });
});
