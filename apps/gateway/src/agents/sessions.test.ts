import { describe, it, expect } from "vitest";
import {
  getOrCreateSession,
  setSessionStreaming,
  isStreaming,
  abortSession,
  getAgentStatuses,
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

  it("emits a per-session status change with the agent-wide aggregate", () => {
    const statusAgentId = "status-agent";
    const events: Array<{
      agentId: string;
      status: "streaming" | "idle";
      sessionId: string;
      sessionStatus: "streaming" | "idle";
    }> = [];
    const unsubscribe = agentEventBus.onStatusChange((event) => events.push(event));

    const sessionA = `status-${Date.now()}-a`;
    const sessionB = `status-${Date.now()}-b`;

    setSessionStreaming(statusAgentId, sessionA, true);
    setSessionStreaming(statusAgentId, sessionB, true);
    setSessionStreaming(statusAgentId, sessionA, false);
    setSessionStreaming(statusAgentId, sessionB, false);

    unsubscribe();

    // Each session transition emits its own event. sessionStatus is scoped to
    // the session that changed; status is the agent-wide aggregate (streaming
    // while any session is still streaming).
    expect(events).toEqual([
      {
        agentId: statusAgentId,
        status: "streaming",
        sessionId: sessionA,
        sessionStatus: "streaming",
      },
      {
        agentId: statusAgentId,
        status: "streaming",
        sessionId: sessionB,
        sessionStatus: "streaming",
      },
      {
        agentId: statusAgentId,
        status: "streaming",
        sessionId: sessionA,
        sessionStatus: "idle",
      },
      {
        agentId: statusAgentId,
        status: "idle",
        sessionId: sessionB,
        sessionStatus: "idle",
      },
    ]);
  });

  it("excludes background sessions from agent-wide streaming status", () => {
    const statusAgentId = "background-status-agent";
    const sessionId = `background-${Date.now()}`;
    const events: Array<{ status: "streaming" | "idle"; sessionStatus: "streaming" | "idle" }> = [];
    const unsubscribe = agentEventBus.onStatusChange((event) => events.push(event));

    setSessionStreaming(statusAgentId, sessionId, true, undefined, true);
    expect(getAgentStatuses([statusAgentId])).toEqual({
      [statusAgentId]: "idle",
    });
    setSessionStreaming(statusAgentId, sessionId, false);

    unsubscribe();

    expect(events).toEqual([
      { agentId: statusAgentId, status: "idle", sessionId, sessionStatus: "streaming" },
      { agentId: statusAgentId, status: "idle", sessionId, sessionStatus: "idle" },
    ]);
  });
});
