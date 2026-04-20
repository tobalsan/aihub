import crypto from "node:crypto";
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

function sign(
  payload: string,
  secret: string,
  encoding: "hex" | "base64" = "hex"
): string {
  return crypto.createHmac("sha256", secret).update(payload).digest(encoding);
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
    expect(captured?.trace).toMatchObject({
      enabled: true,
      name: "aihub:webhook:sales",
      surface: "webhook",
      metadata: {
        webhookName: "notion",
        agentId: "sales",
        sourceUrl: "http://localhost/hooks/sales/notion/secret",
        requestPayload: '{"ticket":123}',
      },
    });
    expect(captured?.message).toContain(
      "URL=http://localhost/hooks/sales/notion/secret"
    );
    expect(captured?.message).toContain(
      'HEADERS={"content-type":"application/json"}'
    );
    expect(captured?.message).toContain('BODY={"ticket":123}');
  });

  it("passes a disabled trace context when langfuse tracing is off", async () => {
    const agent = AgentConfigSchema.parse({
      id: "sales",
      name: "Sales",
      workspace: "/tmp",
      model: { model: "claude" },
      webhooks: {
        notion: {
          prompt: "hello",
          langfuseTracing: false,
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
        body: "{}",
      })
    );

    expect(response.status).toBe(200);
    await runPromise;
    expect(captured?.trace?.enabled).toBe(false);
  });

  it("rejects known webhook signatures that fail verification", async () => {
    const agent = AgentConfigSchema.parse({
      id: "sales",
      name: "Sales",
      workspace: "/tmp",
      model: { model: "claude" },
      webhooks: {
        github: {
          prompt: "hello",
          signingSecret: "secret",
        },
      },
    });
    let called = false;
    setWebhooksRuntime({
      ctx: createContext({
        agent,
        onRunAgent: async () => {
          called = true;
          return { payloads: [], meta: { durationMs: 0, sessionId: "s1" } };
        },
      }),
      secrets: { "sales:github": "secret-token" },
    });
    const app = createApp();

    const response = await app.fetch(
      new Request("http://localhost/hooks/sales/github/secret-token", {
        method: "POST",
        body: "{}",
        headers: { "x-hub-signature-256": "sha256=bad" },
      })
    );

    expect(response.status).toBe(401);
    expect(called).toBe(false);
  });

  it("accepts a known webhook with a valid signature", async () => {
    const payload = '{"action":"opened"}';
    const agent = AgentConfigSchema.parse({
      id: "sales",
      name: "Sales",
      workspace: "/tmp",
      model: { model: "claude" },
      webhooks: {
        github: {
          prompt: "BODY=$WEBHOOK_PAYLOAD",
          signingSecret: "secret",
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
      secrets: { "sales:github": "secret-token" },
    });
    const app = createApp();

    const response = await app.fetch(
      new Request("http://localhost/hooks/sales/github/secret-token", {
        method: "POST",
        body: payload,
        headers: {
          "x-hub-signature-256": `sha256=${sign(payload, "secret")}`,
        },
      })
    );

    expect(response.status).toBe(200);
    await runPromise;
    expect(captured?.message).toBe(`BODY=${payload}`);
  });

  it("returns Notion GET challenges without running the agent", async () => {
    const agent = AgentConfigSchema.parse({
      id: "sales",
      name: "Sales",
      workspace: "/tmp",
      model: { model: "claude" },
      webhooks: { notion: { prompt: "hello" } },
    });
    let called = false;
    setWebhooksRuntime({
      ctx: createContext({
        agent,
        onRunAgent: async () => {
          called = true;
          return { payloads: [], meta: { durationMs: 0, sessionId: "s1" } };
        },
      }),
      secrets: { "sales:notion": "secret" },
    });
    const app = createApp();

    const response = await app.fetch(
      new Request("http://localhost/hooks/sales/notion/secret?challenge=abc123")
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ challenge: "abc123" });
    expect(called).toBe(false);
  });

  it("returns Zendesk GET challenges as plain text", async () => {
    const agent = AgentConfigSchema.parse({
      id: "sales",
      name: "Sales",
      workspace: "/tmp",
      model: { model: "claude" },
      webhooks: { zendesk: { prompt: "hello" } },
    });
    let called = false;
    setWebhooksRuntime({
      ctx: createContext({
        agent,
        onRunAgent: async () => {
          called = true;
          return { payloads: [], meta: { durationMs: 0, sessionId: "s1" } };
        },
      }),
      secrets: { "sales:zendesk": "secret" },
    });
    const app = createApp();

    const response = await app.fetch(
      new Request(
        "http://localhost/hooks/sales/zendesk/secret?challenge=abc123"
      )
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("abc123");
    expect(called).toBe(false);
  });
});
