import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import type {
  AgentConfig,
  ExtensionContext,
  RunAgentParams,
  RunAgentResult,
} from "@aihub/shared";
import { AgentConfigSchema, GatewayConfigSchema } from "@aihub/shared";
import {
  clearWebhooksRuntime,
  registerWebhookRoutes,
  setWebhooksRuntime,
} from "./routes.js";

function createContext(params: {
  agent?: AgentConfig;
  onRunAgent?: (params: RunAgentParams) => Promise<RunAgentResult>;
}): ExtensionContext {
  return {
    getConfig: () =>
      GatewayConfigSchema.parse({
        agents: params.agent ? [params.agent] : [],
        extensions: {},
      }),
    getDataDir: () => "/tmp",
    getAgent: (id) => (params.agent?.id === id ? params.agent : undefined),
    getAgents: () => (params.agent ? [params.agent] : []),
    isAgentActive: (id) => params.agent?.id === id,
    isAgentStreaming: () => false,
    resolveWorkspaceDir: (agent) => agent.workspace,
    runAgent:
      params.onRunAgent ??
      (async () => ({
        payloads: [],
        meta: { durationMs: 0, sessionId: "session" },
      })),
    getSubagentTemplates: () => [],
    resolveSessionId: async () => undefined,
    getSessionEntry: async () => undefined,
    clearSessionEntry: async () => undefined,
    restoreSessionUpdatedAt: () => undefined,
    deleteSession: () => undefined,
    invalidateHistoryCache: async () => undefined,
    getSessionHistory: async () => [],
    subscribe: () => () => undefined,
    emit: () => undefined,
    logger: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  };
}

function createApp(): Hono {
  const app = new Hono();
  registerWebhookRoutes(app);
  return app;
}

async function getStatus(app: Hono, url: string): Promise<number> {
  return (await app.fetch(new Request(url))).status;
}

describe("webhook routes", () => {
  afterEach(() => {
    clearWebhooksRuntime();
  });

  it("returns 401 for missing or invalid secrets", async () => {
    const agent = AgentConfigSchema.parse({
      id: "sales",
      name: "Sales",
      workspace: "/tmp",
      model: { model: "claude" },
      webhooks: { notion: { prompt: "hello", langfuseTracing: true } },
    });
    setWebhooksRuntime({
      ctx: createContext({ agent }),
      secrets: { "sales:notion": "secret" },
    });
    const app = createApp();

    expect(await getStatus(app, "http://localhost/hooks/sales/notion")).toBe(
      401
    );
    expect(
      await getStatus(app, "http://localhost/hooks/sales/notion/wrong")
    ).toBe(401);
  });

  it("returns 404 for unknown agents or webhook names", async () => {
    const agent = AgentConfigSchema.parse({
      id: "sales",
      name: "Sales",
      workspace: "/tmp",
      model: { model: "claude" },
      webhooks: { notion: { prompt: "hello", langfuseTracing: true } },
    });
    setWebhooksRuntime({
      ctx: createContext({ agent }),
      secrets: { "sales:notion": "secret" },
    });
    const app = createApp();

    expect(
      await getStatus(app, "http://localhost/hooks/support/notion/secret")
    ).toBe(404);
    expect(
      await getStatus(app, "http://localhost/hooks/sales/github/secret")
    ).toBe(404);
  });

  it("accepts a valid webhook and runs the agent asynchronously", async () => {
    const agent = AgentConfigSchema.parse({
      id: "sales",
      name: "Sales",
      workspace: "/tmp",
      model: { model: "claude" },
      webhooks: {
        notion: {
          prompt:
            "URL=$WEBHOOK_ORIGIN_URL HEADERS=$WEBHOOK_HEADERS BODY=$WEBHOOK_PAYLOAD",
          langfuseTracing: true,
        },
      },
    });

    let captured: RunAgentParams | undefined;
    let resolveRun: () => void = () => undefined;
    const runPromise = new Promise<void>((resolve) => {
      resolveRun = resolve;
    });
    setWebhooksRuntime({
      ctx: createContext({
        agent,
        onRunAgent: async (params) => {
          captured = params;
          resolveRun();
          return { payloads: [], meta: { durationMs: 0, sessionId: "s1" } };
        },
      }),
      secrets: { "sales:notion": "secret" },
    });
    const app = createApp();

    const response = await app.fetch(
      new Request("http://localhost/hooks/sales/notion/secret", {
        method: "POST",
        body: '{"ticket":123}',
        headers: { "content-type": "application/json" },
      })
    );

    expect(response.status).toBe(200);
    await runPromise;
    expect(captured?.agentId).toBe("sales");
    expect(captured?.sessionKey).toMatch(
      /^webhook:sales:notion:[0-9a-f-]{36}$/
    );
    expect(captured?.source).toBe("webhook");
    expect(captured?.message).toContain(
      "URL=http://localhost/hooks/sales/notion/secret"
    );
    expect(captured?.message).toContain(
      'HEADERS={"content-type":"application/json"}'
    );
    expect(captured?.message).toContain('BODY={"ticket":123}');
  });
});
