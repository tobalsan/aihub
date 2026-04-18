import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayConfig } from "@aihub/shared";
import {
  registerContainerToken,
  removeContainerToken,
} from "../sdk/container/tokens.js";
import { createInternalTools } from "./internal-tools.js";
import type { SubagentToolHandlers } from "../subagents/tool_handlers.js";

const registeredTokens: string[] = [];

function registerToken(token: string, agentId = "agent-1"): void {
  registerContainerToken(token, agentId, "container-1");
  registeredTokens.push(token);
}

function createDeps() {
  const config = { agents: [], extensions: {} } as unknown as GatewayConfig;
  const subagents: SubagentToolHandlers = {
    spawn: vi.fn(),
    status: vi.fn().mockResolvedValue({
      ok: true,
      data: { slug: "worker-a", status: "running" },
    }),
    logs: vi.fn(),
    interrupt: vi.fn(),
    kill: vi.fn(),
  };
  const projects = {
    create: vi.fn(),
    update: vi.fn(),
    get: vi.fn().mockResolvedValue({
      ok: true,
      data: { id: "PRO-1", title: "Project One" },
    }),
    comment: vi.fn(),
  };
  const recordComment = vi.fn();

  return {
    app: createInternalTools({
      getConfig: () => config,
      subagents,
      projects,
      recordComment,
    }),
    subagents,
    projects,
    recordComment,
  };
}

function postTool(
  app: ReturnType<typeof createInternalTools>,
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
): Promise<Response> {
  return Promise.resolve(
    app.request("/tools", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Agent-Id": String(body.agentId),
        "X-Agent-Token": String(body.agentToken),
        ...headers,
      },
      body: JSON.stringify(body),
    })
  );
}

afterEach(() => {
  for (const token of registeredTokens.splice(0)) {
    removeContainerToken(token);
  }
  vi.clearAllMocks();
});

describe("internal tools", () => {
  it("accepts a valid container token", async () => {
    const { app, subagents } = createDeps();
    registerToken("token-1");

    const response = await postTool(app, {
      tool: "subagent.status",
      args: { projectId: "PRO-1", slug: "worker-a" },
      agentId: "agent-1",
      agentToken: "token-1",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      slug: "worker-a",
      status: "running",
    });
    expect(subagents.status).toHaveBeenCalledWith({
      projectId: "PRO-1",
      slug: "worker-a",
    });
  });

  it("rejects an invalid token", async () => {
    const { app, subagents } = createDeps();

    const response = await postTool(app, {
      tool: "subagent.status",
      args: { projectId: "PRO-1", slug: "worker-a" },
      agentId: "agent-1",
      agentToken: "missing",
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Invalid agent token" });
    expect(subagents.status).not.toHaveBeenCalled();
  });

  it("rejects a token registered to another agent", async () => {
    const { app, subagents } = createDeps();
    registerToken("token-2", "agent-2");

    const response = await postTool(app, {
      tool: "subagent.status",
      args: { projectId: "PRO-1", slug: "worker-a" },
      agentId: "agent-1",
      agentToken: "token-2",
    });

    expect(response.status).toBe(403);
    expect(subagents.status).not.toHaveBeenCalled();
  });

  it("dispatches project tools", async () => {
    const { app, projects } = createDeps();
    registerToken("token-3");

    const response = await postTool(app, {
      tool: "project.get",
      args: { projectId: "PRO-1" },
      agentId: "agent-1",
      agentToken: "token-3",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: "PRO-1",
      title: "Project One",
    });
    expect(projects.get).toHaveBeenCalledWith(
      { agents: [], extensions: {} },
      "PRO-1"
    );
  });

  it("returns 500 for tool execution errors", async () => {
    const { app, subagents } = createDeps();
    vi.mocked(subagents.status).mockResolvedValueOnce({
      ok: false,
      error: "Subagent not found: worker-a",
    });
    registerToken("token-4");

    const response = await postTool(app, {
      tool: "subagent.status",
      args: { projectId: "PRO-1", slug: "worker-a" },
      agentId: "agent-1",
      agentToken: "token-4",
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Subagent not found: worker-a",
    });
  });

  it("returns 400 for unknown tools", async () => {
    const { app } = createDeps();
    registerToken("token-5");

    const response = await postTool(app, {
      tool: "unknown.tool",
      args: {},
      agentId: "agent-1",
      agentToken: "token-5",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Unknown tool: unknown.tool",
    });
  });
});
