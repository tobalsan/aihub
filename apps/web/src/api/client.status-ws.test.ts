import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type MessageEventLike = { data: string };

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEventLike) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  simulateMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  simulateClose() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

describe("subscribeToStatus reconnection", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
    vi.stubGlobal("window", {
      location: { protocol: "http:", host: "localhost:5173" },
      setTimeout,
      clearTimeout,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("reconnects after WebSocket close", async () => {
    const { subscribeToStatus } = await import("./client");

    const statuses: Array<{ agentId: string; status: string }> = [];
    const onReconnect = vi.fn();
    const unsubscribe = subscribeToStatus({
      onStatus: (agentId, status) => statuses.push({ agentId, status }),
      onReconnect,
    });

    expect(MockWebSocket.instances).toHaveLength(1);
    MockWebSocket.instances[0].simulateOpen();
    expect(MockWebSocket.instances[0].sent).toContain(
      JSON.stringify({ type: "subscribeStatus" })
    );

    MockWebSocket.instances[0].simulateClose();

    vi.advanceTimersByTime(1000);

    expect(MockWebSocket.instances).toHaveLength(2);
    MockWebSocket.instances[1].simulateOpen();
    MockWebSocket.instances[1].simulateMessage({
      type: "status",
      agentId: "test-agent",
      status: "streaming",
    });

    expect(statuses).toEqual([
      { agentId: "test-agent", status: "streaming" },
    ]);
    expect(onReconnect).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it("does not reconnect after explicit unsubscribe", async () => {
    const { subscribeToStatus } = await import("./client");

    const unsubscribe = subscribeToStatus({ onStatus: () => {} });

    expect(MockWebSocket.instances).toHaveLength(1);
    MockWebSocket.instances[0].simulateOpen();

    unsubscribe();
    vi.advanceTimersByTime(1000);

    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("shares a single socket across multiple subscribers", async () => {
    const { subscribeToStatus } = await import("./client");

    const statuses1: string[] = [];
    const statuses2: string[] = [];

    const unsubscribe1 = subscribeToStatus({
      onStatus: (_id, status) => statuses1.push(status),
    });
    const unsubscribe2 = subscribeToStatus({
      onStatus: (_id, status) => statuses2.push(status),
    });

    expect(MockWebSocket.instances).toHaveLength(1);
    MockWebSocket.instances[0].simulateOpen();
    MockWebSocket.instances[0].simulateMessage({
      type: "status",
      agentId: "a",
      status: "streaming",
    });

    expect(statuses1).toEqual(["streaming"]);
    expect(statuses2).toEqual(["streaming"]);

    unsubscribe1();
    expect(MockWebSocket.instances[0].readyState).not.toBe(
      MockWebSocket.CLOSED
    );

    unsubscribe2();
  });
});
