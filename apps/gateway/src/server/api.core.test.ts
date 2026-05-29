import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";

const getAgent = vi.fn();
const getActiveAgents = vi.fn();
const isAgentActive = vi.fn();
const resolveWorkspaceDir = vi.fn((workspace: string) => workspace);
let loadConfigValue: Record<string, unknown> = {
  branding: undefined,
  agentFab: false,
  agents: [],
};

const runAgent = vi.fn();
const getAllSessionsForAgent = vi.fn();
const getAgentStatuses = vi.fn();
const getSessionHistory = vi.fn();
const getFullSessionHistory = vi.fn();
const compactAgentSession = vi.fn();

const resolveSessionId = vi.fn();
const getSessionEntry = vi.fn();
const isAbortTrigger = vi.fn();
const getSessionThinkLevel = vi.fn();
const multiUserState = vi.hoisted(() => ({
  loaded: false,
  authContext: null as null | {
    user: { id: string; name?: string; role?: string | string[] | null };
    session: { id: string; userId: string };
  },
}));

vi.mock("../config/index.js", () => ({
  CONFIG_DIR: "/tmp/aihub-test",
  getAgent,
  getActiveAgents,
  isAgentActive,
  resolveWorkspaceDir,
  loadConfig: () => loadConfigValue,
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

vi.mock("../agents/compact.js", () => ({
  compactAgentSession,
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
    loadConfigValue = {
      branding: undefined,
      agentFab: false,
      agents: [],
    };
    isAgentActive.mockReturnValue(true);
    isAbortTrigger.mockReturnValue(false);
    multiUserState.loaded = false;
    multiUserState.authContext = null;
    runAgent.mockResolvedValue({
      payloads: [],
      meta: { durationMs: 0, sessionId: "resolved-1" },
    });
    compactAgentSession.mockResolvedValue({
      sessionId: "resolved-1",
      summary: "Compacted summary",
      keptMessages: 8,
    });
    resolveSessionId.mockResolvedValue({
      sessionId: "resolved-1",
      message: "hello",
      isNew: true,
      createdAt: 1,
    });
  });

  it("returns an empty agent list without default resolution errors", async () => {
    const { api } = await import("./api.core.js");

    const response = await api.request(new Request("http://localhost/agents"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it("marks the configured default project manager on visible agents", async () => {
    const agents = [
      {
        id: "alpha",
        name: "Alpha",
        model: { provider: "anthropic", model: "claude" },
      },
      {
        id: "beta",
        name: "Beta",
        model: { provider: "anthropic", model: "claude" },
      },
    ];
    getActiveAgents.mockReturnValue(agents);
    loadConfigValue = {
      branding: undefined,
      agentFab: false,
      agents,
      defaultProjectManager: "beta",
    };
    const { api } = await import("./api.core.js");

    const response = await api.request(new Request("http://localhost/agents"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      expect.objectContaining({
        id: "alpha",
        isDefaultProjectManager: false,
      }),
      expect.objectContaining({
        id: "beta",
        isDefaultProjectManager: true,
      }),
    ]);
  });

  it("redacts model and workspace from non-admin multi-user agent lists", async () => {
    const agents = [
      {
        id: "alpha",
        name: "Alpha",
        model: { provider: "anthropic", model: "claude" },
        workspace: "/tmp/alpha",
      },
    ];
    getActiveAgents.mockReturnValue(agents);
    loadConfigValue = {
      branding: undefined,
      agentFab: false,
      agents,
    };
    multiUserState.loaded = true;
    multiUserState.authContext = {
      user: { id: "user-1", role: "user" },
      session: { id: "session-1", userId: "user-1" },
    };
    const { api } = await import("./api.core.js");

    const response = await api.request(new Request("http://localhost/agents"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      expect.not.objectContaining({
        model: expect.anything(),
        workspace: expect.anything(),
      }),
    ]);
  });

  it("keeps model and workspace for admin multi-user agent lists", async () => {
    const agents = [
      {
        id: "alpha",
        name: "Alpha",
        model: { provider: "anthropic", model: "claude" },
        workspace: "/tmp/alpha",
      },
    ];
    getActiveAgents.mockReturnValue(agents);
    loadConfigValue = {
      branding: undefined,
      agentFab: false,
      agents,
    };
    multiUserState.loaded = true;
    multiUserState.authContext = {
      user: { id: "admin-1", role: "admin" },
      session: { id: "session-1", userId: "admin-1" },
    };
    const { api } = await import("./api.core.js");

    const response = await api.request(new Request("http://localhost/agents"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      expect.objectContaining({
        model: { provider: "anthropic", model: "claude" },
        workspace: "/tmp/alpha",
      }),
    ]);
  });

  it("does not sort renamed sessions by file mtime", async () => {
    const sessionsDir = "/tmp/aihub-test/sessions";
    await fs.rm("/tmp/aihub-test", { recursive: true, force: true });
    await fs.mkdir(sessionsDir, { recursive: true });
    getActiveAgents.mockReturnValue([
      { id: "alpha", name: "Alpha", avatar: "🦊" },
    ]);
    getSessionEntry.mockResolvedValue(null);
    await fs.writeFile(
      path.join(sessionsDir, "2026-05-29T10-00-00-000Z_alpha-old.jsonl"),
      [
        JSON.stringify({
          type: "history",
          role: "user",
          content: [{ type: "text", text: "old" }],
          timestamp: 1000,
        }),
        JSON.stringify({
          type: "meta",
          key: "title",
          value: "renamed",
          timestamp: 3000,
        }),
      ].join("\n") + "\n"
    );
    await fs.writeFile(
      path.join(sessionsDir, "2026-05-29T10-01-00-000Z_alpha-new.jsonl"),
      JSON.stringify({
        type: "history",
        role: "user",
        content: [{ type: "text", text: "new" }],
        timestamp: 2000,
      }) + "\n"
    );
    const { api } = await import("./api.core.js");

    const response = await api.request(new Request("http://localhost/agents/sessions"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items.map((item: { sessionId: string }) => item.sessionId)).toEqual([
      "new",
      "old",
    ]);
    expect(body.items[1]).toMatchObject({ title: "renamed", avatar: "🦊" });
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

  it("compacts the resolved web session", async () => {
    getSessionEntry.mockResolvedValue({
      sessionId: "resolved-1",
      updatedAt: 1,
      createdAt: 1,
    });
    const { api } = await import("./api.core.js");

    const response = await api.request(
      new Request("http://localhost/agents/alpha/compact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionKey: "main" }),
      })
    );

    expect(response.status).toBe(200);
    expect(compactAgentSession).toHaveBeenCalledWith({
      agentId: "alpha",
      sessionKey: "main",
      sessionId: "resolved-1",
      userId: undefined,
      extensionRuntime: expect.any(Object),
      context: undefined,
    });
    expect(await response.json()).toEqual({
      sessionId: "resolved-1",
      summary: "Compacted summary",
      keptMessages: 8,
    });
  });
});
