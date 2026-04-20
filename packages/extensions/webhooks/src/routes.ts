import crypto from "node:crypto";
import type { AgentConfig, ExtensionContext } from "@aihub/shared";
import type { Hono } from "hono";
import { interpolateWebhookPrompt, resolveWebhookPrompt } from "./prompt.js";
import { webhookSecretKey, type WebhookSecrets } from "./secrets.js";
import { verifyWebhookSignature } from "./verify.js";

type WebhooksRuntime = {
  ctx: ExtensionContext;
  secrets: WebhookSecrets;
};

let runtime: WebhooksRuntime | null = null;

export function setWebhooksRuntime(next: WebhooksRuntime): void {
  runtime = next;
}

export function clearWebhooksRuntime(): void {
  runtime = null;
}

function getRuntime(): WebhooksRuntime | null {
  return runtime;
}

function getRequestHeaders(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers.entries());
}

async function getRequestPayload(request: Request): Promise<string> {
  if (request.method === "GET") {
    const url = new URL(request.url);
    return url.searchParams.toString();
  }
  return request.text();
}

async function runWebhookAgent(params: {
  ctx: ExtensionContext;
  agent: AgentConfig;
  webhookName: string;
  prompt: string;
  originUrl: string;
  headers: Record<string, string>;
  payload: string;
  requestId: string;
  langfuseTracing: boolean;
  timestamp: string;
}): Promise<void> {
  try {
    const workspaceDir = params.ctx.resolveWorkspaceDir(params.agent);
    const prompt = await resolveWebhookPrompt(params.prompt, workspaceDir);
    const message = interpolateWebhookPrompt(prompt, {
      originUrl: params.originUrl,
      headers: params.headers,
      payload: params.payload,
    });

    await params.ctx.runAgent({
      agentId: params.agent.id,
      message,
      sessionKey: `webhook:${params.agent.id}:${params.webhookName}:${params.requestId}`,
      thinkLevel: params.agent.thinkLevel,
      source: "webhook",
      trace: {
        enabled: params.langfuseTracing,
        name: `aihub:webhook:${params.agent.id}`,
        surface: "webhook",
        metadata: {
          webhookName: params.webhookName,
          agentId: params.agent.id,
          sourceUrl: params.originUrl,
          timestamp: params.timestamp,
          requestHeaders: params.headers,
          requestPayload: params.payload,
        },
      },
    });
  } catch (err) {
    params.ctx.logger.error(
      `[webhooks] ${params.agent.id}/${params.webhookName} failed`,
      err
    );
  }
}

function getChallenge(request: Request): string | undefined {
  if (request.method !== "GET") return undefined;
  const url = new URL(request.url);
  if (!url.searchParams.has("challenge")) return undefined;
  return url.searchParams.get("challenge") ?? "";
}

export function registerWebhookRoutes(app: Hono): void {
  app.on(["GET", "POST"], "/hooks/:agentId/:name", (c) => {
    return c.json({ error: "Unauthorized" }, 401);
  });

  app.on(["GET", "POST"], "/hooks/:agentId/:name/:secret", async (c) => {
    const current = getRuntime();
    if (!current) {
      return c.json({ error: "Webhooks extension not started" }, 503);
    }

    const agentId = c.req.param("agentId");
    const webhookName = c.req.param("name");
    const providedSecret = c.req.param("secret");
    const agent = current.ctx.getAgent(agentId);
    const webhookConfig = agent?.webhooks?.[webhookName];

    if (!agent || !webhookConfig || !current.ctx.isAgentActive(agentId)) {
      return c.json({ error: "Webhook not found" }, 404);
    }

    const expectedSecret =
      current.secrets[webhookSecretKey(agentId, webhookName)];
    if (!expectedSecret || providedSecret !== expectedSecret) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const requestId = crypto.randomUUID();
    const headers = getRequestHeaders(c.req.raw.headers);
    const challenge = getChallenge(c.req.raw);
    const normalizedName = webhookName.toLowerCase();
    if (challenge !== undefined && normalizedName.includes("notion")) {
      return c.json({ challenge });
    }
    if (challenge !== undefined && normalizedName.includes("zendesk")) {
      return c.text(challenge);
    }

    const payload = await getRequestPayload(c.req.raw.clone());
    if (
      webhookConfig.signingSecret &&
      !verifyWebhookSignature({
        webhookName,
        headers: c.req.raw.headers,
        payload,
        signingSecret: webhookConfig.signingSecret,
      })
    ) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const originUrl = c.req.url;
    const timestamp = new Date().toISOString();

    void runWebhookAgent({
      ctx: current.ctx,
      agent,
      webhookName,
      prompt: webhookConfig.prompt,
      originUrl,
      headers,
      payload,
      requestId,
      langfuseTracing: webhookConfig.langfuseTracing,
      timestamp,
    });

    return c.json({ ok: true, requestId });
  });
}
