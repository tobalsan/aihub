import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import os from "node:os";

describe("projects API", () => {
  let tmpDir: string;
  let projectsRoot: string;
  let api: { request: (input: RequestInfo, init?: RequestInit) => Promise<Response> };
  let prevHome: string | undefined;
  let prevUserProfile: string | undefined;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aihub-projects-"));
    projectsRoot = path.join(tmpDir, "projects");

    prevHome = process.env.HOME;
    prevUserProfile = process.env.USERPROFILE;
    process.env.HOME = tmpDir;
    process.env.USERPROFILE = tmpDir;

    const configDir = path.join(tmpDir, ".aihub");
    await fs.mkdir(configDir, { recursive: true });
    const config = {
      agents: [
        {
          id: "test-agent",
          name: "Test Agent",
          workspace: "~/test",
          model: { provider: "anthropic", model: "claude-3-5-sonnet-20241022" },
        },
      ],
      projects: { root: projectsRoot },
    };
    await fs.writeFile(path.join(configDir, "aihub.json"), JSON.stringify(config, null, 2));

    vi.resetModules();
    const mod = await import("../server/api.js");
    api = mod.api;
  });

  afterAll(async () => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevUserProfile;

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates and updates project files in temp root", async () => {
    const createRes = await api.request("/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Add Project Mgmt v1",
        domain: "coding",
        owner: "Thinh",
        executionMode: "exploratory",
        appetite: "small",
      }),
    });

    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    const createdDir = path.join(projectsRoot, created.path);
    const createdReadme = path.join(createdDir, "README.md");

    await expect(fs.stat(createdDir)).resolves.toBeDefined();
    await expect(fs.stat(createdReadme)).resolves.toBeDefined();

    const listRes = await api.request("/projects");
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(created.id);

    const getRes = await api.request(`/projects/${created.id}`);
    expect(getRes.status).toBe(200);
    const fetched = await getRes.json();
    expect(fetched.content).toContain("# Add Project Mgmt v1");

    const updateRes = await api.request(`/projects/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Project Mgmt API",
        content: "# Project Mgmt API\n\nUpdated content.\n",
        status: "shaping",
      }),
    });

    expect(updateRes.status).toBe(200);
    const updated = await updateRes.json();
    const updatedDir = path.join(projectsRoot, updated.path);
    const updatedReadme = path.join(updatedDir, "README.md");

    await expect(fs.stat(updatedDir)).resolves.toBeDefined();
    await expect(fs.stat(updatedReadme)).resolves.toBeDefined();
    await expect(fs.access(createdDir)).rejects.toBeDefined();

    const updatedContent = await fs.readFile(updatedReadme, "utf8");
    expect(updatedContent).toContain("# Project Mgmt API");
    expect(updatedContent).toContain("status: \"shaping\"");
  });
});
