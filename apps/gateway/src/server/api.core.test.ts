import { beforeEach, describe, expect, it, vi } from "vitest";

const getAgent = vi.fn();
const getActiveAgents = vi.fn();
const isAgentActive = vi.fn();
const resolveWorkspaceDir = vi.fn((workspace: string) => workspace);

const runAgent = vi.fn();
const getAllSessionsForAgent = vi.fn();
const getAgentStatuses = vi.fn();
const getSessionHistory = vi.fn();
const getFullSessionHistory = vi.fn();

const resolveSessionId = vi.fn();
const getSessionEntry = vi.fn();
const isAbortTrigger = vi.fn();
const getSessionThinkLevel = vi.fn();

vi.mock("../config/index.js", () => ({
  getAgent,
  getActiveAgents,
  isAgentActive,
  resolveWorkspaceDir,
}));

vi.mock("../components/registry.js", () => ({
  getLoadedComponents: () => [],
  isComponentLoaded: () => false,
}));

vi.mock("../agents/index.js", () => ({
  runAgent,
  getAllSessionsForAgent,
  getAgentStatuses,
  getSessionHistory,
  getFullSessionHistory,
}));

vi.mock("../sessions/index.js", () => ({
  resolveSessionId,
  getSessionEntry,
  isAbortTrigger,
  getSessionThinkLevel,
}));

vi.mock("../media/upload.js", () => ({
  saveUploadedFile: vi.fn(),
  isAllowedMimeType: vi.fn(() => true),
  getAllowedMimeTypes: vi.fn(() => []),
}));

describe("api core session resolution", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getAgent.mockImplementation((agentId: string) =>
      agentId === "alpha"
        ? {
            id: "alpha",
            name: "Alpha",
            model: { provider: "anthropic", model: "claude" },
          }
        : null
    );
    getActiveAgents.mockReturnValue([]);
    isAgentActive.mockReturnValue(true);
    isAbortTrigger.mockReturnValue(false);
    runAgent.mockResolvedValue({
      payloads: [],
      meta: { durationMs: 0, sessionId: "resolved-1" },
    });
    resolveSessionId.mockResolvedValue({
      sessionId: "resolved-1",
      message: "hello",
      isNew: true,
      createdAt: 1,
    });
  });

  it("passes a resolved session through to runAgent", async () => {
    const { api } = await import("./api.core.js");

    const response = await api.request(
      new Request("http://localhost/agents/alpha/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: "/new hello",
          sessionKey: "main",
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(resolveSessionId).toHaveBeenCalledTimes(1);
    expect(runAgent).toHaveBeenCalledWith({
      agentId: "alpha",
      userId: undefined,
      message: "/new hello",
      sessionId: undefined,
      sessionKey: undefined,
      resolvedSession: {
        sessionId: "resolved-1",
        sessionKey: "main",
        message: "hello",
        isNew: true,
      },
      thinkLevel: undefined,
    });
  });
});
