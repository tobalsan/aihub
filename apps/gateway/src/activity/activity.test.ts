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
  let api: { request: (input: RequestInfo, init?: RequestInit) => Response | Promise<Response> };
  let prevHome: string | undefined;
  let prevUserProfile: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aihub-activity-"));

    prevHome = process.env.HOME;
    prevUserProfile = process.env.USERPROFILE;
    process.env.HOME = tmpDir;
    process.env.USERPROFILE = tmpDir;

    const configDir = path.join(tmpDir, ".aihub");
    await fs.mkdir(configDir, { recursive: true });
    const config = {
      agents: [agentConfig],
      projects: { root: path.join(tmpDir, "projects") },
    };
    await fs.writeFile(path.join(configDir, "aihub.json"), JSON.stringify(config, null, 2));

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

  it("persists activity across restarts", async () => {
    const createRes = await Promise.resolve(api.request("/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Activity Test" }),
    }));
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const patchRes = await Promise.resolve(api.request(`/projects/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "in_progress", agent: "Avery" }),
    }));
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
    expect(activityData.events.some((event: { actor?: string }) => event.actor === "Avery")).toBe(true);
  });

  it("includes agent name in activity feed", async () => {
    const createRes = await Promise.resolve(api.request("/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Agent Activity" }),
    }));
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const patchRes = await Promise.resolve(api.request(`/projects/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "in_progress", agent: "Morgan" }),
    }));
    expect(patchRes.status).toBe(200);

    const activityRes = await Promise.resolve(api.request("/activity"));
    expect(activityRes.status).toBe(200);
    const activityData = await activityRes.json();
    const match = activityData.events.find((event: { actor?: string }) => event.actor === "Morgan");
    expect(match?.action).toBe(`moved ${created.id} to In Progress`);
  });
});
