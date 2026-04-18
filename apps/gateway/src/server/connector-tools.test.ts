import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectorTool, GatewayConfig } from "@aihub/shared";
import {
  registerContainerToken,
  removeContainerToken,
} from "../sdk/container/tokens.js";
import { createConnectorTools } from "./connector-tools.js";

const registeredTokens: string[] = [];
const executeMock = vi.fn().mockResolvedValue({ ok: true, value: 42 });

const mockGetConnectorToolsForAgent = vi.hoisted(() =>
  vi.fn<(agent: unknown, config: unknown) => ConnectorTool[]>(() => [
    {
      name: "hiveage_list_invoices",
      description: "List invoices",
      parameters: {} as never,
      execute: executeMock,
    },
  ])
);

vi.mock("../connectors/index.js", () => ({
  getConnectorToolsForAgent: mockGetConnectorToolsForAgent,
}));

function registerToken(token: string, agentId = "agent-1"): void {
  registerContainerToken(token, agentId, "container-1");
  registeredTokens.push(token);
}

function createDeps() {
  const config = {
    agents: [
      {
        id: "agent-1",
        name: "Test Agent",
        workspace: "/workspace",
        model: { provider: "anthropic", model: "claude" },
        connectors: {
          hiveage: { enabled: true },
        },
      },
    ],
    connectors: {
      hiveage: { apiKey: "secret-key" },
    },
    extensions: {},
  } as unknown as GatewayConfig;

  const app = createConnectorTools({
    getConfig: () => config,
  });

  return { app, config };
}

function postTool(
  app: ReturnType<typeof createConnectorTools>,
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
): Promise<Response> {
  return Promise.resolve(
    app.request("/tools", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    })
  );
}

afterEach(() => {
  for (const token of registeredTokens) {
    removeContainerToken(token);
  }
  registeredTokens.length = 0;
  executeMock.mockClear();
  mockGetConnectorToolsForAgent.mockClear();
});

describe("POST /connectors/tools", () => {
  it("executes a connector tool and returns the result", async () => {
    const { app } = createDeps();
    const token = "tok-123";
    registerToken(token);

    const res = await postTool(app, {
      connectorId: "hiveage",
      tool: "hiveage_list_invoices",
      args: { page: 1 },
      agentId: "agent-1",
      agentToken: token,
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, value: 42 });
    expect(executeMock).toHaveBeenCalledWith({ page: 1 });
  });

  it("rejects invalid agent token", async () => {
    const { app } = createDeps();

    const res = await postTool(app, {
      connectorId: "hiveage",
      tool: "hiveage_list_invoices",
      args: {},
      agentId: "agent-1",
      agentToken: "bad-token",
    });

    expect(res.status).toBe(403);
  });

  it("returns 400 for unknown connector tool", async () => {
    const { app } = createDeps();
    const token = "tok-456";
    registerToken(token);

    const res = await postTool(app, {
      connectorId: "hiveage",
      tool: "hiveage_nonexistent",
      args: {},
      agentId: "agent-1",
      agentToken: token,
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Unknown connector tool");
  });

  it("returns 404 for unknown agent", async () => {
    const { app } = createDeps();
    const token = "tok-789";
    registerToken(token, "unknown-agent");

    const res = await postTool(app, {
      connectorId: "hiveage",
      tool: "hiveage_list_invoices",
      args: {},
      agentId: "unknown-agent",
      agentToken: token,
    });

    expect(res.status).toBe(404);
  });

  it("returns 500 when tool execution fails", async () => {
    executeMock.mockRejectedValueOnce(new Error("API down"));
    const { app } = createDeps();
    const token = "tok-err";
    registerToken(token);

    const res = await postTool(app, {
      connectorId: "hiveage",
      tool: "hiveage_list_invoices",
      args: {},
      agentId: "agent-1",
      agentToken: token,
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("API down");
  });
});
