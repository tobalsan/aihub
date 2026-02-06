import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import os from "node:os";

describe("projects store", () => {
  let tmpDir: string;
  let projectsRoot: string;
  let prevHome: string | undefined;
  let prevUserProfile: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aihub-projects-store-"));
    projectsRoot = path.join(tmpDir, "projects");

    prevHome = process.env.HOME;
    prevUserProfile = process.env.USERPROFILE;
    process.env.HOME = tmpDir;
    process.env.USERPROFILE = tmpDir;

    vi.resetModules();
  });

  afterEach(async () => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevUserProfile;

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates projects with metadata and increments ids", async () => {
    const { createProject, listProjects, getProject } = await import("./store.js");
    const config = { agents: [], sessions: { idleMinutes: 360 }, projects: { root: projectsRoot } };

    const firstResult = await createProject(config, {
      title: "Alpha Project",
      description: "Ship it.",
      domain: "coding",
      owner: "me",
      executionMode: "subagent",
      appetite: "big",
      status: "todo",
    });
    if (!firstResult.ok) throw new Error(firstResult.error);

    const secondResult = await createProject(config, {
      title: "Beta Project",
    });
    if (!secondResult.ok) throw new Error(secondResult.error);

    expect(firstResult.data.id).toBe("PRO-1");
    expect(secondResult.data.id).toBe("PRO-2");

    const readmePath = path.join(projectsRoot, firstResult.data.path, "README.md");
    const threadPath = path.join(projectsRoot, firstResult.data.path, "THREAD.md");
    const readme = await fs.readFile(readmePath, "utf8");
    const thread = await fs.readFile(threadPath, "utf8");
    expect(readme).toContain('domain: "coding"');
    expect(readme).toContain('owner: "me"');
    expect(readme).toContain('executionMode: "subagent"');
    expect(readme).toContain('appetite: "big"');
    expect(readme).toContain('status: "todo"');
    expect(readme).toContain("# Alpha Project");
    expect(readme).toContain("Ship it.");
    expect(thread).toContain("project: PRO-1");

    const stateRaw = await fs.readFile(path.join(tmpDir, ".aihub", "projects.json"), "utf8");
    expect(JSON.parse(stateRaw)).toEqual({ lastId: 2 });

    const listResult = await listProjects(config);
    if (!listResult.ok) throw new Error(listResult.error);
    const ids = listResult.data.map((item) => item.id);
    expect(ids).toContain("PRO-1");
    expect(ids).toContain("PRO-2");

    const getResult = await getProject(config, firstResult.data.id);
    if (!getResult.ok) throw new Error(getResult.error);
    expect(getResult.data.frontmatter.domain).toBe("coding");
    expect(getResult.data.docs.README).toContain("Ship it.");
    expect(getResult.data.thread.length).toBe(0);
  });

  it("rejects titles with fewer than two words", async () => {
    const { createProject } = await import("./store.js");
    const config = { agents: [], sessions: { idleMinutes: 360 }, projects: { root: projectsRoot } };

    const result = await createProject(config, { title: "Solo" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("Title must contain at least two words");
  });

  it("moves deleted projects into trash and creates the trash folder", async () => {
    const { createProject, deleteProject } = await import("./store.js");
    const config = { agents: [], sessions: { idleMinutes: 360 }, projects: { root: projectsRoot } };

    const created = await createProject(config, { title: "Trash Project" });
    if (!created.ok) throw new Error(created.error);

    const trashRoot = path.join(projectsRoot, ".trash");
    await expect(fs.stat(trashRoot)).rejects.toBeDefined();

    const deleted = await deleteProject(config, created.data.id);
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;

    const sourcePath = path.join(projectsRoot, created.data.path);
    const targetPath = path.join(projectsRoot, deleted.data.trashedPath);

    await expect(fs.access(sourcePath)).rejects.toBeDefined();
    await expect(fs.stat(targetPath)).resolves.toBeDefined();
    await expect(fs.stat(trashRoot)).resolves.toBeDefined();
  });

  it("archives and unarchives projects", async () => {
    const { createProject, archiveProject, unarchiveProject } = await import("./store.js");
    const config = { agents: [], sessions: { idleMinutes: 360 }, projects: { root: projectsRoot } };

    const created = await createProject(config, { title: "Archive Me Project" });
    if (!created.ok) throw new Error(created.error);

    const archiveResult = await archiveProject(config, created.data.id);
    expect(archiveResult.ok).toBe(true);
    if (!archiveResult.ok) return;

    const archiveRoot = path.join(projectsRoot, ".archive");
    const archivedDir = path.join(projectsRoot, archiveResult.data.archivedPath);
    const sourcePath = path.join(projectsRoot, created.data.path);

    await expect(fs.access(sourcePath)).rejects.toBeDefined();
    await expect(fs.stat(archiveRoot)).resolves.toBeDefined();
    await expect(fs.stat(archivedDir)).resolves.toBeDefined();

    const archivedReadme = await fs.readFile(path.join(archivedDir, "README.md"), "utf8");
    expect(archivedReadme).toContain('status: "archived"');

    const unarchiveResult = await unarchiveProject(config, created.data.id, "maybe");
    expect(unarchiveResult.ok).toBe(true);
    if (!unarchiveResult.ok) return;

    const activeDir = path.join(projectsRoot, created.data.path);
    await expect(fs.access(archivedDir)).rejects.toBeDefined();
    await expect(fs.stat(activeDir)).resolves.toBeDefined();

    const activeReadme = await fs.readFile(path.join(activeDir, "README.md"), "utf8");
    expect(activeReadme).toContain('status: "maybe"');
  });

  it("updates thread comments preserving author and date", async () => {
    const { createProject, appendProjectComment, updateProjectComment, getProject } = await import("./store.js");
    const config = { agents: [], sessions: { idleMinutes: 360 }, projects: { root: projectsRoot } };

    const created = await createProject(config, { title: "Comment Test" });
    if (!created.ok) throw new Error(created.error);

    await appendProjectComment(config, created.data.id, {
      author: "Alice",
      date: "2025-01-01 10:00",
      body: "First comment",
    });

    await appendProjectComment(config, created.data.id, {
      author: "Bob",
      date: "2025-01-02 11:00",
      body: "Second comment",
    });

    const updated = await updateProjectComment(config, created.data.id, 0, "Updated first comment");
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.data.author).toBe("Alice");
    expect(updated.data.date).toBe("2025-01-01 10:00");
    expect(updated.data.body).toBe("Updated first comment");

    const project = await getProject(config, created.data.id);
    if (!project.ok) throw new Error(project.error);
    expect(project.data.thread.length).toBe(2);
    expect(project.data.thread[0].body).toBe("Updated first comment");
    expect(project.data.thread[1].body).toBe("Second comment");
  });
});
