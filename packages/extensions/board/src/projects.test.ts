import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanProjects, statusToGroup } from "./projects.js";
import { splitFrontmatter } from "./frontmatter.js";

const execFileAsync = promisify(execFile);

async function makeProject(
  root: string,
  dir: string,
  frontmatter: Record<string, string>
): Promise<void> {
  const projDir = path.join(root, dir);
  await fs.mkdir(projDir, { recursive: true });
  const fm = Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  await fs.writeFile(
    path.join(projDir, "README.md"),
    `---\n${fm}\n---\n\nbody\n`,
    "utf-8"
  );
}

async function makeWorktree(
  root: string,
  id: string,
  name: string
): Promise<string> {
  const wt = path.join(root, ".workspaces", id, name);
  await fs.mkdir(wt, { recursive: true });
  await execFileAsync("git", ["init", "-q", "-b", "main"], { cwd: wt });
  await execFileAsync("git", ["config", "user.email", "t@t.t"], { cwd: wt });
  await execFileAsync("git", ["config", "user.name", "t"], { cwd: wt });
  await execFileAsync("git", ["config", "commit.gpgsign", "false"], {
    cwd: wt,
  });
  await fs.writeFile(path.join(wt, "x"), "x", "utf-8");
  await execFileAsync("git", ["add", "."], { cwd: wt });
  await execFileAsync("git", ["commit", "-q", "-m", "init"], { cwd: wt });
  return wt;
}

describe("statusToGroup", () => {
  it("maps known statuses", () => {
    expect(statusToGroup("current")).toBe("active");
    expect(statusToGroup("todo")).toBe("active");
    expect(statusToGroup("shaping")).toBe("active");
    expect(statusToGroup("in_progress")).toBe("active");
    expect(statusToGroup("review")).toBe("review");
    expect(statusToGroup("not_now")).toBe("stale");
    expect(statusToGroup("maybe")).toBe("stale");
    expect(statusToGroup("done")).toBe("done");
    expect(statusToGroup("cancelled")).toBe("done");
  });

  it("falls back to stale for unknown statuses", () => {
    expect(statusToGroup("")).toBe("stale");
    expect(statusToGroup("weird")).toBe("stale");
  });
});

describe("splitFrontmatter", () => {
  it("parses simple frontmatter", () => {
    const { frontmatter, content } = splitFrontmatter(
      "---\ntitle: Hello\nstatus: current\n---\nbody"
    );
    expect(frontmatter.title).toBe("Hello");
    expect(frontmatter.status).toBe("current");
    expect(content).toBe("body");
  });

  it("returns empty frontmatter when missing", () => {
    const { frontmatter, content } = splitFrontmatter("just body\n");
    expect(frontmatter).toEqual({});
    expect(content).toBe("just body\n");
  });
});

describe("scanProjects", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "board-projects-"));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("returns empty when root is missing", async () => {
    const items = await scanProjects(path.join(tmp, "nope"), false);
    expect(items).toEqual([]);
  });

  it("scans projects, skips reserved dirs and non-PRO dirs", async () => {
    await makeProject(tmp, "PRO-001", {
      title: "Alpha",
      status: "current",
      area: "infra",
      created: "2026-01-01",
    });
    await makeProject(tmp, "PRO-002", {
      title: "Beta",
      status: "review",
      area: "infra",
      created: "2026-02-02",
    });
    await fs.mkdir(path.join(tmp, ".workspaces"), { recursive: true });
    await fs.mkdir(path.join(tmp, ".archive"), { recursive: true });
    await fs.mkdir(path.join(tmp, "not-a-project"), { recursive: true });

    const items = await scanProjects(tmp, false);
    expect(items.map((p) => p.id)).toEqual(["PRO-002", "PRO-001"]);
    expect(items[0]?.group).toBe("review");
    expect(items[1]?.group).toBe("active");
  });

  it("filters out done projects unless includeDone", async () => {
    await makeProject(tmp, "PRO-001", {
      title: "A",
      status: "current",
      created: "2026-01-01",
    });
    await makeProject(tmp, "PRO-002", {
      title: "B",
      status: "done",
      created: "2026-01-02",
    });

    const without = await scanProjects(tmp, false);
    expect(without.map((p) => p.id)).toEqual(["PRO-001"]);

    const withDone = await scanProjects(tmp, true);
    expect(withDone.map((p) => p.id).sort()).toEqual(["PRO-001", "PRO-002"]);
  });

  it("sorts by group then created desc", async () => {
    await makeProject(tmp, "PRO-A", {
      title: "A",
      status: "current",
      created: "2026-01-01",
    });
    await makeProject(tmp, "PRO-B", {
      title: "B",
      status: "current",
      created: "2026-03-01",
    });
    await makeProject(tmp, "PRO-C", {
      title: "C",
      status: "review",
      created: "2026-02-01",
    });
    await makeProject(tmp, "PRO-D", {
      title: "D",
      status: "not_now",
      created: "2026-04-01",
    });

    const items = await scanProjects(tmp, false);
    expect(items.map((p) => p.id)).toEqual(["PRO-C", "PRO-B", "PRO-A", "PRO-D"]);
  });

  it("collects worktree info from .workspaces/{id}", async () => {
    await makeProject(tmp, "PRO-001", {
      title: "Alpha",
      status: "current",
      created: "2026-01-01",
    });
    const wt = await makeWorktree(tmp, "PRO-001", "main");
    await fs.writeFile(path.join(wt, "dirty"), "dirty", "utf-8");

    const items = await scanProjects(tmp, false);
    expect(items).toHaveLength(1);
    const wts = items[0]?.worktrees ?? [];
    expect(wts).toHaveLength(1);
    expect(wts[0]?.name).toBe("main");
    expect(wts[0]?.branch).toBe("main");
    expect(wts[0]?.dirty).toBe(true);
    expect(wts[0]?.ahead).toBe(0);
  });

  it("handles non-git worktree subdirs gracefully", async () => {
    await makeProject(tmp, "PRO-001", {
      title: "Alpha",
      status: "current",
      created: "2026-01-01",
    });
    await fs.mkdir(path.join(tmp, ".workspaces", "PRO-001", "garbage"), {
      recursive: true,
    });

    const items = await scanProjects(tmp, false);
    expect(items).toHaveLength(1);
    expect(items[0]?.worktrees).toEqual([]);
  });

  it("uses dir name as id when frontmatter id missing", async () => {
    await makeProject(tmp, "PRO-X", {
      title: "X",
      status: "current",
      created: "2026-01-01",
    });
    const items = await scanProjects(tmp, false);
    expect(items[0]?.id).toBe("PRO-X");
  });

  it("skips dirs without README.md", async () => {
    await fs.mkdir(path.join(tmp, "PRO-empty"), { recursive: true });
    const items = await scanProjects(tmp, false);
    expect(items).toEqual([]);
  });
});
