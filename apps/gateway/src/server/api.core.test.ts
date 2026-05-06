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
const multiUserState = vi.hoisted(() => ({
  loaded: false,
  authContext: null as null | {
    user: { id: string; name?: string };
    session: { id: string; userId: string };
  },
}));

vi.mock("../config/index.js", () => ({
  CONFIG_DIR: "/tmp/aihub-test",
  getAgent,
  getActiveAgents,
  isAgentActive,
  resolveWorkspaceDir,
}));

vi.mock("../extensions/registry.js", () => ({
  getLoadedExtensions: () => [],
  isExtensionLoaded: (extensionId: string) =>
    extensionId === "multiUser" && multiUserState.loaded,
  getExtensionRuntime: () => ({
    getCapabilities: () => ({
      extensions: {},
      capabilities: {},
      multiUser: multiUserState.loaded,
      home: undefined,
    }),
  }),
}));

vi.mock("@aihub/extension-multi-user", () => ({
  getForwardedAuthContext: vi.fn(() => multiUserState.authContext),
  getAgentFilter: vi.fn(() => (agents: unknown[]) => agents),
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
  resolveUploadMimeType: vi.fn((mimeType: string) => mimeType),
  getAllowedMimeTypes: vi.fn(() => []),
  MAX_UPLOAD_SIZE_BYTES: 25 * 1024 * 1024,
  UploadTooLargeError: class UploadTooLargeError extends Error {},
  UploadTypeError: class UploadTypeError extends Error {},
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
    multiUserState.loaded = false;
    multiUserState.authContext = null;
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
      context: undefined,
      extensionRuntime: expect.any(Object),
      source: "web",
    });
  });

  it("passes web user context to runAgent in multi-user mode", async () => {
    multiUserState.loaded = true;
    multiUserState.authContext = {
      user: { id: "user-1", name: "Thinh" },
      session: { id: "session-1", userId: "user-1" },
    };
    const { api } = await import("./api.core.js");

    const response = await api.request(
      new Request("http://localhost/agents/alpha/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: "hello",
          sessionKey: "main",
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        context: { kind: "web", name: "Thinh" },
        source: "web",
      })
    );
  });
});
