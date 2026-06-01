import crypto from "node:crypto";
import type { FSWatcher } from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { z } from "zod";
import type { Extension, ExtensionContext, ExtensionAgentTool } from "@aihub/shared";
import { OrchestratorExtensionConfigSchema } from "@aihub/shared";
import { LinearClient } from "./linear/client.js";
import { WorkflowLoader } from "./workflow/loader.js";
import { StateStore } from "./state/store.js";
import { ClaimsRegistry } from "./daemon/claims.js";
import { OrchestratorDaemon } from "./daemon/daemon.js";
import { exportLinear } from "./exporter/exporter.js";
import { runHook } from "./hooks/runner.js";
import { WorkspaceLayout } from "./workspace/layout.js";

let ctx: ExtensionContext | undefined;
let client: LinearClient | undefined;
let store: StateStore | undefined;
let daemon: OrchestratorDaemon | undefined;
let workflowWatch: FSWatcher | { close: () => void } | undefined;
const claims = new ClaimsRegistry();

function enabled(): boolean { return Boolean(process.env.LINEAR_API_KEY && client); }
function config(): z.infer<typeof OrchestratorExtensionConfigSchema> { return OrchestratorExtensionConfigSchema.parse(ctx?.getConfig().extensions?.orchestrator ?? {}); }
function workflowLoader() { const cfg = config(); const repos = Object.fromEntries(Object.entries(cfg.repos ?? {}).map(([name, value]) => [name, typeof value === "string" ? { name, path: value } : { name, ...value }])); return new WorkflowLoader(ctx!.getDataDir(), repos); }
function unavailable(c: any) { return c.json({ error: "orchestrator disabled: LINEAR_API_KEY missing" }, 503); }

function apiBase(): string {
  return (process.env.AIHUB_API_URL ?? process.env.AIHUB_URL ?? "http://127.0.0.1:4000/api").replace(/\/$/, "");
}

async function callSubagents(pathname: string, init?: RequestInit) {
  const response = await fetch(`${apiBase()}${pathname}`, init);
  if (!response.ok) throw new Error(await response.text());
  const contentType = response.headers.get("content-type") ?? "";
  return contentType.includes("application/json") ? response.json() : response.text();
}

async function startSubagent(body: Record<string, unknown>) {
  return callSubagents("/subagents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

async function getSubagentRun(runId: string) {
  return callSubagents(`/subagents/${encodeURIComponent(runId)}`);
}

function runSubagentId(id: string): string | undefined {
  const row = store?.getRun(id);
  const value = row?.subagent_run_id;
  return typeof value === "string" && value ? value : undefined;
}

async function runBeforeRemove(row: Record<string, unknown> | undefined) {
  if (!row || !store || !ctx) return;
  const workspace = typeof row.workspace === "string" ? row.workspace : undefined;
  const runId = typeof row.run_id === "string" ? row.run_id : undefined;
  if (!workspace || !runId) return;
  const repoName = typeof row.repo === "string" ? row.repo : undefined;
  const workflow = await workflowLoader().resolve({ repo: repoName });
  await runHook({
    command: workflow.frontmatter.hooks?.before_remove,
    phase: "before_remove",
    cwd: workspace,
    runId,
    store,
    env: {
      AIHUB_ISSUE_ID: typeof row.issue_id === "string" ? row.issue_id : undefined,
      AIHUB_ISSUE_IDENTIFIER: typeof row.identifier === "string" ? row.identifier : undefined,
      AIHUB_WORKSPACE: workspace,
      AIHUB_REPO: repoName,
      AIHUB_BRANCH: typeof row.branch === "string" ? row.branch : undefined,
      LINEAR_API_KEY: undefined,
    },
  }).catch((error) => store?.appendEvent(runId, "hook.before_remove.error", { error: error instanceof Error ? error.message : String(error) }));
}

export function verifyWebhookSignature(secret: string, body: string, signature: string | undefined): boolean {
  if (!signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
  const actual = signature.replace(/^sha256=/, "");
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(actual, "hex");
  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

export function isRelevantWebhook(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const record = payload as Record<string, unknown>;
  const action = String(record.action ?? "").toLowerCase();
  const type = String(record.type ?? "").toLowerCase();
  const data = record.data && typeof record.data === "object" ? record.data as Record<string, unknown> : record;
  const hasIssue = Boolean(data.issue || data.issueId || data.identifier || data.id);
  const isIssueEvent = type.includes("issue") || action.includes("issue");
  const stateChanged = isIssueEvent && (action.includes("update") || action.includes("state") || "state" in data);
  const commentAdded = type.includes("comment") || action.includes("comment") || "comment" in data;
  return hasIssue && (stateChanged || commentAdded);
}

function register(app: Hono) {
  app.get("/orchestrator/health", (c) => c.json({ status: enabled() ? "ok" : "disabled", lastTickAt: daemon?.lastTickAt, rateLimitRemaining: client?.rateLimitRemaining, activeClaims: claims.list().length }));
  app.use("/orchestrator/*", async (c, next) => {
    if (c.req.path.endsWith("/health")) return next();
    if (!enabled()) return unavailable(c);
    return next();
  });
  app.get("/orchestrator/workflow", async (c) => c.json(await workflowLoader().resolve({ repo: c.req.query("repo") })));
  app.get("/orchestrator/runs", (c) => {
    const issue = c.req.query("issue");
    const active = claims.list().filter((claim) => !issue || claim.issueId === issue);
    const recent = (store?.listRecent(Number(c.req.query("limit") ?? 50)) ?? []).filter((run: any) => !issue || run.issue_id === issue || run.issueId === issue);
    return c.json({ active, recent });
  });
  app.get("/orchestrator/runs/:id", (c) => {
    const id = c.req.param("id");
    const run = store?.getRun(id);
    const runId = typeof run?.run_id === "string" ? run.run_id : id;
    return c.json({ claim: claims.get(id), run, events: store?.listEvents(runId, Number(c.req.query("since") ?? 0)) ?? [] });
  });
  app.get("/orchestrator/runs/:id/logs", async (c) => {
    const subagentRunId = runSubagentId(c.req.param("id"));
    if (!subagentRunId) return c.json({ error: "subagent run not found" }, 404);
    const since = c.req.query("since") ?? "0";
    return c.json(await callSubagents(`/subagents/${encodeURIComponent(subagentRunId)}/logs?since=${encodeURIComponent(since)}`));
  });
  app.post("/orchestrator/runs/:issueId/release", (c) => { const id = c.req.param("issueId"); claims.release(id); store?.release(id); return c.json({ ok: true }); });
  app.post("/orchestrator/runs/:id/interrupt", async (c) => {
    const subagentRunId = runSubagentId(c.req.param("id"));
    if (!subagentRunId) return c.json({ error: "subagent run not found" }, 404);
    return c.json(await callSubagents(`/subagents/${encodeURIComponent(subagentRunId)}/interrupt`, { method: "POST" }));
  });
  app.post("/orchestrator/runs/:id/kill", async (c) => {
    const id = c.req.param("id");
    const row = store?.getRun(id);
    const subagentRunId = runSubagentId(id);
    if (subagentRunId) await callSubagents(`/subagents/${encodeURIComponent(subagentRunId)}`, { method: "DELETE" });
    await runBeforeRemove(row);
    const identifier = typeof row?.identifier === "string" ? row.identifier : undefined;
    if (identifier) {
      const repoName = typeof row?.repo === "string" ? row.repo : undefined;
      const repos = config().repos ?? {};
      const repoConfig = repoName && repos[repoName]
        ? typeof repos[repoName] === "string"
          ? { name: repoName, path: repos[repoName] }
          : { name: repoName, ...repos[repoName] }
        : null;
      await new WorkspaceLayout(config().workspacesRoot ?? path.join(ctx!.getDataDir(), "workspaces")).remove({ identifier, repo: repoConfig }).catch(() => undefined);
    }
    claims.release(String(row?.issue_id ?? id));
    store?.release(String(row?.issue_id ?? id));
    return c.json({ ok: true });
  });
  app.post("/orchestrator/issues/:issueId/claim", async (c) => {
    if (!daemon) return c.json({ error: "orchestrator daemon not started" }, 503);
    const result = await daemon.claimNow(c.req.param("issueId"));
    if (!result.ok) return c.json({ error: result.error }, result.status as 400 | 404 | 409 | 503);
    return c.json(result, 201);
  });
  app.post("/orchestrator/export", async (c) => { const cfg = config(); const teamKey = c.req.query("team") ?? cfg.teamKey; if (!teamKey) return c.json({ error: "teamKey required" }, 400); return c.json(await exportLinear({ client: client!, teamKey, outDir: c.req.query("out") ?? path.join(ctx!.getDataDir(), "exports", "linear") })); });
  app.post("/orchestrator/tick", async (c) => {
    if (!enabled()) return unavailable(c);
    if (!daemon) return c.json({ error: "orchestrator daemon not started" }, 503);
    return c.json({ ok: true, ...(await daemon.tick()) });
  });
  app.post("/orchestrator/webhook", async (c) => {
    const webhook = config().webhook;
    if (!webhook?.enabled) return c.json({ error: "not found" }, 404);
    if (!webhook.secret) return c.json({ error: "webhook secret required" }, 503);
    const body = await c.req.text();
    const signature = c.req.header("linear-signature") ?? c.req.header("x-linear-signature");
    if (!verifyWebhookSignature(webhook.secret, body, signature)) return c.json({ error: "invalid signature" }, 401);
    const payload = JSON.parse(body) as unknown;
    const relevant = isRelevantWebhook(payload);
    if (relevant) daemon?.enqueueTick();
    return c.json({ ok: true, queued: relevant });
  });
}

export const orchestratorExtension: Extension = {
  id: "orchestrator",
  displayName: "Orchestrator",
  description: "Linear-backed issue orchestrator",
  dependencies: ["subagents"],
  configSchema: OrchestratorExtensionConfigSchema,
  routePrefixes: ["/api/orchestrator"],
  validateConfig(raw) { const parsed = OrchestratorExtensionConfigSchema.safeParse(raw ?? {}); return { valid: parsed.success, errors: parsed.success ? [] : parsed.error.issues.map((i) => i.message) }; },
  registerRoutes: register,
  async start(context) {
    ctx = context;
    if (process.env.LINEAR_API_KEY) client = new LinearClient(process.env.LINEAR_API_KEY);
    store = new StateStore(path.join(context.getDataDir(), "orchestrator", "state.db"));
    store.bootstrap();
    store.markOrphaned();
    store.heartbeat();
    await workflowLoader().ensureDefault();
    workflowWatch = workflowLoader().watch((event) => context.emit("orchestrator.workflow.changed", event));
    if (client) {
      daemon = new OrchestratorDaemon({ ctx: context, client, store, claims, getConfig: config, startSubagent, getSubagentRun });
      try {
        await daemon.start();
      } catch (error) {
        daemon.notifyStartupError(error);
        throw error;
      }
    }
  },
  async stop() { daemon?.stop(); workflowWatch?.close(); store?.markActiveProcessStopped(); store?.close(); ctx = undefined; client = undefined; store = undefined; daemon = undefined; workflowWatch = undefined; },
  capabilities() { return ["orchestrator"]; },
  getAgentTools(): ExtensionAgentTool[] { if (!client || config().linear?.exposeGraphqlTool === false) return []; return [{ name: "orchestrator.linear_graphql", description: "Execute Linear GraphQL using daemon-held auth", parameters: { type: "object", properties: { query: { type: "string" }, variables: { type: "object" } }, required: ["query"] }, execute: async (args) => { const parsed = z.object({ query: z.string(), variables: z.record(z.unknown()).optional() }).parse(args); try { return await client!.graphql(parsed.query, parsed.variables); } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; } } }]; },
};

export { registerOrchestratorCommands } from "./cli/index.js";
export { LinearClient } from "./linear/client.js";
export { WorkflowLoader } from "./workflow/loader.js";
export { resolveRepo } from "./repo/resolver.js";
export { WorkspaceLayout, sanitizeIdentifier } from "./workspace/layout.js";
export { resolveProfile } from "./profile/resolver.js";
export { ConcurrencyLimiter } from "./concurrency/limiter.js";
export { ClaimsRegistry } from "./daemon/claims.js";
export { StateStore } from "./state/store.js";
export { RetryPolicy } from "./retry/policy.js";
export { OrchestratorDaemon } from "./daemon/daemon.js";
