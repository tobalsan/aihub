import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import os from "node:os";

const agentConfig = {
  id: "test-agent",
  name: "Test Agent",
  workspace: "~/test",
  model: { provider: "anthropic", model: "claude-3-5-sonnet-20241022" },
};

describe("activity persistence", () => {
  let tmpDir: string;
  let projectsRoot: string;
  let api: {
    request: (
      input: RequestInfo,
      init?: RequestInit
    ) => Response | Promise<Response>;
  };
  let prevHome: string | undefined;
  let prevUserProfile: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aihub-activity-"));

    prevHome = process.env.HOME;
    prevUserProfile = process.env.USERPROFILE;
    process.env.HOME = tmpDir;
    process.env.USERPROFILE = tmpDir;
    projectsRoot = path.join(tmpDir, "projects");

    const configDir = path.join(tmpDir, ".aihub");
    await fs.mkdir(configDir, { recursive: true });
    const config = {
      agents: [agentConfig],
      projects: { root: projectsRoot },
    };
    await fs.writeFile(
      path.join(configDir, "aihub.json"),
      JSON.stringify(config, null, 2)
    );

    vi.resetModules();
    const mod = await import("../server/api.js");
    api = mod.api;
  });

  afterEach(async () => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevUserProfile;

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function createProject(
    title: string
  ): Promise<{ id: string; path: string }> {
    const res = await Promise.resolve(
      api.request("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      })
    );
    expect(res.status).toBe(201);
    return (await res.json()) as { id: string; path: string };
  }

  async function setupSubagentRun(params: {
    projectPath: string;
    slug: string;
    startedAt: string;
    lastActive: string;
  }): Promise<string> {
    const sessionDir = path.join(
      projectsRoot,
      params.projectPath,
      "sessions",
      params.slug
    );
    await fs.mkdir(sessionDir, { recursive: true });
    await fs.writeFile(
      path.join(sessionDir, "config.json"),
      JSON.stringify({ cli: "codex" }, null, 2)
    );
    await fs.writeFile(
      path.join(sessionDir, "state.json"),
      JSON.stringify(
        {
          supervisor_pid: process.pid,
          started_at: params.startedAt,
          cli: "codex",
        },
        null,
        2
      )
    );
    const progressPath = path.join(sessionDir, "progress.json");
    await fs.writeFile(
      progressPath,
      JSON.stringify({ last_active: params.lastActive }, null, 2)
    );
    return progressPath;
  }

  it("persists activity across restarts", async () => {
    const createRes = await Promise.resolve(
      api.request("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Activity Test" }),
      })
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const patchRes = await Promise.resolve(
      api.request(`/projects/${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "in_progress", agent: "Avery" }),
      })
    );
    expect(patchRes.status).toBe(200);

    const activityPath = path.join(tmpDir, ".aihub", "activity.json");
    const persistedRaw = await fs.readFile(activityPath, "utf8");
    const persisted = JSON.parse(persistedRaw) as Array<{ actor?: string }>;
    expect(persisted.some((event) => event.actor === "Avery")).toBe(true);

    vi.resetModules();
    const mod = await import("../server/api.js");
    const api2 = mod.api;

    const activityRes = await Promise.resolve(api2.request("/activity"));
    expect(activityRes.status).toBe(200);
    const activityData = await activityRes.json();
    expect(
      activityData.events.some(
        (event: { actor?: string }) => event.actor === "Avery"
      )
    ).toBe(true);
  });

  it("includes agent name in activity feed", async () => {
    const createRes = await Promise.resolve(
      api.request("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Agent Activity" }),
      })
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const patchRes = await Promise.resolve(
      api.request(`/projects/${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "in_progress", agent: "Morgan" }),
      })
    );
    expect(patchRes.status).toBe(200);

    const activityRes = await Promise.resolve(api.request("/activity"));
    expect(activityRes.status).toBe(200);
    const activityData = await activityRes.json();
    const match = activityData.events.find(
      (event: { actor?: string }) => event.actor === "Morgan"
    );
    expect(match?.action).toBe(`moved ${created.id} to In Progress`);
  });

  it("records comment activity", async () => {
    const { recordCommentActivity } = await import("./index.js");
    const longComment = "a".repeat(100);
    await recordCommentActivity({
      actor: "Jamie",
      projectId: "PRO-123",
      commentExcerpt: longComment,
      timestamp: "2025-01-01T00:00:00.000Z",
    });

    const activityPath = path.join(tmpDir, ".aihub", "activity.json");
    const persistedRaw = await fs.readFile(activityPath, "utf8");
    const persisted = JSON.parse(persistedRaw) as Array<{
      type?: string;
      actor?: string;
      action?: string;
      projectId?: string;
      timestamp?: string;
    }>;
    const match = persisted.find((event) => event.type === "project_comment");
    expect(match?.actor).toBe("Jamie");
    expect(match?.projectId).toBe("PRO-123");
    expect(match?.timestamp).toBe("2025-01-01T00:00:00.000Z");
    expect(match?.action).toBe(`commented on PRO-123: ${"a".repeat(79)}…`);
  });

  it("does not duplicate running subagent activity across heartbeat updates", async () => {
    const created = await createProject("Subagent Poll Dedup");
    const progressPath = await setupSubagentRun({
      projectPath: created.path,
      slug: "main",
      startedAt: "2026-02-07T10:00:00.000Z",
      lastActive: "2026-02-07T10:00:01.000Z",
    });

    const first = await Promise.resolve(api.request("/activity"));
    expect(first.status).toBe(200);

    await fs.writeFile(
      progressPath,
      JSON.stringify({ last_active: "2026-02-07T10:00:02.000Z" }, null, 2)
    );
    const second = await Promise.resolve(api.request("/activity"));
    expect(second.status).toBe(200);

    await fs.writeFile(
      progressPath,
      JSON.stringify({ last_active: "2026-02-07T10:00:03.000Z" }, null, 2)
    );
    const third = await Promise.resolve(api.request("/activity"));
    expect(third.status).toBe(200);
    const activityData = await third.json();
    const runningEvents = activityData.events.filter(
      (event: {
        type?: string;
        action?: string;
        projectId?: string;
        subagentSlug?: string;
      }) =>
        event.type === "subagent_action" &&
        event.action === "is running" &&
        event.projectId === created.id &&
        event.subagentSlug === "main"
    );
    expect(runningEvents).toHaveLength(1);
  });

  it("does not re-add running subagent activity after restart for same run", async () => {
    const created = await createProject("Subagent Restart Dedup");
    const progressPath = await setupSubagentRun({
      projectPath: created.path,
      slug: "main",
      startedAt: "2026-02-07T11:00:00.000Z",
      lastActive: "2026-02-07T11:00:01.000Z",
    });

    const first = await Promise.resolve(api.request("/activity"));
    expect(first.status).toBe(200);

    vi.resetModules();
    const mod = await import("../server/api.js");
    const api2 = mod.api;

    await fs.writeFile(
      progressPath,
      JSON.stringify({ last_active: "2026-02-07T11:00:02.000Z" }, null, 2)
    );
    const second = await Promise.resolve(api2.request("/activity"));
    expect(second.status).toBe(200);
    const activityData = await second.json();
    const runningEvents = activityData.events.filter(
      (event: {
        type?: string;
        action?: string;
        projectId?: string;
        subagentSlug?: string;
      }) =>
        event.type === "subagent_action" &&
        event.action === "is running" &&
        event.projectId === created.id &&
        event.subagentSlug === "main"
    );
    expect(runningEvents).toHaveLength(1);
  });

  it("records one running event per new subagent run", async () => {
    const created = await createProject("Subagent New Run");
    const slug = "main";
    const sessionDir = path.join(projectsRoot, created.path, "sessions", slug);
    const progressPath = await setupSubagentRun({
      projectPath: created.path,
      slug,
      startedAt: "2026-02-07T12:00:00.000Z",
      lastActive: "2026-02-07T12:00:01.000Z",
    });
    const statePath = path.join(sessionDir, "state.json");

    const first = await Promise.resolve(api.request("/activity"));
    expect(first.status).toBe(200);

    await fs.writeFile(
      statePath,
      JSON.stringify(
        {
          supervisor_pid: process.pid,
          started_at: "2026-02-07T12:30:00.000Z",
          cli: "codex",
        },
        null,
        2
      )
    );
    await fs.writeFile(
      progressPath,
      JSON.stringify({ last_active: "2026-02-07T12:30:01.000Z" }, null, 2)
    );
    const second = await Promise.resolve(api.request("/activity"));
    expect(second.status).toBe(200);
    const activityData = await second.json();
    const runningEvents = activityData.events.filter(
      (event: {
        id?: string;
        type?: string;
        action?: string;
        projectId?: string;
        subagentSlug?: string;
      }) =>
        event.type === "subagent_action" &&
        event.action === "is running" &&
        event.projectId === created.id &&
        event.subagentSlug === slug
    );
    expect(runningEvents).toHaveLength(2);
    expect(
      new Set(runningEvents.map((event: { id?: string }) => event.id)).size
    ).toBe(2);
  });
});
