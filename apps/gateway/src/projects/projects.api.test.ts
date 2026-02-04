import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import os from "node:os";

describe("projects API", () => {
  let tmpDir: string;
  let projectsRoot: string;
  let api: { request: (input: RequestInfo, init?: RequestInit) => Response | Promise<Response> };
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
    const createRes = await Promise.resolve(api.request("/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Add Project Mgmt v1",
      }),
    }));

    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    const createdDir = path.join(projectsRoot, created.path);
    const createdReadme = path.join(createdDir, "README.md");
    const createdThread = path.join(createdDir, "THREAD.md");

    await expect(fs.stat(createdDir)).resolves.toBeDefined();
    await expect(fs.stat(createdReadme)).resolves.toBeDefined();
    await expect(fs.stat(createdThread)).resolves.toBeDefined();

    const listRes = await Promise.resolve(api.request("/projects"));
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(created.id);

    const getRes = await Promise.resolve(api.request(`/projects/${created.id}`));
    expect(getRes.status).toBe(200);
    const fetched = await getRes.json();
    expect(fetched.docs.README).toContain("# Add Project Mgmt v1");

    const updateRes = await Promise.resolve(api.request(`/projects/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Project Mgmt API",
        readme: "# Project Mgmt API\n\nOverview.\n",
        specs: "# Project Mgmt API Specs\n\nUpdated content.\n",
        status: "shaping",
        repo: "/tmp/repo",
      }),
    }));

    expect(updateRes.status).toBe(200);
    const updated = await updateRes.json();
    const updatedDir = path.join(projectsRoot, updated.path);
    const updatedReadme = path.join(updatedDir, "README.md");
    const updatedSpecs = path.join(updatedDir, "SPECS.md");

    await expect(fs.stat(updatedDir)).resolves.toBeDefined();
    await expect(fs.stat(updatedReadme)).resolves.toBeDefined();
    await expect(fs.stat(updatedSpecs)).resolves.toBeDefined();
    await expect(fs.access(createdDir)).rejects.toBeDefined();

    const updatedContent = await fs.readFile(updatedReadme, "utf8");
    const updatedSpecsContent = await fs.readFile(updatedSpecs, "utf8");
    expect(updatedContent).toContain("# Project Mgmt API");
    expect(updatedContent).toContain('status: "shaping"');
    expect(updatedSpecsContent).toContain("# Project Mgmt API Specs");
  });

  it("rejects invalid create payloads", async () => {
    const invalidDomain = await Promise.resolve(api.request("/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Valid Project",
        domain: "invalid",
      }),
    }));

    expect(invalidDomain.status).toBe(400);

    const invalidTitle = await Promise.resolve(api.request("/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Solo",
      }),
    }));

    expect(invalidTitle.status).toBe(400);
    const invalidTitleBody = await invalidTitle.json();
    expect(invalidTitleBody.error).toContain("Title must contain at least two words");
  });

  it("creates project with metadata", async () => {
    const createRes = await Promise.resolve(api.request("/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Metadata Project",
        description: "Track the new form fields.",
        domain: "admin",
        owner: "ops",
        executionMode: "exploratory",
        appetite: "small",
        status: "todo",
      }),
    }));

    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.frontmatter.domain).toBe("admin");
    expect(created.frontmatter.owner).toBe("ops");
    expect(created.frontmatter.executionMode).toBe("exploratory");
    expect(created.frontmatter.appetite).toBe("small");
    expect(created.frontmatter.status).toBe("todo");

    const readmePath = path.join(projectsRoot, created.path, "README.md");
    const readme = await fs.readFile(readmePath, "utf8");
    expect(readme).toContain("# Metadata Project");
    expect(readme).toContain("Track the new form fields.");
    expect(readme).toContain('domain: "admin"');
    expect(readme).toContain('owner: "ops"');
    expect(readme).toContain('executionMode: "exploratory"');
    expect(readme).toContain('appetite: "small"');
    expect(readme).toContain('status: "todo"');
  });

  it("appends thread comments via API", async () => {
    const createRes = await Promise.resolve(api.request("/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Threaded Project",
      }),
    }));

    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const commentRes = await Promise.resolve(api.request(`/projects/${created.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        author: "cto",
        message: "First note.",
      }),
    }));

    expect(commentRes.status).toBe(201);
    const threadPath = path.join(projectsRoot, created.path, "THREAD.md");
    const thread = await fs.readFile(threadPath, "utf8");
    expect(thread).toContain("[author:cto]");
    expect(thread).toContain("First note.");

    const getRes = await Promise.resolve(api.request(`/projects/${created.id}`));
    const fetched = await getRes.json();
    expect(fetched.thread.length).toBe(1);
    expect(fetched.thread[0]?.author).toBe("cto");
  });

  it("updates thread comments via PATCH endpoint", async () => {
    const createRes = await Promise.resolve(api.request("/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Update Comment Project",
      }),
    }));

    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    await Promise.resolve(api.request(`/projects/${created.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ author: "alice", message: "Original message" }),
    }));

    const updateRes = await Promise.resolve(api.request(`/projects/${created.id}/comments/0`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: "Updated message" }),
    }));

    expect(updateRes.status).toBe(200);
    const updated = await updateRes.json();
    expect(updated.author).toBe("alice");
    expect(updated.body).toBe("Updated message");

    const getRes = await Promise.resolve(api.request(`/projects/${created.id}`));
    const fetched = await getRes.json();
    expect(fetched.thread[0]?.body).toBe("Updated message");
  });

  it("deletes a project and moves it to trash", async () => {
    const createRes = await Promise.resolve(api.request("/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Delete Me Project" }),
    }));

    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    const createdDir = path.join(projectsRoot, created.path);
    const trashRoot = path.join(projectsRoot, ".trash");

    await expect(fs.stat(createdDir)).resolves.toBeDefined();
    await expect(fs.stat(trashRoot)).rejects.toBeDefined();

    const deleteRes = await Promise.resolve(api.request(`/projects/${created.id}`, {
      method: "DELETE",
    }));

    expect(deleteRes.status).toBe(200);
    const deleted = await deleteRes.json();
    expect(deleted.id).toBe(created.id);
    expect(deleted.path).toBe(created.path);
    expect(deleted.trashedPath).toBe(path.join(".trash", created.path));

    const trashedDir = path.join(projectsRoot, deleted.trashedPath);
    await expect(fs.access(createdDir)).rejects.toBeDefined();
    await expect(fs.stat(trashedDir)).resolves.toBeDefined();
  });

  it("archives and unarchives a project", async () => {
    const createRes = await Promise.resolve(api.request("/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Archive API Project" }),
    }));

    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    const createdDir = path.join(projectsRoot, created.path);

    await expect(fs.stat(createdDir)).resolves.toBeDefined();

    const archiveRes = await Promise.resolve(api.request(`/projects/${created.id}/archive`, {
      method: "POST",
    }));

    expect(archiveRes.status).toBe(200);
    const archived = await archiveRes.json();
    const archivedDir = path.join(projectsRoot, archived.archivedPath);

    await expect(fs.access(createdDir)).rejects.toBeDefined();
    await expect(fs.stat(archivedDir)).resolves.toBeDefined();

    const unarchiveRes = await Promise.resolve(api.request(`/projects/${created.id}/unarchive`, {
      method: "POST",
    }));

    expect(unarchiveRes.status).toBe(200);
    const unarchived = await unarchiveRes.json();
    expect(unarchived.id).toBe(created.id);

    await expect(fs.access(archivedDir)).rejects.toBeDefined();
    await expect(fs.stat(createdDir)).resolves.toBeDefined();
  });
});
