import { describe, it, expect } from "vitest";
import {
  getOrCreateSession,
  setSessionStreaming,
  isStreaming,
  abortSession,
} from "./sessions.js";
import { agentEventBus } from "./events.js";

describe("sessions", () => {
  const agentId = "test-agent";

  it("creates a new session", () => {
    const sessionId = `test-${Date.now()}-1`;
    const session = getOrCreateSession(agentId, sessionId);
    expect(session.agentId).toBe(agentId);
    expect(session.sessionId).toBe(sessionId);
    expect(session.isStreaming).toBe(false);
  });

  it("returns existing session", () => {
    const sessionId = `test-${Date.now()}-2`;
    const session1 = getOrCreateSession(agentId, sessionId);
    const session2 = getOrCreateSession(agentId, sessionId);
    expect(session1).toBe(session2);
  });

  it("sets streaming state", () => {
    const sessionId = `test-${Date.now()}-3`;
    getOrCreateSession(agentId, sessionId);
    setSessionStreaming(agentId, sessionId, true);
    expect(isStreaming(agentId, sessionId)).toBe(true);

    setSessionStreaming(agentId, sessionId, false);
    expect(isStreaming(agentId, sessionId)).toBe(false);
  });

  it("aborts session with controller", () => {
    const sessionId = `test-${Date.now()}-4`;
    getOrCreateSession(agentId, sessionId);
    const controller = new AbortController();
    setSessionStreaming(agentId, sessionId, true, controller);

    let aborted = false;
    controller.signal.addEventListener("abort", () => {
      aborted = true;
    });

    const result = abortSession(agentId, sessionId);
    expect(result).toBe(true);
    expect(aborted).toBe(true);
  });

  it("returns false when aborting session without controller", () => {
    const sessionId = `test-${Date.now()}-5`;
    getOrCreateSession(agentId, sessionId);
    setSessionStreaming(agentId, sessionId, true);

    const result = abortSession(agentId, sessionId);
    expect(result).toBe(false);
  });

  it("emits status changes only when overall agent status changes", () => {
    const statusAgentId = "status-agent";
    const events: Array<{ agentId: string; status: "streaming" | "idle" }> = [];
    const unsubscribe = agentEventBus.onStatusChange((event) => events.push(event));

    const sessionA = `status-${Date.now()}-a`;
    const sessionB = `status-${Date.now()}-b`;

    setSessionStreaming(statusAgentId, sessionA, true);
    setSessionStreaming(statusAgentId, sessionB, true);
    setSessionStreaming(statusAgentId, sessionA, false);
    setSessionStreaming(statusAgentId, sessionB, false);

    unsubscribe();

    expect(events).toEqual([
      { agentId: statusAgentId, status: "streaming" },
      { agentId: statusAgentId, status: "idle" },
    ]);
  });
});
