import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ClaimsRegistry, ConcurrencyLimiter, LinearClient, OrchestratorDaemon, RetryPolicy, WorkflowLoader, isRelevantWebhook, resolveProfile, resolveRepo, sanitizeIdentifier, StateStore, verifyWebhookSignature } from "./index.js";

const profiles = [{ name: "default", cli: "codex" as const }, { name: "claude", cli: "claude" as const }];

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

  it("resolves repos", () => {
    expect(resolveRepo({ labels: ["repo:z", "repo:a"], repos: { a: "/tmp/a" } })).toMatchObject({ repo: { name: "a", path: "/tmp/a" }, warning: expect.stringContaining("Multiple") });
    expect(resolveRepo({ labels: [], repos: {}, defaultRepo: undefined })).toEqual({ repo: null, warning: undefined });
    expect(resolveRepo({ labels: ["repo:missing"], repos: {} })).toMatchObject({ repo: null, warning: expect.stringContaining("Repo not configured") });
  });

  it("sanitizes identifiers", () => {
    expect(sanitizeIdentifier("ENG-123? Bad!")).toBe("eng-123bad");
  });

  it("resolves profiles or parks", () => {
    expect(resolveProfile({ labels: [], workflow: { agent: { default_profile: "default" } }, profilesConfig: profiles })).toMatchObject({ profile: { name: "default" } });
    expect(resolveProfile({ labels: ["agent:claude"], workflow: { agent: { default_profile: "default", label_profiles: { "agent:claude": "claude" } } }, profilesConfig: profiles })).toMatchObject({ profile: { name: "claude" } });
    expect(resolveProfile({ labels: ["a", "b"], workflow: { agent: { default_profile: "default", label_profiles: { a: "default", b: "claude" } } }, profilesConfig: profiles })).toHaveProperty("park");
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

describe("orchestrator Linear client", () => {
  it("gets issues by human identifier or id", async () => {
    const calls: Array<{ query: string; variables: Record<string, unknown> }> = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { query: string; variables: Record<string, unknown> };
      calls.push(body);
      const node = {
        id: body.variables.identifier === "ENG-1" ? "lin_1" : body.variables.id,
        identifier: body.variables.identifier ?? "ENG-2",
        title: "Title",
        description: "Body",
        url: "https://linear.app/acme/issue/ENG-1/title",
        state: { name: "Ready" },
        labels: { nodes: [{ name: "agent:codex" }] },
        project: { name: "Project" },
        parent: { id: "parent_1" },
      };
      const data = body.variables.identifier
        ? { issues: { nodes: [node] } }
        : { issue: node };
      return new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const previousFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    try {
      const client = new LinearClient("test", "https://linear.test/graphql");
      await expect(client.getIssue("ENG-1")).resolves.toMatchObject({ id: "lin_1", identifier: "ENG-1", labels: ["agent:codex"] });
      await expect(client.getIssue("lin_2")).resolves.toMatchObject({ id: "lin_2", identifier: "ENG-2" });
      expect(calls[0]?.query).toContain("AihubIssueByIdentifier");
      expect(calls[1]?.query).toContain("AihubIssueById");
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

describe("LinearClient", () => {
  it("waits on exhausted bucket and retries one 429 after reset", async () => {
    let now = 1_000;
    const sleeps: number[] = [];
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { ok: true } }), { headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "3" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ errors: [{ message: "rate" }] }), { status: 429, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "5" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { ok: true } }), { headers: { "x-ratelimit-remaining": "9" } }));
    const client = new LinearClient("key", { fetchImpl, now: () => now, sleep: async (ms) => { sleeps.push(ms); now += ms; } });
    await expect(client.graphql("query")).resolves.toEqual({ ok: true });
    await expect(client.graphql("query")).resolves.toEqual({ ok: true });
    expect(sleeps).toEqual([3_000, 2_000]);
    expect(client.rateLimitRemaining).toBe(9);
  });
});

describe("orchestrator IO modules", () => {
  it("claims only once under concurrency", async () => {
    const claims = new ClaimsRegistry();
    const results = await Promise.all([claims.tryClaim("A", "1"), claims.tryClaim("A", "2")]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("merges workflow frontmatter and replaces body", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aih-orch-"));
    const repo = path.join(root, "repo");
    await fs.mkdir(repo);
    await fs.writeFile(path.join(root, "WORKFLOW.md"), "---\nagent:\n  default_profile: default\ntracker:\n  states:\n    active: [Ready]\n---\nfallback {{issue.identifier}}\n");
    await fs.writeFile(path.join(repo, "WORKFLOW.md"), "---\nagent:\n  max_turns: 2\n---\nrepo {{issue.title}}\n");
    const loader = new WorkflowLoader(root, { a: { name: "a", path: repo } });
    const snapshot = await loader.resolve({ repo: "a", issue: { id: "1", identifier: "ENG-1", title: "Hello", state: "Ready", labels: [] } });
    expect(snapshot.frontmatter.agent).toMatchObject({ default_profile: "default", max_turns: 2 });
    expect(snapshot.body.trim()).toBe("repo Hello");
  });

  it("daemon ticks poll, claim, create workspace, start subagent, and release on terminal", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aih-orch-daemon-"));
    await fs.writeFile(path.join(root, "WORKFLOW.md"), "---\nagent:\n  default_profile: default\n  max_concurrent: 1\ntracker:\n  states:\n    active: [Ready]\n    terminal: [Done]\n---\nDo {{issue.identifier}}\n");
    const store = new StateStore(path.join(root, "state.db"));
    store.bootstrap();
    const claims = new ClaimsRegistry();
    let state = "Ready";
    const client = {
      rateLimitRemaining: 99,
      pollIssues: vi.fn(async () => [{ id: "lin_1", identifier: "ENG-1", title: "Test", description: "Body", state, labels: [] }]),
      commentCreate: vi.fn(),
      issueUpdate: vi.fn(),
    } as any;
    const events: Array<{ name: string; payload: unknown }> = [];
    const ctx = {
      getDataDir: () => root,
      getConfig: () => ({ extensions: { subagents: { profiles }, orchestrator: { teamKey: "ENG" } } }),
      emit: (name: string, payload: unknown) => events.push({ name, payload }),
    } as any;
    const started = vi.fn(async (body) => ({ id: "sub_1", ...body }));
    const daemon = new OrchestratorDaemon({ ctx, client, store, claims, getConfig: () => ({ teamKey: "ENG" }), startSubagent: started });

    await daemon.tick();
    expect(claims.list()).toHaveLength(1);
    expect(started).toHaveBeenCalledWith(expect.objectContaining({ profile: "default", cwd: path.join(root, "workspaces", "eng-1") }));
    expect(await fs.stat(path.join(root, "workspaces", "eng-1"))).toBeTruthy();
    expect(store.listRecent(5)).toHaveLength(1);
    expect(events.some((event) => event.name === "orchestrator.run.claimed")).toBe(true);

    state = "Done";
    await daemon.tick();
    expect(claims.list()).toHaveLength(0);
    expect(store.listRecent(1)[0]).toMatchObject({ outcome: "terminal" });
    store.close();
  });

  it("manual claim runs full dispatch path and rejects active claims", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aih-orch-claim-"));
    await fs.writeFile(path.join(root, "WORKFLOW.md"), "---\nagent:\n  default_profile: default\ntracker:\n  states:\n    active: [Ready]\n---\nManual {{issue.identifier}}\n");
    const store = new StateStore(path.join(root, "state.db"));
    store.bootstrap();
    const claims = new ClaimsRegistry();
    const issue = { id: "lin_1", identifier: "ENG-1", title: "Manual", description: "Body", state: "Ready", labels: [] };
    const client = {
      rateLimitRemaining: 99,
      getIssue: vi.fn(async () => issue),
      pollIssues: vi.fn(),
      commentCreate: vi.fn(),
      issueUpdateStateByName: vi.fn(),
    } as any;
    const ctx = {
      getDataDir: () => root,
      getConfig: () => ({ extensions: { subagents: { profiles }, orchestrator: { teamKey: "ENG" } } }),
      emit: vi.fn(),
    } as any;
    const started = vi.fn(async (body) => ({ id: "sub_manual", ...body }));
    const daemon = new OrchestratorDaemon({ ctx, client, store, claims, getConfig: () => ({ teamKey: "ENG" }), startSubagent: started });

    await expect(daemon.claimNow("ENG-1")).resolves.toEqual({ ok: true });
    expect(client.getIssue).toHaveBeenCalledWith("ENG-1");
    expect(started).toHaveBeenCalledWith(expect.objectContaining({ profile: "default", cwd: path.join(root, "workspaces", "eng-1") }));
    expect(claims.list()).toHaveLength(1);
    expect(store.listRecent(1)[0]).toMatchObject({ issue_id: "lin_1", subagent_run_id: "sub_manual" });

    await expect(daemon.claimNow("ENG-1")).resolves.toMatchObject({ ok: false, status: 409 });
    expect(started).toHaveBeenCalledTimes(1);
    store.close();
  });

  it("runs hook lifecycle phases and cleans up workspace on terminal", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aih-orch-hooks-"));
    const marker = path.join(root, "hooks.log");
    await fs.writeFile(path.join(root, "WORKFLOW.md"), `---
agent:
  default_profile: default
tracker:
  states:
    active: [Ready]
    terminal: [Done]
workspace:
  cleanup_on_terminal: true
hooks:
  after_create: "printf after_create:$AIHUB_EXIT_CODE >> ${marker}"
  before_run: "printf '|before_run:'$AIHUB_ISSUE_IDENTIFIER >> ${marker}"
  after_run: "printf '|after_run:'$AIHUB_EXIT_CODE >> ${marker}"
  before_remove: "printf '|before_remove:'$AIHUB_WORKSPACE >> ${marker}"
---
Do work
`);
    const store = new StateStore(path.join(root, "state.db"));
    store.bootstrap();
    const claims = new ClaimsRegistry();
    let state = "Ready";
    let subagentStatus = "running";
    const client = {
      rateLimitRemaining: 99,
      pollIssues: vi.fn(async () => [{ id: "lin_hooks", identifier: "ENG-2", title: "Hooks", state, labels: [] }]),
      commentCreate: vi.fn(),
      issueUpdateStateByName: vi.fn(),
    } as any;
    const ctx = {
      getDataDir: () => root,
      getConfig: () => ({ extensions: { subagents: { profiles }, orchestrator: { teamKey: "ENG" } } }),
      emit: vi.fn(),
    } as any;
    const daemon = new OrchestratorDaemon({
      ctx,
      client,
      store,
      claims,
      getConfig: () => ({ teamKey: "ENG" }),
      startSubagent: vi.fn(async () => ({ id: "sub_hooks" })),
      getSubagentRun: vi.fn(async () => ({ id: "sub_hooks", status: subagentStatus, exitCode: 7 })),
    });

    await daemon.tick();
    await daemon.tick();
    subagentStatus = "done";
    await daemon.tick();
    state = "Done";
    await daemon.tick();

    const log = await fs.readFile(marker, "utf8");
    expect(log).toContain("after_create:");
    expect(log).toContain("|before_run:ENG-2");
    expect(log).toContain("|after_run:7");
    expect(log).toContain("|before_remove:");
    await expect(fs.stat(path.join(root, "workspaces", "eng-2"))).rejects.toThrow();
    store.close();
  });

  it("coalesces queued ticks and batches HITL notifications", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aih-orch-queue-"));
    await fs.writeFile(path.join(root, "WORKFLOW.md"), "---\nagent:\n  default_profile: default\ntracker:\n  states:\n    active: [Ready]\n---\nDo it\n");
    const store = new StateStore(path.join(root, "state.db"));
    store.bootstrap();
    const claims = new ClaimsRegistry();
    let resolvePoll: (() => void) | undefined;
    const pollGate = new Promise<void>((resolve) => { resolvePoll = resolve; });
    let polls = 0;
    const client = {
      pollIssues: vi.fn(async () => {
        polls += 1;
        if (polls === 1) await pollGate;
        return [];
      }),
      commentCreate: vi.fn(),
      issueUpdateStateByName: vi.fn(),
    } as any;
    const sent: string[] = [];
    const ctx = {
      getDataDir: () => root,
      getConfig: () => ({ extensions: { subagents: { profiles }, orchestrator: { teamKey: "ENG", notifyChannel: "ops" } } }),
      emit: vi.fn(),
    } as any;
    const daemon = new OrchestratorDaemon({ ctx, client, store, claims, getConfig: () => ({ teamKey: "ENG", notifyChannel: "ops" }), startSubagent: vi.fn(), notify: async (message) => { sent.push(message); } });
    daemon.enqueueTick();
    daemon.enqueueTick();
    resolvePoll?.();
    await vi.waitFor(() => expect(polls).toBe(2));

    for (let i = 0; i < 5; i += 1) daemon.notifyRunFailed(`ENG-${i}`, "boom");
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toContain("ENG-0");
    expect(sent[0]).toContain("ENG-4");
    store.close();
  });

  it("bootstraps sqlite state", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aih-orch-db-"));
    const store = new StateStore(path.join(root, "state.db"));
    store.bootstrap();
    store.insertRun({ runId: "r1", issueId: "i1", identifier: "ENG-1", workspace: root, repo: null, branch: null, profileJson: "{}", workflowPath: "WORKFLOW.md", workflowSha: "abc", pid: 1, startedAt: new Date().toISOString() });
    store.appendEvent("r1", "x", { ok: true });
    expect(store.listRecent(1)).toHaveLength(1);
    expect(store.listEvents("r1")).toHaveLength(1);
    store.finishRun("r1", "done", 0);
    store.close();
  });
});
