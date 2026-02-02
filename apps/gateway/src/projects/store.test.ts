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
      executionMode: "auto",
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
    const readme = await fs.readFile(readmePath, "utf8");
    expect(readme).toContain('domain: "coding"');
    expect(readme).toContain('owner: "me"');
    expect(readme).toContain('executionMode: "auto"');
    expect(readme).toContain('appetite: "big"');
    expect(readme).toContain('status: "todo"');
    expect(readme).toContain("# Alpha Project");
    expect(readme).toContain("Ship it.");

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
    expect(getResult.data.content).toContain("Ship it.");
  });

  it("rejects titles with fewer than two words", async () => {
    const { createProject } = await import("./store.js");
    const config = { agents: [], sessions: { idleMinutes: 360 }, projects: { root: projectsRoot } };

    const result = await createProject(config, { title: "Solo" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("Title must contain at least two words");
  });
});
