import crypto from "node:crypto";
import path from "node:path";
import { Hono } from "hono";
import { z } from "zod";
import type { Extension, ExtensionContext, ExtensionAgentTool } from "@aihub/shared";
import { OrchestratorExtensionConfigSchema } from "@aihub/shared";
import { interruptSubagentRun } from "@aihub/extension-subagents";
import { LinearClient } from "./linear/client.js";
import { WorkflowLoader } from "./workflow/loader.js";
import { StateStore } from "./state/store.js";
import { ClaimsRegistry } from "./daemon/claims.js";
import { OrchestratorDaemon } from "./daemon/daemon.js";
import { exportLinear } from "./exporter/exporter.js";
import { runHook } from "./hooks/runner.js";
import { WorkspaceLayout } from "./workspace/layout.js";
import { resolveProjects } from "./projects/registry.js";

let ctx: ExtensionContext | undefined;
let store: StateStore | undefined;
let daemon: OrchestratorDaemon | undefined;
let sharedWorkflowLoader: WorkflowLoader | undefined;
const claims = new ClaimsRegistry();

function enabled(): boolean { return Boolean(daemon); }
function config(): z.infer<typeof OrchestratorExtensionConfigSchema> { return OrchestratorExtensionConfigSchema.parse(ctx?.getConfig().extensions?.orchestrator ?? {}); }
function workflowLoader() { return sharedWorkflowLoader ??= new WorkflowLoader(ctx!.getDataDir()); }
function unavailable(c: any) { return c.json({ error: "orchestrator disabled" }, 503); }

function apiBase(): string {
  const envUrl = process.env.AIHUB_API_URL ?? process.env.AIHUB_URL;
  if (envUrl) {
    const trimmed = envUrl.replace(/\/$/, "").replace(/\/aihub$/, "");
    return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
  }
  const gateway = ctx?.getConfig().gateway;
  const host = gateway?.host ?? "127.0.0.1";
  const port = gateway?.port ?? 4000;
  return `http://${host}:${port}/api`;
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

async function getSubagentRun(runId: string) { return callSubagents(`/subagents/${encodeURIComponent(runId)}`); }
async function stopSubagent(runId: string) { return callSubagents(`/subagents/${encodeURIComponent(runId)}`, { method: "DELETE" }); }
async function stopSubagentDirect(runId: string) {
  if (!ctx) throw new Error("orchestrator context missing");
  return interruptSubagentRun({ dataDir: ctx.getDataDir(), emit: (event) => ctx?.emit("subagent.changed", event) }, runId);
}

const REDACTED = "[redacted]";

function redactWorkflowSnapshot<T extends Record<string, any>>(snapshot: T): T {
  return {
    ...snapshot,
    frontmatter: {
      ...snapshot.frontmatter,
      tracker: { ...snapshot.frontmatter?.tracker, api_key: REDACTED },
    },
    config: {
      ...snapshot.config,
      tracker: { ...snapshot.config?.tracker, apiKey: REDACTED },
    },
  };
}

function runSubagentId(id: string, projectId?: string): string | undefined {
  const row = store?.getRun(id, projectId);
  const value = row?.subagent_run_id;
  return typeof value === "string" && value ? value : undefined;
}

async function runBeforeRemove(row: Record<string, unknown> | undefined) {
  if (!row || !store || !ctx) return;
  const workspace = typeof row.workspace === "string" ? row.workspace : undefined;
  const runId = typeof row.run_id === "string" ? row.run_id : undefined;
  const projectPath = typeof row.workflow_path === "string" ? path.dirname(row.workflow_path) : undefined;
  if (!workspace || !runId || !projectPath) return;
  const workflow = await workflowLoader().resolve({ projectPath, allowStale: true });
  await runHook({
    command: workflow.config.hooks?.before_remove,
    phase: "before_remove",
    cwd: workspace,
    runId,
    store,
    env: {
      AIHUB_PROJECT_ID: typeof row.project_id === "string" ? row.project_id : undefined,
      AIHUB_ISSUE_ID: typeof row.issue_id === "string" ? row.issue_id : undefined,
      AIHUB_ISSUE_IDENTIFIER: typeof row.identifier === "string" ? row.identifier : undefined,
      AIHUB_WORKSPACE: workspace,
      LINEAR_API_KEY: undefined,
    },
  }).catch((error) => store?.appendEvent(runId, "hook.before_remove.error", { error: error instanceof Error ? error.message : String(error) }, typeof row.project_id === "string" ? row.project_id : undefined));
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
  const data = record.data && typeof record.data === "object" ? dataSafe(record.data) : record;
  const hasIssue = Boolean(data.issue || data.issueId || data.identifier || data.id);
  const isIssueEvent = type.includes("issue") || action.includes("issue");
  const stateChanged = isIssueEvent && (action.includes("update") || action.includes("state") || "state" in data);
  const commentAdded = type.includes("comment") || action.includes("comment") || "comment" in data;
  return hasIssue && (stateChanged || commentAdded);
}
function dataSafe(value: object): Record<string, unknown> { return value as Record<string, unknown>; }

async function projectDescriptors() {
  if (!ctx) return [];
  return resolveProjects({ paths: config().projects, dataDir: ctx.getDataDir() });
}

function register(app: Hono) {
  app.get("/orchestrator/health", (c) => c.json({ status: enabled() ? "ok" : "disabled", lastTickAt: daemon?.lastTickAt, activeClaims: claims.list().length, rateLimitRemaining: daemon?.rateLimitRemaining }));
  app.use("/orchestrator/*", async (c, next) => {
    if (c.req.path.endsWith("/health")) return next();
    if (!enabled()) return unavailable(c);
    return next();
  });
  app.get("/orchestrator/projects", async (c) => c.json({ items: await projectDescriptors() }));
  app.get("/orchestrator/workflow", async (c) => {
    const projectId = c.req.query("project");
    const project = (await projectDescriptors()).find((item) => !projectId || item.id === projectId || item.path === projectId);
    if (!project) return c.json({ error: "project not found" }, 404);
    return c.json(redactWorkflowSnapshot(await workflowLoader().resolve({ projectPath: project.path, allowStale: true })));
  });
  app.get("/orchestrator/runs", (c) => {
    const issue = c.req.query("issue");
    const project = c.req.query("project");
    const active = claims.list({ projectId: project }).filter((claim) => !issue || claim.issueId === issue);
    const recent = (store?.listRecent(Number(c.req.query("limit") ?? 50), project) ?? []).filter((run: any) => !issue || run.issue_id === issue || run.issueId === issue);
    return c.json({ active, recent });
  });
  app.get("/orchestrator/runs/:id", (c) => {
    const id = c.req.param("id");
    const project = c.req.query("project");
    const run = store?.getRun(id, project);
    const runId = typeof run?.run_id === "string" ? run.run_id : id;
    return c.json({ claim: claims.get(id, project), run, events: store?.listEvents(runId, Number(c.req.query("since") ?? 0)) ?? [] });
  });
  app.get("/orchestrator/runs/:id/logs", async (c) => {
    const subagentRunId = runSubagentId(c.req.param("id"), c.req.query("project"));
    if (!subagentRunId) return c.json({ error: "subagent run not found" }, 404);
    const since = c.req.query("since") ?? "0";
    return c.json(await callSubagents(`/subagents/${encodeURIComponent(subagentRunId)}/logs?since=${encodeURIComponent(since)}`));
  });
  app.post("/orchestrator/runs/:issueId/release", (c) => { const id = c.req.param("issueId"); const project = c.req.query("project"); claims.release(id, project); store?.release(id, project); return c.json({ ok: true }); });
  app.post("/orchestrator/runs/:id/interrupt", async (c) => {
    const subagentRunId = runSubagentId(c.req.param("id"), c.req.query("project"));
    if (!subagentRunId) return c.json({ error: "subagent run not found" }, 404);
    return c.json(await callSubagents(`/subagents/${encodeURIComponent(subagentRunId)}/interrupt`, { method: "POST" }));
  });
  app.post("/orchestrator/runs/:id/kill", async (c) => {
    const id = c.req.param("id");
    const project = c.req.query("project");
    const row = store?.getRun(id, project);
    const subagentRunId = runSubagentId(id, project);
    if (subagentRunId) await stopSubagent(subagentRunId).catch(() => undefined);
    await runBeforeRemove(row);
    const identifier = typeof row?.identifier === "string" ? row.identifier : undefined;
    const workflowPath = typeof row?.workflow_path === "string" ? row.workflow_path : undefined;
    if (identifier && workflowPath) {
      const workflow = await workflowLoader().resolve({ projectPath: path.dirname(workflowPath), allowStale: true });
      await new WorkspaceLayout(workflow.config.workspace.root).remove({ identifier }).catch(() => undefined);
    }
    claims.release(String(row?.issue_id ?? id), typeof row?.project_id === "string" ? row.project_id : project);
    store?.release(String(row?.issue_id ?? id), typeof row?.project_id === "string" ? row.project_id : project);
    return c.json({ ok: true });
  });
  app.post("/orchestrator/issues/:issueId/claim", async (c) => {
    if (!daemon) return c.json({ error: "orchestrator daemon not started" }, 503);
    const result = await daemon.claimNow(c.req.param("issueId"), c.req.query("project"));
    if (!result.ok) return c.json({ error: result.error }, result.status as 400 | 404 | 409 | 503);
    return c.json(result, 201);
  });
  app.post("/orchestrator/export", async (c) => {
    const projectId = c.req.query("project");
    const project = (await projectDescriptors()).find((item) => !projectId || item.id === projectId || item.path === projectId);
    if (!project) return c.json({ error: "project not found" }, 404);
    const workflow = await workflowLoader().resolve({ projectPath: project.path, allowStale: true });
    const client = new LinearClient(workflow.config.tracker.apiKey, workflow.config.tracker.endpoint);
    return c.json(await exportLinear({ client, projectSlug: workflow.config.tracker.projectSlug, outDir: c.req.query("out") ?? path.join(ctx!.getDataDir(), "exports", "linear", project.id) }));
  });
  app.post("/orchestrator/tick", async (c) => {
    if (!enabled()) return unavailable(c);
    if (!daemon) return c.json({ error: "orchestrator daemon not started" }, 503);
    return c.json({ ok: true, ...(await daemon.tick(c.req.query("project"))) });
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
    sharedWorkflowLoader = new WorkflowLoader(context.getDataDir());
    store = new StateStore(path.join(context.getDataDir(), "orchestrator", "state.db"));
    store.bootstrap();
    store.heartbeat();
    daemon = new OrchestratorDaemon({ ctx: context, store, claims, getConfig: config, startSubagent, getSubagentRun, stopSubagent: stopSubagentDirect, workflowLoader: sharedWorkflowLoader, createLinearClient: ({ apiKey, endpoint }) => new LinearClient(apiKey, endpoint) });
    try { await daemon.start(); } catch (error) { daemon.notifyStartupError(error); throw error; }
  },
  async stop() { await daemon?.stop(); store?.close(); ctx = undefined; store = undefined; daemon = undefined; sharedWorkflowLoader = undefined; },
  capabilities() { return ["orchestrator"]; },
  getAgentTools(): ExtensionAgentTool[] { if (config().linear?.exposeGraphqlTool === false) return []; return [{ name: "orchestrator.linear_graphql", description: "Execute Linear GraphQL using workflow auth. Project is required so calls use the owning project endpoint/api_key.", parameters: { type: "object", properties: { project: { type: "string" }, query: { type: "string" }, variables: { type: "object" } }, required: ["project", "query"] }, execute: async (args) => { try { const parsed = z.object({ project: z.string(), query: z.string(), variables: z.record(z.unknown()).optional() }).parse(args); const project = (await projectDescriptors()).find((item) => item.id === parsed.project || item.path === parsed.project); if (!project) return { error: "project not found" }; const workflow = await workflowLoader().resolve({ projectPath: project.path, allowStale: true }); return await new LinearClient(workflow.config.tracker.apiKey, workflow.config.tracker.endpoint).graphql(parsed.query, parsed.variables); } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; } } }]; },
};

export { registerOrchestratorCommands } from "./cli/index.js";
export { LinearClient } from "./linear/client.js";
export { WorkflowLoader } from "./workflow/loader.js";
export { resolveProjects, InvalidProjectsError } from "./projects/registry.js";
export { WorkspaceLayout, sanitizeIdentifier } from "./workspace/layout.js";
export { resolveProfile } from "./profile/resolver.js";
export { ConcurrencyLimiter } from "./concurrency/limiter.js";
export { ClaimsRegistry } from "./daemon/claims.js";
export { StateStore } from "./state/store.js";
export { RetryPolicy } from "./retry/policy.js";
export { OrchestratorDaemon } from "./daemon/daemon.js";
