import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import os from "node:os";
import { createSlice, getSlice, updateSlice } from "./slices.js";

let clearProjectsContextForTest: (() => void) | undefined;

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
    const { setProjectsContext, clearProjectsContext } =
      await import("../context.js");
    clearProjectsContextForTest = clearProjectsContext;
    setProjectsContext({
      getConfig: () => ({
        version: 2,
        agents: [],
        extensions: { projects: { enabled: true, root: projectsRoot } },
      }),
      getDataDir: () => path.join(tmpDir, ".aihub"),
      getAgents: () => [],
      getAgent: () => undefined,
      isAgentActive: () => true,
      isAgentStreaming: () => false,
      resolveWorkspaceDir: () => tmpDir,
      runAgent: async () => ({ ok: true as const, data: {} }),
      getSubagentTemplates: () => [],
      resolveSessionId: async () => undefined,
      getSessionEntry: async () => undefined,
      clearSessionEntry: async () => undefined,
      restoreSessionUpdatedAt: () => {},
      deleteSession: () => {},
      invalidateHistoryCache: async () => {},
      getSessionHistory: async () => [],
      subscribe: () => () => {},
      emit: () => {},
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    } as never);
  });

  afterEach(async () => {
    clearProjectsContextForTest?.();
    clearProjectsContextForTest = undefined;
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevUserProfile;

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function createGitRepo(repoPath: string): Promise<void> {
    await fs.mkdir(path.join(repoPath, ".git"), { recursive: true });
  }

  it("creates projects with metadata and increments ids", async () => {
    const { createProject, listProjects, getProject } =
      await import("./store.js");
    const config = {
      agents: [],
      sessions: { idleMinutes: 360 },
      projects: { root: projectsRoot },
    };

    const firstResult = await createProject(config, {
      title: "Alpha Project",
      description: "Ship it.",
      status: "active",
    });
    if (!firstResult.ok) throw new Error(firstResult.error);

    const secondResult = await createProject(config, {
      title: "Beta Project",
    });
    if (!secondResult.ok) throw new Error(secondResult.error);

    expect(firstResult.data.id).toBe("PRO-1");
    expect(secondResult.data.id).toBe("PRO-2");

    const readmePath = path.join(
      projectsRoot,
      firstResult.data.path,
      "README.md"
    );
    const threadPath = path.join(
      projectsRoot,
      firstResult.data.path,
      "THREAD.md"
    );
    const readme = await fs.readFile(readmePath, "utf8");
    const thread = await fs.readFile(threadPath, "utf8");
    expect(readme).toContain('status: "active"');
    expect(readme).toContain("# Alpha Project");
    expect(readme).toContain("Ship it.");
    expect(thread).toContain("project: PRO-1");

    const stateRaw = await fs.readFile(
      path.join(tmpDir, ".aihub", "projects.json"),
      "utf8"
    );
    expect(JSON.parse(stateRaw)).toEqual({ lastId: 2 });

    const listResult = await listProjects(config);
    if (!listResult.ok) throw new Error(listResult.error);
    const ids = listResult.data.map((item) => item.id);
    expect(ids).toContain("PRO-1");
    expect(ids).toContain("PRO-2");
    expect(listResult.data.every((item) => item.repoValid === false)).toBe(
      true
    );

    const getResult = await getProject(config, firstResult.data.id);
    if (!getResult.ok) throw new Error(getResult.error);
    expect(getResult.data.repoValid).toBe(false);
    expect(getResult.data.docs.PITCH).toContain("Ship it.");
    expect(getResult.data.thread.length).toBe(0);
  });

  it("reads project pitch from PITCH.md and falls back to README body", async () => {
    const { createProject, getProject } = await import("./store.js");
    const config = {
      agents: [],
      sessions: { idleMinutes: 360 },
      projects: { root: projectsRoot },
    };

    const created = await createProject(config, { title: "Pitch Surface" });
    if (!created.ok) throw new Error(created.error);

    const projectDir = path.join(projectsRoot, created.data.path);
    await fs.writeFile(path.join(projectDir, "PITCH.md"), "# Pitch\n", "utf8");

    const withPitch = await getProject(config, created.data.id);
    if (!withPitch.ok) throw new Error(withPitch.error);
    expect(withPitch.data.docs.PITCH).toBe("# Pitch\n");
    expect(withPitch.data.docs.README).toBeUndefined();

    await fs.rm(path.join(projectDir, "PITCH.md"));
    const legacy = await getProject(config, created.data.id);
    if (!legacy.ok) throw new Error(legacy.error);
    expect(legacy.data.docs.PITCH).toContain("# Pitch Surface");
    expect(legacy.data.docs.README).toBeUndefined();
  });

  it("writes PITCH.md without changing README body", async () => {
    const { createProject, updateProject } = await import("./store.js");
    const config = {
      agents: [],
      sessions: { idleMinutes: 360 },
      projects: { root: projectsRoot },
    };

    const created = await createProject(config, { title: "Legacy Pitch" });
    if (!created.ok) throw new Error(created.error);

    const projectDir = path.join(projectsRoot, created.data.path);
    const readmePath = path.join(projectDir, "README.md");
    const originalReadme = await fs.readFile(readmePath, "utf8");

    const updated = await updateProject(config, created.data.id, {
      docs: { PITCH: "# New Pitch\n" },
    });
    if (!updated.ok) throw new Error(updated.error);

    expect(await fs.readFile(path.join(projectDir, "PITCH.md"), "utf8")).toBe(
      "# New Pitch\n"
    );
    expect(await fs.readFile(readmePath, "utf8")).toBe(originalReadme);
    expect(updated.data.docs.PITCH).toBe("# New Pitch\n");
  });

  it("rejects titles with fewer than two words", async () => {
    const { createProject } = await import("./store.js");
    const config = {
      agents: [],
      sessions: { idleMinutes: 360 },
      projects: { root: projectsRoot },
    };

    const result = await createProject(config, { title: "Solo" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("Title must contain at least two words");
  });

  it("moves deleted projects into trash and creates the trash folder", async () => {
    const { createProject, deleteProject } = await import("./store.js");
    const config = {
      agents: [],
      sessions: { idleMinutes: 360 },
      projects: { root: projectsRoot },
    };

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
    const { createProject, archiveProject, unarchiveProject } =
      await import("./store.js");
    const config = {
      agents: [],
      sessions: { idleMinutes: 360 },
      projects: { root: projectsRoot },
    };

    const created = await createProject(config, {
      title: "Archive Me Project",
    });
    if (!created.ok) throw new Error(created.error);

    const archiveResult = await archiveProject(config, created.data.id);
    expect(archiveResult.ok).toBe(true);
    if (!archiveResult.ok) return;

    const archiveRoot = path.join(projectsRoot, ".archive");
    const archivedDir = path.join(
      projectsRoot,
      archiveResult.data.archivedPath
    );
    const sourcePath = path.join(projectsRoot, created.data.path);

    await expect(fs.access(sourcePath)).rejects.toBeDefined();
    await expect(fs.stat(archiveRoot)).resolves.toBeDefined();
    await expect(fs.stat(archivedDir)).resolves.toBeDefined();

    const archivedReadme = await fs.readFile(
      path.join(archivedDir, "README.md"),
      "utf8"
    );
    expect(archivedReadme).toContain('status: "archived"');

    const unarchiveResult = await unarchiveProject(
      config,
      created.data.id,
      "shaping"
    );
    expect(unarchiveResult.ok).toBe(true);
    if (!unarchiveResult.ok) return;

    const activeDir = path.join(projectsRoot, created.data.path);
    await expect(fs.access(archivedDir)).rejects.toBeDefined();
    await expect(fs.stat(activeDir)).resolves.toBeDefined();

    const activeReadme = await fs.readFile(
      path.join(activeDir, "README.md"),
      "utf8"
    );
    expect(activeReadme).toContain('status: "shaping"');
  });

  it("moves completed projects to .done and keeps them resolvable", async () => {
    const { createProject, updateProject, getProject, listProjects } =
      await import("./store.js");
    const config = {
      agents: [],
      sessions: { idleMinutes: 360 },
      projects: { root: projectsRoot },
    };

    const created = await createProject(config, {
      title: "Complete Me Project",
    });
    if (!created.ok) throw new Error(created.error);

    const done = await updateProject(config, created.data.id, {
      status: "done",
    });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.data.path).toBe(path.join(".done", created.data.path));

    const donePath = path.join(projectsRoot, done.data.path);
    await expect(
      fs.access(path.join(projectsRoot, created.data.path))
    ).rejects.toBeDefined();
    await expect(fs.stat(donePath)).resolves.toBeDefined();

    const detail = await getProject(config, created.data.id);
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.data.path).toBe(path.join(".done", created.data.path));

    const list = await listProjects(config);
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.data.map((item) => item.path)).toContain(
      path.join(".done", created.data.path)
    );

    const reopened = await updateProject(config, created.data.id, {
      status: "shaping",
    });
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(reopened.data.path).toBe(created.data.path);
    await expect(
      fs.stat(path.join(projectsRoot, created.data.path))
    ).resolves.toBeDefined();
  });

  it("updates thread comments preserving author and date", async () => {
    const {
      createProject,
      appendProjectComment,
      updateProjectComment,
      getProject,
    } = await import("./store.js");
    const config = {
      agents: [],
      sessions: { idleMinutes: 360 },
      projects: { root: projectsRoot },
    };

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

    const updated = await updateProjectComment(
      config,
      created.data.id,
      0,
      "Updated first comment"
    );
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

  it("keeps runAgent/runMode/baseBranch in frontmatter after updateProject", async () => {
    const { createProject, updateProject } = await import("./store.js");
    const config = {
      agents: [],
      sessions: { idleMinutes: 360 },
      projects: { root: projectsRoot },
    };

    const created = await createProject(config, {
      title: "Frontmatter Persist",
    });
    if (!created.ok) throw new Error(created.error);

    const readmePath = path.join(projectsRoot, created.data.path, "README.md");
    const originalReadme = await fs.readFile(readmePath, "utf8");
    const seededReadme = originalReadme.replace(
      'id: "PRO-1"',
      'id: "PRO-1"\nrunAgent: "cloud"\nrunMode: "worktree"\nbaseBranch: "main"'
    );
    await fs.writeFile(readmePath, seededReadme, "utf8");

    const updated = await updateProject(config, created.data.id, {
      status: "active",
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;

    const nextReadme = await fs.readFile(readmePath, "utf8");
    expect(nextReadme).toContain('runAgent: "cloud"');
    expect(nextReadme).toContain('runMode: "worktree"');
    expect(nextReadme).toContain('baseBranch: "main"');
    expect(nextReadme).toContain('status: "active"');
  });

  it("inherits repo from area when project repo is missing", async () => {
    const { createProject, updateProject, getProject } =
      await import("./store.js");
    const config = {
      agents: [],
      sessions: { idleMinutes: 360 },
      projects: { root: projectsRoot },
    };

    const repoPath = path.join(tmpDir, "code", "aihub");
    await createGitRepo(repoPath);

    await fs.mkdir(path.join(projectsRoot, ".areas"), { recursive: true });
    await fs.writeFile(
      path.join(projectsRoot, ".areas", "aihub.yaml"),
      'id: "aihub"\ntitle: "AIHub"\ncolor: "#3b8ecc"\nrepo: "~/code/aihub"\n',
      "utf8"
    );

    const created = await createProject(config, { title: "Repo Inherit" });
    if (!created.ok) throw new Error(created.error);

    const withArea = await updateProject(config, created.data.id, {
      area: "aihub",
    });
    expect(withArea.ok).toBe(true);
    if (!withArea.ok) return;
    expect(withArea.data.frontmatter.repo).toBe("~/code/aihub");
    expect(withArea.data.repoValid).toBe(true);

    const fetched = await getProject(config, created.data.id);
    expect(fetched.ok).toBe(true);
    if (!fetched.ok) return;
    expect(fetched.data.frontmatter.repo).toBe("~/code/aihub");
    expect(fetched.data.repoValid).toBe(true);

    const withRepo = await updateProject(config, created.data.id, {
      repo: "/tmp/custom-repo",
    });
    expect(withRepo.ok).toBe(true);
    if (!withRepo.ok) return;
    expect(withRepo.data.frontmatter.repo).toBe("/tmp/custom-repo");
    expect(withRepo.data.repoValid).toBe(false);
  });

  it("marks repoValid false when repo path is missing or not a git repo", async () => {
    const { createProject, updateProject, getProject, listProjects } =
      await import("./store.js");
    const config = {
      agents: [],
      sessions: { idleMinutes: 360 },
      projects: { root: projectsRoot },
    };

    const created = await createProject(config, { title: "Invalid Repo" });
    if (!created.ok) throw new Error(created.error);

    const noRepo = await getProject(config, created.data.id);
    if (!noRepo.ok) throw new Error(noRepo.error);
    expect(noRepo.data.repoValid).toBe(false);

    const missingRepo = await updateProject(config, created.data.id, {
      repo: path.join(tmpDir, "missing-repo"),
    });
    expect(missingRepo.ok).toBe(true);
    if (!missingRepo.ok) return;
    expect(missingRepo.data.repoValid).toBe(false);

    const plainDir = path.join(tmpDir, "plain-dir");
    await fs.mkdir(plainDir, { recursive: true });
    const plainRepo = await updateProject(config, created.data.id, {
      repo: plainDir,
    });
    expect(plainRepo.ok).toBe(true);
    if (!plainRepo.ok) return;
    expect(plainRepo.data.repoValid).toBe(false);

    const list = await listProjects(config);
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.data[0]?.repoValid).toBe(false);
  });

  it("rejects legacy project statuses with migration hint", async () => {
    const { createProject, updateProject } = await import("./store.js");
    const config = {
      agents: [],
      sessions: { idleMinutes: 360 },
      projects: { root: projectsRoot },
    };

    const created = await createProject(config, {
      title: "Legacy Status Reject",
      status: "todo",
    });
    expect(created.ok).toBe(false);
    if (created.ok) return;
    expect(created.error).toContain("migrate-to-slices");

    const valid = await createProject(config, {
      title: "Legacy Status Holder",
    });
    if (!valid.ok) throw new Error(valid.error);

    const updated = await updateProject(config, valid.data.id, {
      status: "review",
    });
    expect(updated.ok).toBe(false);
    if (updated.ok) return;
    expect(updated.error).toContain("migrate-to-slices");
  });

  it("surfaces legacy-status migration hint in project list scans", async () => {
    const { listProjects } = await import("./store.js");
    const config = {
      agents: [],
      sessions: { idleMinutes: 360 },
      projects: { root: projectsRoot },
    };

    const legacyDir = path.join(projectsRoot, "PRO-99_legacy");
    await fs.mkdir(legacyDir, { recursive: true });
    await fs.writeFile(
      path.join(legacyDir, "README.md"),
      '---\nid: "PRO-99"\ntitle: "Legacy"\nstatus: "todo"\n---\n# Legacy\n',
      "utf8"
    );

    const listed = await listProjects(config);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    const item = listed.data.find((entry) => entry.id === "PRO-99");
    expect(item).toBeDefined();
    expect(item?.frontmatter.statusValidationError).toContain(
      "migrate-to-slices"
    );
  });

  it("cancels non-terminal slices and keeps done slices unchanged", async () => {
    const { createProject, updateProject } = await import("./store.js");
    const config = {
      agents: [],
      sessions: { idleMinutes: 360 },
      projects: { root: projectsRoot },
    };

    const created = await createProject(config, {
      title: "Cascade Cancel Project",
    });
    if (!created.ok) throw new Error(created.error);
    const projectDir = path.join(projectsRoot, created.data.path);

    const doneSlice = await createSlice(projectDir, {
      projectId: created.data.id,
      title: "done",
      status: "done",
    });
    const todoSlice = await createSlice(projectDir, {
      projectId: created.data.id,
      title: "todo",
      status: "todo",
    });

    const cancelled = await updateProject(config, created.data.id, {
      status: "cancelled",
    });
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;

    const cancelledProjectDir = cancelled.data.absolutePath;
    const doneAfter = await getSlice(cancelledProjectDir, doneSlice.id);
    const todoAfter = await getSlice(cancelledProjectDir, todoSlice.id);
    expect(doneAfter.frontmatter.status).toBe("done");
    expect(todoAfter.frontmatter.status).toBe("cancelled");
  });

  it("auto-marks active project done when all slices terminal and at least one done", async () => {
    const { createProject, updateProject, getProject } =
      await import("./store.js");
    const config = {
      agents: [],
      sessions: { idleMinutes: 360 },
      projects: { root: projectsRoot },
    };

    const created = await createProject(config, { title: "Auto Done Project" });
    if (!created.ok) throw new Error(created.error);
    await updateProject(config, created.data.id, { status: "active" });

    const projectDir = path.join(projectsRoot, created.data.path);
    const first = await createSlice(projectDir, {
      projectId: created.data.id,
      title: "first",
      status: "in_progress",
    });
    await createSlice(projectDir, {
      projectId: created.data.id,
      title: "second",
      status: "cancelled",
    });

    await updateSlice(projectDir, first.id, { status: "done" });

    const detail = await getProject(config, created.data.id);
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.data.frontmatter.status).toBe("done");
  });

  it("includes repoValid in archived project list items", async () => {
    const {
      createProject,
      updateProject,
      archiveProject,
      listArchivedProjects,
    } = await import("./store.js");
    const config = {
      agents: [],
      sessions: { idleMinutes: 360 },
      projects: { root: projectsRoot },
    };

    const repoPath = path.join(tmpDir, "repo-archive");
    await createGitRepo(repoPath);

    const created = await createProject(config, { title: "Archive Repo" });
    if (!created.ok) throw new Error(created.error);

    const updated = await updateProject(config, created.data.id, {
      repo: repoPath,
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;

    const archived = await archiveProject(config, created.data.id);
    expect(archived.ok).toBe(true);
    if (!archived.ok) return;

    const list = await listArchivedProjects(config);
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.data).toHaveLength(1);
    expect(list.data[0]?.repoValid).toBe(true);
  });
});
