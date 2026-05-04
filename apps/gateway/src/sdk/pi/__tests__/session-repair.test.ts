import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { repairOrphanedToolCalls } from "../session-repair.js";

type ToolResultMessage = AgentMessage & {
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
};

function makeSession(messages: AgentMessage[]) {
  const state = { messages };
  return {
    agent: {
      state,
    },
  };
}

describe("repairOrphanedToolCalls", () => {
  it("no-ops on empty session", () => {
    const session = makeSession([]);
    repairOrphanedToolCalls(session);
    expect(session.agent.state.messages).toHaveLength(0);
  });

  it("no-ops when session has only user messages", () => {
    const session = makeSession([
      {
        role: "user",
        content: [{ type: "text", text: "hello" }],
      } as AgentMessage,
    ]);
    repairOrphanedToolCalls(session);
    expect(session.agent.state.messages).toHaveLength(1);
  });

  it("no-ops when last assistant has stopReason endTurn", () => {
    const session = makeSession([
      { role: "user", content: [{ type: "text", text: "hi" }] } as AgentMessage,
      {
        role: "assistant",
        stopReason: "endTurn",
        content: [{ type: "text", text: "Hello!" }],
      } as unknown as AgentMessage,
    ]);
    repairOrphanedToolCalls(session);
    expect(session.agent.state.messages).toHaveLength(2);
  });

  it("no-ops when toolResult already present after toolUse", () => {
    const session = makeSession([
      {
        role: "assistant",
        stopReason: "toolUse",
        content: [{ type: "toolCall", id: "tc1", name: "bash" }],
      } as AgentMessage,
      {
        role: "toolResult",
        toolCallId: "tc1",
        content: [{ type: "text", text: "output" }],
      } as AgentMessage,
    ]);
    repairOrphanedToolCalls(session);
    expect(session.agent.state.messages).toHaveLength(2);
  });

  it("repairs single orphaned tool call", () => {
    const session = makeSession([
      {
        role: "user",
        content: [{ type: "text", text: "run it" }],
      } as AgentMessage,
      {
        role: "assistant",
        stopReason: "toolUse",
        content: [{ type: "toolCall", id: "tc_abc", name: "bash" }],
      } as AgentMessage,
    ]);
    repairOrphanedToolCalls(session);

    const result = session.agent.state.messages;
    expect(result).toHaveLength(3);
    expect(result[2].role).toBe("toolResult");
    expect((result[2] as ToolResultMessage).toolCallId).toBe("tc_abc");
    expect((result[2] as ToolResultMessage).toolName).toBe("bash");
    expect((result[2] as ToolResultMessage).isError).toBe(true);
  });

  it("repairs multiple orphaned tool calls", () => {
    const session = makeSession([
      {
        role: "assistant",
        stopReason: "toolUse",
        content: [
          { type: "toolCall", id: "tc1", name: "bash" },
          { type: "toolCall", id: "tc2", name: "read" },
        ],
      } as AgentMessage,
    ]);
    repairOrphanedToolCalls(session);

    const result = session.agent.state.messages;
    expect(result).toHaveLength(3);
    expect(result[1].role).toBe("toolResult");
    expect((result[1] as ToolResultMessage).toolCallId).toBe("tc1");
    expect(result[2].role).toBe("toolResult");
    expect((result[2] as ToolResultMessage).toolCallId).toBe("tc2");
    expect((result[1] as ToolResultMessage).isError).toBe(true);
    expect((result[2] as ToolResultMessage).isError).toBe(true);
  });

  it("no-ops when toolUse has no toolCall blocks", () => {
    const session = makeSession([
      {
        role: "assistant",
        stopReason: "toolUse",
        content: [{ type: "text", text: "thinking..." }],
      } as AgentMessage,
    ]);
    repairOrphanedToolCalls(session);
    expect(session.agent.state.messages).toHaveLength(1);
  });
});
