import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { ClaimsRegistry, CliWorkerRunner, ConcurrencyLimiter, LinearClient, OrchestratorDaemon, RetryPolicy, WorkflowLoader, isRelevantWebhook, orchestratorExtension, resolveProfile, resolveProjects, sanitizeIdentifier, StateStore, verifyWebhookSignature, WorkspaceLayout } from "./index.js";

const profiles = [{ name: "default", cli: "codex" as const }, { name: "claude", cli: "claude" as const }];

async function writeWorkflow(root: string, extra = ""): Promise<void> {
  await fs.writeFile(path.join(root, "WORKFLOW.md"), `---
tracker:
  kind: linear
  api_key: test-key
  project_slug: proj-a
  active_states: [Ready]
  terminal_states: [Done]
agent:
  profile: default
  max_concurrent: 1
workspace:
  root: ./workspaces
${extra}---
Do {{issue.identifier}}
`);
}

async function writeCustomWorkflow(root: string, input: { apiKey?: string; endpoint?: string; projectSlug: string; intervalMs?: number }): Promise<void> {
  await fs.writeFile(path.join(root, "WORKFLOW.md"), `---
tracker:
  kind: linear
  api_key: ${input.apiKey ?? "test-key"}
  endpoint: ${input.endpoint ?? "https://api.linear.app/graphql"}
  project_slug: ${input.projectSlug}
  active_states: [Ready]
  terminal_states: [Done]
polling:
  interval_ms: ${input.intervalMs ?? 30000}
  jitter_ms: 0
agent:
  profile: default
  max_concurrent: 1
workspace:
  root: ./workspaces
---
Do {{issue.identifier}}
`);
}

describe("orchestrator pure modules", () => {
  it("limits concurrency and issue exclusivity", () => {
    const limiter = new ConcurrencyLimiter(1);
    const first = limiter.tryReserve({ issueId: "A" });
    expect(first.ok).toBe(true);
    expect(limiter.tryReserve({ issueId: "A" })).toEqual({ ok: false, reason: "issue-busy" });
    expect(limiter.tryReserve({ issueId: "B" })).toEqual({ ok: false, reason: "cap" });
    if (first.ok) first.release();
    expect(limiter.tryReserve({ issueId: "B" }).ok).toBe(true);
  });

  it("sanitizes identifiers", () => {
    expect(sanitizeIdentifier("ENG-123? Bad!")).toBe("eng-123bad");
  });

  it("resolves profiles or parks", () => {
    expect(resolveProfile({ workflow: { agent: { profile: "default" } }, profilesConfig: profiles })).toMatchObject({ profile: { name: "default" } });
    expect(resolveProfile({ workflow: { agent: { profile: "missing" } }, profilesConfig: profiles })).toHaveProperty("park");
  });

  it("backs off independently", () => {
    let now = 0;
    const retry = new RetryPolicy(() => now);
    expect(retry.register("A", "dispatch").nextAttempt).toBe(30_000);
    now = 30_000;
    expect(retry.register("A", "dispatch").nextAttempt).toBe(90_000);
    expect(retry.nextAttempt("A", "tool_call")).toBeUndefined();
    retry.reset("A", "dispatch");
    expect(retry.nextAttempt("A", "dispatch")).toBeUndefined();
  });

  it("verifies and filters Linear webhook payloads", () => {
    const body = JSON.stringify({ type: "Issue", action: "update", data: { id: "lin_1", state: { name: "Done" } } });
    const signature = crypto.createHmac("sha256", "secret").update(body).digest("hex");
    expect(verifyWebhookSignature("secret", body, signature)).toBe(true);
    expect(verifyWebhookSignature("secret", body, "bad")).toBe(false);
    expect(isRelevantWebhook(JSON.parse(body))).toBe(true);
    expect(isRelevantWebhook({ type: "User", action: "update", data: { id: "u1" } })).toBe(false);
  });
});

describe("project workflow modules", () => {
  it("resolves configured projects and requires uppercase WORKFLOW.md", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "aih-orch-projects-"));
    const project = path.join(home, "project-a");
    await fs.mkdir(project);
    await writeWorkflow(project);
    await expect(resolveProjects({ paths: ["project-a"], dataDir: home })).resolves.toEqual([{ id: "project-a", path: project, workflowPath: path.join(project, "WORKFLOW.md") }]);
    await fs.mkdir(path.join(home, "bad"));
    await expect(resolveProjects({ paths: ["bad"], dataDir: home })).rejects.toThrow("missing WORKFLOW.md");
  });

  it("disambiguates duplicate project basenames", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "aih-orch-project-collision-"));
    const left = path.join(home, "left", "app");
    const right = path.join(home, "right", "app");
    await fs.mkdir(left, { recursive: true });
    await fs.mkdir(right, { recursive: true });
    await writeWorkflow(left);
    await writeCustomWorkflow(right, { projectSlug: "proj-b" });
    const projects = await resolveProjects({ paths: [left, right], dataDir: home });
    expect(projects[0]?.id).toMatch(/^app-[a-f0-9]{8}$/);
    expect(projects[1]?.id).toMatch(/^app-[a-f0-9]{8}$/);
    expect(projects[0]?.id).not.toBe(projects[1]?.id);
  });

  it("loads self-contained workflow and resolves workspace relative to project", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aih-orch-workflow-"));
    await writeWorkflow(root);
    const snapshot = await new WorkflowLoader(root).resolve({ projectPath: root, issue: { id: "1", identifier: "ENG-1", title: "Hello", state: "Ready", labels: [] } });
    expect(snapshot.config.tracker.projectSlug).toBe("proj-a");
    expect(snapshot.config.workspace.root).toBe(path.join(root, "workspaces"));
    expect(snapshot.body.trim()).toBe("Do ENG-1");
  });

  it("validates orchestrator-owned runner config", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aih-orch-runner-config-"));
    await fs.writeFile(path.join(root, "WORKFLOW.md"), `---
tracker:
  kind: linear
  api_key: test-key
  project_slug: proj-a
agent:
  profile: default
  runner: fake
  model: gpt-test
  max_turns: 4
  turn_timeout_ms: 1000
  stall_timeout_ms: 2000
  max_concurrent: 1
---
Run
`);
    const snapshot = await new WorkflowLoader(root).resolve({ projectPath: root });
    expect(snapshot.config.agent).toMatchObject({ runner: "fake", model: "gpt-test", max_turns: 4, turn_timeout_ms: 1000, stall_timeout_ms: 2000 });

    await fs.writeFile(path.join(root, "WORKFLOW.md"), "---\ntracker:\n  kind: linear\n  api_key: test\n  project_slug: proj-a\nagent:\n  profile: default\n  runner: cli\n---\nRun\n");
    await expect(new WorkflowLoader(root).resolve({ projectPath: root })).rejects.toThrow("agent.command must provide an executable when agent.runner is cli");

    await fs.writeFile(path.join(root, "WORKFLOW.md"), "---\ntracker:\n  kind: linear\n  api_key: test\n  project_slug: proj-a\nagent:\n  profile: default\n  runner: cli\n  command: []\n---\nRun\n");
    await expect(new WorkflowLoader(root).resolve({ projectPath: root })).rejects.toThrow("agent.command must provide an executable when agent.runner is cli");

    await fs.writeFile(path.join(root, "WORKFLOW.md"), "---\ntracker:\n  kind: linear\n  api_key: test\n  project_slug: proj-a\nagent:\n  profile: default\n  runner: cli\n  command: [\" node \", \"-v\"]\n---\nRun\n");
    await expect(new WorkflowLoader(root).resolve({ projectPath: root })).resolves.toMatchObject({ config: { agent: { command: ["node", "-v"] } } });

    await fs.writeFile(path.join(root, "WORKFLOW.md"), "---\ntracker:\n  kind: linear\n  api_key: test\n  project_slug: proj-a\nagent:\n  profile: default\n  runner: fake\n  max_turns: 0\n---\nRun\n");
    await expect(new WorkflowLoader(root).resolve({ projectPath: root })).rejects.toThrow("agent.max_turns must be a positive number");
  });

  it("renders only Symphony issue and attempt variables strictly", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aih-orch-template-"));
    await fs.writeFile(path.join(root, "WORKFLOW.md"), "---\ntracker:\n  kind: linear\n  api_key: test\n  project_slug: proj-a\nagent:\n  profile: default\n---\n{{issue.identifier}} {{attempt}} {{issue.labels}}\n");
    const issue = { id: "1", identifier: "ENG-1", title: "Hello", state: "Ready", labels: ["bug", "p1"] };
    const loader = new WorkflowLoader(root);

    await expect(loader.resolve({ projectPath: root, issue })).resolves.toMatchObject({ body: 'ENG-1  ["bug","p1"]\n' });
    await expect(loader.resolve({ projectPath: root, issue, attempt: 2 })).resolves.toMatchObject({ body: 'ENG-1 2 ["bug","p1"]\n' });

    await fs.writeFile(path.join(root, "WORKFLOW.md"), "---\ntracker:\n  kind: linear\n  api_key: test\n  project_slug: proj-a\n---\n{{project.id}}\n");
    await expect(loader.resolve({ projectPath: root, issue })).rejects.toThrow("Unknown workflow template variable: project.id");
    await fs.writeFile(path.join(root, "WORKFLOW.md"), "---\ntracker:\n  kind: linear\n  api_key: test\n  project_slug: proj-a\n---\n{{issue.identifier | upper}}\n");
    await expect(loader.resolve({ projectPath: root, issue })).rejects.toThrow("Unknown workflow template filter: upper");
  });

  it("keeps last known good workflow when reload is invalid", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aih-orch-lkg-"));
    await writeWorkflow(root);
    const loader = new WorkflowLoader(root);
    const first = await loader.resolve({ projectPath: root });
    expect(first.config.tracker.projectSlug).toBe("proj-a");
    await fs.writeFile(path.join(root, "WORKFLOW.md"), "---\ntracker: [bad]\n---\nbad");
    const stale = await loader.resolve({ projectPath: root, issue: { id: "1", identifier: "ENG-2", title: "Hello", state: "Ready", labels: [] }, allowStale: true });
    expect(stale.config.tracker.projectSlug).toBe("proj-a");
    expect(stale.body.trim()).toBe("Do ENG-2");
    await expect(loader.resolve({ projectPath: root })).rejects.toThrow();
  });

  it("creates directory-only workspaces", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aih-orch-ws-"));
    const layout = new WorkspaceLayout(root);
    await expect(layout.create({ identifier: "ENG-1" })).resolves.toMatchObject({ path: path.join(root, "eng-1"), created: true });
    await expect(layout.create({ identifier: "ENG-1" })).resolves.toMatchObject({ created: false });
    await layout.remove({ identifier: "ENG-1" });
    await expect(fs.stat(path.join(root, "eng-1"))).rejects.toThrow();
  });
});

describe("orchestrator routes", () => {
  it("redacts workflow tracker secrets", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "aih-orch-route-"));
    const project = path.join(home, "project");
    await fs.mkdir(project);
    await writeCustomWorkflow(project, { apiKey: "secret-key", projectSlug: "proj-a" });
    const context = { getDataDir: () => home, getConfig: () => ({ gateway: { port: 4001 }, extensions: { subagents: { profiles }, orchestrator: { projects: [project] } } }), emit: vi.fn() } as any;
    const app = new Hono();
    try {
      await orchestratorExtension.start?.(context);
      orchestratorExtension.registerRoutes(app);
      const response = await app.request("/orchestrator/workflow?project=project");
      const data = await response.json();
      expect(data.frontmatter.tracker.api_key).toBe("[redacted]");
      expect(data.config.tracker.apiKey).toBe("[redacted]");
      expect(JSON.stringify(data)).not.toContain("secret-key");
    } finally {
      await orchestratorExtension.stop?.();
    }
  });

  it("marks killed runs as finished", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "aih-orch-kill-"));
    const project = path.join(home, "project");
    await fs.mkdir(project);
    await writeWorkflow(project);
    const context = { getDataDir: () => home, getConfig: () => ({ gateway: { port: 4001 }, extensions: { subagents: { profiles }, orchestrator: { projects: [project] } } }), emit: vi.fn() } as any;
    const app = new Hono();
    try {
      await orchestratorExtension.start?.(context);
      orchestratorExtension.registerRoutes(app);
      const state = new StateStore(path.join(home, "orchestrator", "state.db"));
      state.bootstrap();
      state.insertRun({ runId: "r-kill", projectId: "project", issueId: "lin_1", identifier: "ENG-1", workspace: path.join(project, "workspaces", "eng-1"), profileJson: "{}", workflowPath: path.join(project, "WORKFLOW.md"), workflowSha: "abc", pid: null, startedAt: new Date().toISOString() });
      state.claim("lin_1", "r-kill", "project");
      const response = await app.request("/orchestrator/runs/ENG-1/kill?project=project", { method: "POST" });
      expect(response.status).toBe(200);
      expect(state.listOpenRuns("project")).toHaveLength(0);
      expect(state.listRecent(1, "project")[0]).toMatchObject({ outcome: "killed", process_alive: 0 });
      expect(context.emit).toHaveBeenCalledWith("orchestrator.run.finished", expect.objectContaining({ issueId: "lin_1", projectId: "project", runId: "r-kill", outcome: "killed" }));
      state.close();
    } finally {
      await orchestratorExtension.stop?.();
    }
  });
});

describe("orchestrator agent tools", () => {
  it("requires project and uses that project tracker auth", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "aih-orch-tool-"));
    const one = path.join(home, "one");
    const two = path.join(home, "two");
    await fs.mkdir(one);
    await fs.mkdir(two);
    await writeCustomWorkflow(one, { apiKey: "key-one", endpoint: "https://linear-one.test/graphql", projectSlug: "proj-a" });
    await writeCustomWorkflow(two, { apiKey: "key-two", endpoint: "https://linear-two.test/graphql", projectSlug: "proj-b" });
    const calls: Array<{ url: string; auth: string | null }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), auth: new Headers(init?.headers).get("authorization") });
      return new Response(JSON.stringify({ data: { ok: true } }), { status: 200, headers: { "content-type": "application/json" } });
    }) as any;
    const context = { getDataDir: () => home, getConfig: () => ({ extensions: { subagents: { profiles }, orchestrator: { projects: [one, two] } } }), emit: vi.fn() } as any;
    try {
      await orchestratorExtension.start?.(context);
      const tools = await Promise.resolve(orchestratorExtension.getAgentTools?.(context) ?? []);
      const tool = tools[0]!;
      await expect(tool.execute({ query: "query" }, {} as any)).resolves.toHaveProperty("error");
      await expect(tool.execute({ project: "two", query: "query" }, {} as any)).resolves.toEqual({ ok: true });
      expect(calls).toEqual([{ url: "https://linear-two.test/graphql", auth: "key-two" }]);
    } finally {
      await orchestratorExtension.stop?.();
      globalThis.fetch = originalFetch;
    }
  });
});

describe("orchestrator Linear client", () => {
  it("polls by Linear project slug", async () => {
    const calls: Array<{ query: string; variables: Record<string, unknown> }> = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { query: string; variables: Record<string, unknown> };
      calls.push(body);
      return new Response(JSON.stringify({ data: { issues: { nodes: [{ id: "lin_2", identifier: "ENG-2", title: "Blocked", description: null, url: "https://linear.test/ENG-2", state: { name: "Ready" }, labels: { nodes: [] }, inverseRelations: { nodes: [{ type: "blocks", issue: { id: "lin_1", identifier: "ENG-1", state: { name: "Ready" } } }, { type: "related", issue: { id: "lin_3", identifier: "ENG-3", state: { name: "Ready" } } }] }, project: { name: "Project A", slugId: "proj-a" }, parent: null }] } } }), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const client = new LinearClient("test", { fetchImpl });
    const issues = await client.pollIssues({ projectSlug: "proj-a", activeStates: ["Ready"] });
    expect(calls[0]?.query).toContain("slugId");
    expect(calls[0]?.query).toContain("inverseRelations");
    expect(calls[0]?.variables).toEqual({ projectSlug: "proj-a", states: ["Ready"] });
    expect(issues[0]?.blocked_by).toEqual([{ id: "lin_1", identifier: "ENG-1", state: "Ready" }]);
  });

  it("waits on exhausted bucket and retries one 429 after reset", async () => {
    let now = 1_000;
    const sleeps: number[] = [];
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { ok: true } }), { headers: { "x-ratelimit-requests-remaining": "0", "x-ratelimit-requests-reset": "3" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ errors: [{ message: "rate" }] }), { status: 429, headers: { "x-ratelimit-requests-remaining": "0", "x-ratelimit-requests-reset": "5" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { ok: true } }), { headers: { "x-ratelimit-requests-remaining": "9" } }));
    const client = new LinearClient("key", { fetchImpl, now: () => now, sleep: async (ms) => { sleeps.push(ms); now += ms; } });
    await expect(client.graphql("query")).resolves.toEqual({ ok: true });
    await expect(client.graphql("query")).resolves.toEqual({ ok: true });
    expect(sleeps).toEqual([3_000, 2_000]);
    expect(client.rateLimitRemaining).toBe(9);
  });
});

describe("orchestrator daemon", () => {
  it("records CLI runner spawn failures as worker errors", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aih-orch-cli-error-"));
    const runner = new CliWorkerRunner();
    const handle = await runner.start({
      runId: "r-cli-error",
      project: { id: "project", path: root, workflowPath: path.join(root, "WORKFLOW.md") },
      issue: { id: "lin_1", identifier: "ENG-1", title: "CLI", state: "Ready", labels: [] },
      workspace: root,
      prompt: "Run",
      label: "ENG-1",
      profile: { name: "default", cli: "codex" },
      workflow: {
        tracker: { kind: "linear", endpoint: "x", apiKey: "x", projectSlug: "proj-a", activeStates: ["Ready"], terminalStates: ["Done"], needsHuman: "Needs Human" },
        workspace: { root, cleanupOnTerminal: false, reuse: true },
        polling: { intervalMs: 1000, jitterMs: 0 },
        agent: { runner: "cli", command: "__aihub_missing_command__" },
        hooks: {},
        server: undefined,
        linear: undefined,
      },
    });

    await vi.waitFor(async () => expect(await runner.status(handle)).toMatchObject({ status: "error" }));
  });

  it("skips issues with pending blockers", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aih-orch-blocked-"));
    await writeWorkflow(root);
    const store = new StateStore(path.join(root, "state.db"));
    store.bootstrap();
    const claims = new ClaimsRegistry();
    const client = {
      pollIssues: vi.fn(async () => [{ id: "lin_2", identifier: "ENG-2", title: "Blocked", description: "Body", state: "Ready", labels: [], projectSlug: "proj-a", blocked_by: [{ id: "lin_1", identifier: "ENG-1", state: "Ready" }] }]),
      commentCreate: vi.fn(),
      issueUpdateStateByName: vi.fn(),
    } as any;
    const ctx = { getDataDir: () => path.dirname(root), getConfig: () => ({ extensions: { subagents: { profiles }, orchestrator: { projects: [root] } } }), emit: vi.fn() } as any;
    const started = vi.fn(async () => ({ id: "sub_blocked" }));
    const daemon = new OrchestratorDaemon({ ctx, store, claims, getConfig: () => ({ projects: [root] }), startSubagent: started, createLinearClient: () => client });

    await daemon.start();
    await expect(daemon.tick()).resolves.toMatchObject({ dispatched: 0, skipped: 1 });

    expect(started).not.toHaveBeenCalled();
    expect(claims.list()).toHaveLength(0);
    expect(ctx.emit).toHaveBeenCalledWith("orchestrator.run.event", expect.objectContaining({ type: "dispatch.skipped", reason: "blocked_by_pending", issueId: "lin_2", pendingBlockerIds: ["ENG-1"] }));
    await daemon.stop();
    store.close();
  });

  it("dispatches issues when all blockers are terminal", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aih-orch-unblocked-"));
    await writeWorkflow(root);
    const store = new StateStore(path.join(root, "state.db"));
    store.bootstrap();
    const claims = new ClaimsRegistry();
    const client = {
      pollIssues: vi.fn(async () => [{ id: "lin_2", identifier: "ENG-2", title: "Ready", description: "Body", state: "Ready", labels: [], projectSlug: "proj-a", blocked_by: [{ id: "lin_1", identifier: "ENG-1", state: "Done" }] }]),
      commentCreate: vi.fn(),
      issueUpdateStateByName: vi.fn(),
    } as any;
    const ctx = { getDataDir: () => path.dirname(root), getConfig: () => ({ extensions: { subagents: { profiles }, orchestrator: { projects: [root] } } }), emit: vi.fn() } as any;
    const started = vi.fn(async () => ({ id: "sub_unblocked" }));
    const daemon = new OrchestratorDaemon({ ctx, store, claims, getConfig: () => ({ projects: [root] }), startSubagent: started, createLinearClient: () => client });

    await daemon.start();
    await expect(daemon.tick()).resolves.toMatchObject({ dispatched: 1, skipped: 0 });

    expect(started).toHaveBeenCalledOnce();
    expect(claims.list()).toHaveLength(1);
    await daemon.stop();
    store.close();
  });

  it("dispatches through fake worker runner without starting a subagent", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aih-orch-fake-runner-"));
    await fs.writeFile(path.join(root, "WORKFLOW.md"), `---
tracker:
  kind: linear
  api_key: test-key
  project_slug: proj-a
  active_states: [Ready]
  terminal_states: [Done]
agent:
  profile: default
  runner: fake
  max_concurrent: 1
workspace:
  root: ./workspaces
---
Do {{issue.identifier}}
`);
    const store = new StateStore(path.join(root, "state.db"));
    store.bootstrap();
    const claims = new ClaimsRegistry();
    const client = {
      pollIssues: vi.fn(async () => [{ id: "lin_1", identifier: "ENG-1", title: "Fake", description: "Body", state: "Ready", labels: [], projectSlug: "proj-a" }]),
      commentCreate: vi.fn(),
      issueUpdateStateByName: vi.fn(),
    } as any;
    const ctx = { getDataDir: () => path.dirname(root), getConfig: () => ({ extensions: { subagents: { profiles }, orchestrator: { projects: [root] } } }), emit: vi.fn() } as any;
    const started = vi.fn(async () => ({ id: "sub_should_not_start" }));
    const daemon = new OrchestratorDaemon({ ctx, store, claims, getConfig: () => ({ projects: [root] }), startSubagent: started, createLinearClient: () => client });

    await daemon.start();
    await expect(daemon.tick()).resolves.toMatchObject({ dispatched: 1, skipped: 0 });
    expect(started).not.toHaveBeenCalled();
    expect(store.listRecent(1)[0]).toMatchObject({ subagent_run_id: expect.stringContaining("fake:") });
    await expect(daemon.tick()).resolves.toMatchObject({ dispatched: 0 });
    expect(claims.list()).toHaveLength(0);
    expect(store.listRecent(1)[0]).toMatchObject({ outcome: "completed" });
    const runId = String((store.listRecent(1)[0] as any).run_id);
    expect(store.listEvents(runId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "worker.started" }),
      expect.objectContaining({ type: "worker.status" }),
    ]));
    await daemon.stop();
    store.close();
  });

  it("interrupts worker handles by orchestrator run id", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aih-orch-interrupt-runid-"));
    await writeWorkflow(root);
    const store = new StateStore(path.join(root, "state.db"));
    store.bootstrap();
    const claims = new ClaimsRegistry();
    const client = { pollIssues: vi.fn(async () => [{ id: "lin_1", identifier: "ENG-1", title: "Run", description: "Body", state: "Ready", labels: [], projectSlug: "proj-a" }]), commentCreate: vi.fn(), issueUpdateStateByName: vi.fn() } as any;
    const ctx = { getDataDir: () => path.dirname(root), getConfig: () => ({ extensions: { subagents: { profiles }, orchestrator: { projects: [root] } } }), emit: vi.fn() } as any;
    const abort = vi.fn(async () => undefined);
    const daemon = new OrchestratorDaemon({
      ctx,
      store,
      claims,
      getConfig: () => ({ projects: [root] }),
      startSubagent: vi.fn(),
      createLinearClient: () => client,
      workerRunner: {
        start: vi.fn(async () => ({ id: "cli:test:123", kind: "cli" as const, pid: 123 })),
        status: vi.fn(async () => undefined),
        abort,
      },
    });

    await daemon.start();
    await daemon.tick();
    const runId = String((store.listRecent(1)[0] as any).run_id);
    await daemon.interruptSubagent(runId, path.basename(root));

    expect(abort).toHaveBeenCalledWith(expect.objectContaining({ id: "cli:test:123", kind: "cli" }));
    await daemon.stop();
    store.close();
  });

  it("persists CLI worker pid for restart cleanup", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aih-orch-cli-pid-"));
    await fs.writeFile(path.join(root, "WORKFLOW.md"), `---
tracker:
  kind: linear
  api_key: test-key
  project_slug: proj-a
  active_states: [Ready]
  terminal_states: [Done]
agent:
  profile: default
  runner: cli
  command: ["${process.execPath}", "-e", "setTimeout(()=>{}, 10000)"]
  max_concurrent: 1
workspace:
  root: ./workspaces
---
Do {{issue.identifier}}
`);
    const store = new StateStore(path.join(root, "state.db"));
    store.bootstrap();
    const claims = new ClaimsRegistry();
    const client = { pollIssues: vi.fn(async () => [{ id: "lin_1", identifier: "ENG-1", title: "CLI", description: "Body", state: "Ready", labels: [], projectSlug: "proj-a" }]), commentCreate: vi.fn(), issueUpdateStateByName: vi.fn() } as any;
    const ctx = { getDataDir: () => path.dirname(root), getConfig: () => ({ extensions: { subagents: { profiles }, orchestrator: { projects: [root] } } }), emit: vi.fn() } as any;
    const daemon = new OrchestratorDaemon({ ctx, store, claims, getConfig: () => ({ projects: [root] }), startSubagent: vi.fn(), createLinearClient: () => client });

    await daemon.start();
    await daemon.tick();
    const row = store.listRecent(1)[0] as Record<string, unknown>;
    expect(row.subagent_run_id).toEqual(expect.stringContaining("cli:"));
    expect(row.pid).toEqual(expect.any(Number));
    await daemon.stop();
    store.close();
  });

  it("ticks configured project, dispatches in issue workspace, and releases terminal", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aih-orch-daemon-"));
    await writeWorkflow(root);
    const store = new StateStore(path.join(root, "state.db"));
    store.bootstrap();
    const claims = new ClaimsRegistry();
    let state = "Ready";
    const client = {
      rateLimitRemaining: 7,
      pollIssues: vi.fn(async () => [{ id: "lin_1", identifier: "ENG-1", title: "Test", description: "Body", state, labels: [], projectSlug: "proj-a" }]),
      commentCreate: vi.fn(),
      issueUpdateStateByName: vi.fn(),
    } as any;
    const ctx = { getDataDir: () => path.dirname(root), getConfig: () => ({ extensions: { subagents: { profiles }, orchestrator: { projects: [root] } } }), emit: vi.fn() } as any;
    const started = vi.fn(async (body) => ({ id: "sub_1", ...body }));
    const stopSubagent = vi.fn(async () => undefined);
    const daemon = new OrchestratorDaemon({ ctx, store, claims, getConfig: () => ({ projects: [root] }), startSubagent: started, stopSubagent, createLinearClient: () => client });

    await daemon.start();
    await daemon.tick();
    expect(daemon.rateLimitRemaining).toBe(7);
    expect(claims.list()).toHaveLength(1);
    expect(started).toHaveBeenCalledWith(expect.objectContaining({ profile: "default", cwd: path.join(root, "workspaces", "eng-1"), prompt: expect.stringContaining(`Linear GraphQL tool calls must pass project: ${path.basename(root)}`) }));
    expect(store.listRecent(5)).toHaveLength(1);

    state = "Done";
    await daemon.tick();
    expect(claims.list()).toHaveLength(0);
    expect(stopSubagent).toHaveBeenCalledWith("sub_1");
    expect(store.listRecent(1)[0]).toMatchObject({ project_id: path.basename(root), outcome: "terminal" });
    await daemon.stop();
    store.close();
  });

  it("releases claim when subagent reaches terminal status", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aih-orch-complete-"));
    await writeWorkflow(root);
    const store = new StateStore(path.join(root, "state.db"));
    store.bootstrap();
    const claims = new ClaimsRegistry();
    const client = { pollIssues: vi.fn(async () => [{ id: "lin_1", identifier: "ENG-1", title: "Test", description: "Body", state: "Ready", labels: [], projectSlug: "proj-a" }]), commentCreate: vi.fn(), issueUpdateStateByName: vi.fn() } as any;
    const ctx = { getDataDir: () => path.dirname(root), getConfig: () => ({ extensions: { subagents: { profiles }, orchestrator: { projects: [root] } } }), emit: vi.fn() } as any;
    const daemon = new OrchestratorDaemon({ ctx, store, claims, getConfig: () => ({ projects: [root] }), startSubagent: vi.fn(async () => ({ id: "sub_done" })), getSubagentRun: vi.fn(async () => ({ status: "done", exitCode: 0 })), createLinearClient: () => client });
    await daemon.start();
    await daemon.tick();
    expect(claims.list()).toHaveLength(1);
    await daemon.tick();
    expect(claims.list()).toHaveLength(0);
    expect(store.listRecent(1)[0]).toMatchObject({ outcome: "completed", process_alive: 0 });
    await daemon.stop();
    store.close();
  });

  it("parks issue when subagent exits with error", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aih-orch-error-"));
    await writeWorkflow(root);
    const store = new StateStore(path.join(root, "state.db"));
    store.bootstrap();
    const claims = new ClaimsRegistry();
    const client = { pollIssues: vi.fn(async () => [{ id: "lin_1", identifier: "ENG-1", title: "Test", description: "Body", state: "Ready", labels: [], projectSlug: "proj-a" }]), commentCreate: vi.fn(async () => undefined), issueUpdateStateByName: vi.fn(async () => undefined) } as any;
    const ctx = { getDataDir: () => path.dirname(root), getConfig: () => ({ extensions: { subagents: { profiles }, orchestrator: { projects: [root] } } }), emit: vi.fn() } as any;
    const stopSubagent = vi.fn(async () => undefined);
    const daemon = new OrchestratorDaemon({ ctx, store, claims, getConfig: () => ({ projects: [root] }), startSubagent: vi.fn(async () => ({ id: "sub_error" })), getSubagentRun: vi.fn(async () => ({ status: "error", exitCode: 1 })), stopSubagent, createLinearClient: () => client });
    await daemon.start();
    await daemon.tick();
    await daemon.tick();
    expect(client.commentCreate).toHaveBeenCalledWith("lin_1", "Orchestrator parked issue: worker exited with error (exit 1)");
    expect(client.issueUpdateStateByName).toHaveBeenCalledWith("lin_1", "Needs Human");
    expect(stopSubagent).toHaveBeenCalledWith("sub_error");
    expect(claims.list()).toHaveLength(0);
    expect(store.listRecent(1)[0]).toMatchObject({ outcome: "error", process_alive: 0, subagent_run_id: "sub_error" });
    await daemon.stop();
    store.close();
  });

  it("stops active subagent when claimed issue is observed in Needs Human", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aih-orch-hitl-"));
    await writeWorkflow(root);
    const store = new StateStore(path.join(root, "state.db"));
    store.bootstrap();
    const claims = new ClaimsRegistry();
    let state = "Ready";
    const client = { pollIssues: vi.fn(async () => [{ id: "lin_1", identifier: "ENG-1", title: "Test", description: "Body", state, labels: [], projectSlug: "proj-a" }]), commentCreate: vi.fn(), issueUpdateStateByName: vi.fn() } as any;
    const ctx = { getDataDir: () => path.dirname(root), getConfig: () => ({ extensions: { subagents: { profiles }, orchestrator: { projects: [root] } } }), emit: vi.fn() } as any;
    const stopSubagent = vi.fn(async () => undefined);
    const daemon = new OrchestratorDaemon({ ctx, store, claims, getConfig: () => ({ projects: [root] }), startSubagent: vi.fn(async () => ({ id: "sub_needs_human" })), stopSubagent, createLinearClient: () => client });
    await daemon.start();
    await daemon.tick();

    state = "Needs Human";
    await daemon.tick();

    expect(stopSubagent).toHaveBeenCalledWith("sub_needs_human");
    expect(claims.list()).toHaveLength(0);
    expect(store.listRecent(1)[0]).toMatchObject({ outcome: "needs_human", process_alive: 0, subagent_run_id: "sub_needs_human" });
    await daemon.stop();
    store.close();
  });

  it("retries same issue with unique label and attempt", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aih-orch-retry-"));
    await writeWorkflow(root);
    await fs.appendFile(path.join(root, "WORKFLOW.md"), "Attempt {{attempt}}\n");
    const store = new StateStore(path.join(root, "state.db"));
    store.bootstrap();
    store.insertRun({ runId: "old", projectId: path.basename(root), issueId: "lin_1", identifier: "ENG-1", workspace: path.join(root, "workspaces", "eng-1"), profileJson: "{}", workflowPath: path.join(root, "WORKFLOW.md"), workflowSha: "abc", pid: null, startedAt: new Date().toISOString() });
    store.finishRun("old", "interrupted_gateway_restart");
    const claims = new ClaimsRegistry();
    const client = { pollIssues: vi.fn(async () => [{ id: "lin_1", identifier: "ENG-1", title: "Test", description: "Body", state: "Ready", labels: [], projectSlug: "proj-a" }]), commentCreate: vi.fn(), issueUpdateStateByName: vi.fn() } as any;
    const ctx = { getDataDir: () => path.dirname(root), getConfig: () => ({ extensions: { subagents: { profiles }, orchestrator: { projects: [root] } } }), emit: vi.fn() } as any;
    const started = vi.fn(async (body) => ({ id: "sub_retry", ...body }));
    const daemon = new OrchestratorDaemon({ ctx, store, claims, getConfig: () => ({ projects: [root] }), startSubagent: started, createLinearClient: () => client });
    await daemon.start();
    await daemon.tick();
    const body = started.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body.label).toMatch(/^ENG-1-\d+$/);
    expect(body.prompt).toEqual(expect.stringContaining("Attempt 2"));
    await daemon.stop();
    store.close();
  });

  it("manual claim runs project-scoped dispatch", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aih-orch-claim-"));
    await writeWorkflow(root);
    const store = new StateStore(path.join(root, "state.db"));
    store.bootstrap();
    const claims = new ClaimsRegistry();
    const issue = { id: "lin_1", identifier: "ENG-1", title: "Manual", description: "Body", state: "Ready", labels: [], projectSlug: "proj-a" };
    const client = { getIssue: vi.fn(async () => issue), pollIssues: vi.fn(), commentCreate: vi.fn(), issueUpdateStateByName: vi.fn() } as any;
    const ctx = { getDataDir: () => path.dirname(root), getConfig: () => ({ extensions: { subagents: { profiles }, orchestrator: { projects: [root] } } }), emit: vi.fn() } as any;
    const started = vi.fn(async (body) => ({ id: "sub_manual", ...body }));
    const daemon = new OrchestratorDaemon({ ctx, store, claims, getConfig: () => ({ projects: [root] }), startSubagent: started, createLinearClient: () => client });
    await daemon.start();
    await expect(daemon.claimNow("ENG-1")).resolves.toEqual({ ok: true });
    expect(client.getIssue).toHaveBeenCalledWith("ENG-1");
    expect(started).toHaveBeenCalledWith(expect.objectContaining({ cwd: path.join(root, "workspaces", "eng-1") }));
    await expect(daemon.claimNow("ENG-1")).resolves.toMatchObject({ ok: false, status: 409 });
    await daemon.stop();
    store.close();
  });

  it("honors per-project polling cadence", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "aih-orch-polling-"));
    const fast = path.join(home, "fast");
    const slow = path.join(home, "slow");
    await fs.mkdir(fast);
    await fs.mkdir(slow);
    await writeWorkflow(fast, "polling:\n  interval_ms: 1000\n  jitter_ms: 0\n");
    await writeCustomWorkflow(slow, { projectSlug: "proj-b", intervalMs: 5000 });
    const store = new StateStore(path.join(home, "state.db"));
    store.bootstrap();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const ctx = { getDataDir: () => home, getConfig: () => ({ extensions: { subagents: { profiles }, orchestrator: { projects: [fast, slow] } } }), emit: vi.fn() } as any;
    const daemon = new OrchestratorDaemon({ ctx, store, claims: new ClaimsRegistry(), getConfig: () => ({ projects: [fast, slow] }), startSubagent: vi.fn(), createLinearClient: () => ({ pollIssues: vi.fn(async () => []) } as any) });
    try {
      await daemon.start();
      const delays = setTimeoutSpy.mock.calls.map((call) => call[1]);
      expect(delays).toContain(1000);
      expect(delays).toContain(5000);
    } finally {
      setTimeoutSpy.mockRestore();
      await daemon.stop();
      store.close();
    }
  });

  it("marks open runs interrupted on startup instead of reattaching", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aih-orch-recovery-"));
    await writeWorkflow(root);
    const store = new StateStore(path.join(root, "state.db"));
    store.bootstrap();
    store.insertRun({ runId: "r1", projectId: path.basename(root), issueId: "lin_1", identifier: "ENG-1", workspace: path.join(root, "workspaces", "eng-1"), profileJson: "{}", workflowPath: path.join(root, "WORKFLOW.md"), workflowSha: "abc", pid: 1, startedAt: new Date().toISOString() });
    const ctx = { getDataDir: () => path.dirname(root), getConfig: () => ({ extensions: { subagents: { profiles }, orchestrator: { projects: [root] } } }), emit: vi.fn() } as any;
    const stopSubagent = vi.fn(async () => undefined);
    store.setSubagentRunId("r1", "sub_stale");
    const daemon = new OrchestratorDaemon({ ctx, store, claims: new ClaimsRegistry(), getConfig: () => ({ projects: [root] }), startSubagent: vi.fn(), stopSubagent, createLinearClient: () => ({ pollIssues: vi.fn(async () => []) } as any) });
    await daemon.start();
    expect(stopSubagent).toHaveBeenCalledWith("sub_stale");
    expect(store.listRecent(1)[0]).toMatchObject({ outcome: "interrupted_gateway_restart" });
    await daemon.stop();
    store.close();
  });

  it("coalesces queued ticks and batches HITL notifications", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aih-orch-queue-"));
    await writeWorkflow(root);
    const store = new StateStore(path.join(root, "state.db"));
    store.bootstrap();
    let resolvePoll: (() => void) | undefined;
    const pollGate = new Promise<void>((resolve) => { resolvePoll = resolve; });
    let polls = 0;
    const client = { pollIssues: vi.fn(async () => { polls += 1; if (polls === 1) await pollGate; return []; }) } as any;
    const sent: string[] = [];
    const ctx = { getDataDir: () => path.dirname(root), getConfig: () => ({ extensions: { subagents: { profiles }, orchestrator: { projects: [root], notifyChannel: "ops" } } }), emit: vi.fn() } as any;
    const daemon = new OrchestratorDaemon({ ctx, store, claims: new ClaimsRegistry(), getConfig: () => ({ projects: [root], notifyChannel: "ops" }), startSubagent: vi.fn(), createLinearClient: () => client, notify: async (message) => { sent.push(message); } });
    await daemon.start();
    daemon.enqueueTick();
    daemon.enqueueTick();
    resolvePoll?.();
    await vi.waitFor(() => expect(polls).toBe(2));
    for (let i = 0; i < 5; i += 1) daemon.notifyRunFailed(`ENG-${i}`, "boom");
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toContain("ENG-0");
    await daemon.stop();
    store.close();
  });

  it("bootstraps project-aware sqlite state", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aih-orch-db-"));
    const store = new StateStore(path.join(root, "state.db"));
    store.bootstrap();
    store.insertRun({ runId: "r1", projectId: "p1", issueId: "i1", identifier: "ENG-1", workspace: root, profileJson: "{}", workflowPath: "WORKFLOW.md", workflowSha: "abc", pid: 1, startedAt: new Date().toISOString() });
    store.appendEvent("r1", "x", { ok: true }, "p1");
    expect(store.listRecent(1, "p1")).toHaveLength(1);
    expect(store.listEvents("r1")).toHaveLength(1);
    store.finishRun("r1", "done", 0);
    store.close();
  });
});
