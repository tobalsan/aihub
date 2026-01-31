import { describe, it, expect, afterEach } from "vitest";
import { WebSocketServer } from "ws";
import type { AddressInfo } from "node:net";
import type { AgentConfig, StreamEvent } from "@aihub/shared";
import { openclawAdapter } from "./adapter.js";

function createAgent(gatewayUrl: string, token: string, sessionKey = "session-1"): AgentConfig {
  return {
    id: "openclaw-agent",
    name: "OpenClaw Agent",
    workspace: "~/test",
    sdk: "openclaw",
    model: { model: "openclaw-model" },
    queueMode: "queue",
    openclaw: { gatewayUrl, token, sessionKey },
  };
}

describe("openclaw adapter", () => {
  let wss: WebSocketServer | null = null;

  afterEach(async () => {
    if (wss) {
      await new Promise<void>((resolve) => wss!.close(() => resolve()));
      wss = null;
    }
  });

  it("streams chat deltas and tool events", async () => {
    wss = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => wss!.once("listening", () => resolve()));
    const port = (wss.address() as AddressInfo).port;

    const received: string[] = [];
    const token = "token-123";

    wss.on("connection", (ws) => {
      ws.send(JSON.stringify({ type: "event", event: "connect.challenge", payload: {} }));
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        if (msg.type !== "req") return;
        const method = msg.method as string | undefined;
        const params = msg.params as Record<string, unknown> | undefined;
        if (method === "connect") {
          received.push("connect");
          expect(params?.token).toBe(token);
          return;
        }
        if (method === "chat.history") {
          received.push("chat.history");
          expect(params?.sessionKey).toBe("session-1");
          expect(params?.limit).toBe(200);
          return;
        }
        if (method === "chat.send") {
          received.push("chat.send");
          expect(params?.sessionKey).toBe("session-1");
          expect(params?.deliver).toBe(false);
          ws.send(
            JSON.stringify({
              type: "res",
              id: msg.id,
              ok: true,
              payload: { runId: "run-1", status: "started" },
            })
          );
          ws.send(
            JSON.stringify({
              type: "event",
              event: "agent",
              payload: {
                stream: "tool",
                data: { phase: "start", name: "search", args: { q: "x" } },
              },
            })
          );
          ws.send(
            JSON.stringify({
              type: "event",
              event: "chat",
              payload: {
                state: "delta",
                message: "Hello ",
                runId: "run-1",
              },
            })
          );
          ws.send(
            JSON.stringify({
              type: "event",
              event: "agent",
              payload: {
                stream: "tool",
                data: { phase: "result", name: "search", result: { ok: true } },
              },
            })
          );
          ws.send(
            JSON.stringify({
              type: "event",
              event: "chat",
              payload: {
                state: "delta",
                message: "world",
                runId: "run-1",
              },
            })
          );
          ws.send(
            JSON.stringify({
              type: "event",
              event: "chat",
              payload: {
                state: "final",
                message: "Hello world",
                runId: "run-1",
              },
            })
          );
        }
      });
    });

    const events: StreamEvent[] = [];
    const history: Array<{ type: string }> = [];

    const agent = createAgent(`ws://127.0.0.1:${port}`, token);
    const result = await openclawAdapter.run({
      agentId: agent.id,
      agent,
      sessionId: "default",
      message: "ping",
      workspaceDir: "/tmp",
      onEvent: (event) => events.push(event),
      onHistoryEvent: (event) => history.push({ type: event.type }),
      abortSignal: new AbortController().signal,
    });

    expect(result.text).toBe("Hello world");
    expect(received).toEqual(["connect", "chat.history", "chat.send"]);
    expect(events.some((e) => e.type === "tool_start")).toBe(true);
    expect(events.some((e) => e.type === "tool_call")).toBe(true);
    expect(events.some((e) => e.type === "tool_end")).toBe(true);
    expect(events.filter((e) => e.type === "text").map((e) => (e as { data: string }).data)).toEqual([
      "Hello ",
      "world",
    ]);
    expect(history.some((e) => e.type === "tool_call")).toBe(true);
    expect(history.some((e) => e.type === "tool_result")).toBe(true);
  });

  it("emits error on chat error state", async () => {
    wss = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => wss!.once("listening", () => resolve()));
    const port = (wss.address() as AddressInfo).port;

    const token = "token-err";

    wss.on("connection", (ws) => {
      ws.send(JSON.stringify({ type: "event", event: "connect.challenge", payload: {} }));
      ws.on("message", (data) => {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        if (msg.type !== "req") return;
        if (msg.method === "chat.send") {
          ws.send(
            JSON.stringify({
              type: "res",
              id: msg.id,
              ok: true,
              payload: { runId: "run-err", status: "started" },
            })
          );
          ws.send(
            JSON.stringify({
              type: "event",
              event: "chat",
              payload: {
                state: "error",
                message: "boom",
                runId: "run-err",
              },
            })
          );
        }
      });
    });

    const events: StreamEvent[] = [];
    const agent = createAgent(`ws://127.0.0.1:${port}`, token);

    await expect(
      openclawAdapter.run({
        agentId: agent.id,
        agent,
        sessionId: "default",
        message: "ping",
        workspaceDir: "/tmp",
        onEvent: (event) => events.push(event),
        onHistoryEvent: () => undefined,
        abortSignal: new AbortController().signal,
      })
    ).rejects.toThrow("boom");

    expect(events.some((e) => e.type === "error")).toBe(true);
  });
});
