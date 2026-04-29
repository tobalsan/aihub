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
  worktreesRoot: string,
  projectDirName: string,
  name: string,
  branch: string
): Promise<string> {
  const wt = path.join(worktreesRoot, projectDirName, name);
  await fs.mkdir(wt, { recursive: true });
  await execFileAsync("git", ["init", "-q", "-b", branch], { cwd: wt });
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

async function withGitLog(tmp: string): Promise<{
  logPath: string;
  restore: () => void;
}> {
  const { stdout } = await execFileAsync("which", ["git"]);
  const realGit = stdout.trim();
  const binDir = path.join(tmp, "_bin");
  const logPath = path.join(tmp, "git.log");
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(
    path.join(binDir, "git"),
    `#!/bin/sh\nprintf '%s\\n' "$PWD|$*" >> "$GIT_LOG"\nexec "$REAL_GIT" "$@"\n`,
    "utf8"
  );
  await fs.chmod(path.join(binDir, "git"), 0o755);
  const prevPath = process.env.PATH;
  const prevGitLog = process.env.GIT_LOG;
  const prevRealGit = process.env.REAL_GIT;
  process.env.PATH = `${binDir}${path.delimiter}${prevPath ?? ""}`;
  process.env.GIT_LOG = logPath;
  process.env.REAL_GIT = realGit;
  return {
    logPath,
    restore: () => {
      if (prevPath === undefined) delete process.env.PATH;
      else process.env.PATH = prevPath;
      if (prevGitLog === undefined) delete process.env.GIT_LOG;
      else process.env.GIT_LOG = prevGitLog;
      if (prevRealGit === undefined) delete process.env.REAL_GIT;
      else process.env.REAL_GIT = prevRealGit;
    },
  };
}

async function readGitLog(logPath: string): Promise<string[]> {
  try {
    const raw = await fs.readFile(logPath, "utf8");
    return raw.split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
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
    expect(statusToGroup("archived")).toBe("done");
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
  let emptyWtRoot: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "board-projects-"));
    emptyWtRoot = path.join(tmp, "__empty_wts");
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

    const items = await scanProjects(tmp, false, emptyWtRoot);
    expect(items.map((p) => p.id)).toEqual(["PRO-002", "PRO-001"]);
    expect(items[0]?.group).toBe("review");
    expect(items[1]?.group).toBe("active");
  });

  it("skips .done project folder", async () => {
    await makeProject(tmp, "PRO-001", {
      title: "Alpha",
      status: "current",
      created: "2026-01-01",
    });
    await makeProject(path.join(tmp, ".done"), "PRO-002", {
      title: "Done",
      status: "done",
      created: "2026-01-02",
    });

    const items = await scanProjects(tmp, true, emptyWtRoot);
    expect(items.map((p) => p.id)).toEqual(["PRO-001"]);
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

    const without = await scanProjects(tmp, false, emptyWtRoot);
    expect(without.map((p) => p.id)).toEqual(["PRO-001"]);

    const withDone = await scanProjects(tmp, true, emptyWtRoot);
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

    const items = await scanProjects(tmp, false, emptyWtRoot);
    expect(items.map((p) => p.id)).toEqual([
      "PRO-C",
      "PRO-B",
      "PRO-A",
      "PRO-D",
    ]);
  });

  it("collects worktree info from worktreesRoot when branch matches space/{id}", async () => {
    await makeProject(tmp, "PRO-001", {
      title: "Alpha",
      status: "current",
      created: "2026-01-01",
    });
    const wtRoot = path.join(tmp, "_worktrees");
    const wt = await makeWorktree(
      wtRoot,
      "aihub",
      "feature-x",
      "space/PRO-001"
    );
    await fs.writeFile(path.join(wt, "dirty"), "dirty", "utf-8");

    const items = await scanProjects(tmp, false, wtRoot);
    expect(items).toHaveLength(1);
    const wts = items[0]?.worktrees ?? [];
    expect(wts).toHaveLength(1);
    expect(wts[0]?.name).toBe("feature-x");
    expect(wts[0]?.branch).toBe("space/PRO-001");
    expect(wts[0]?.dirty).toBe(true);
    expect(wts[0]?.ahead).toBe(0);
  });

  it("ignores worktrees whose branch does not match the project", async () => {
    await makeProject(tmp, "PRO-001", {
      title: "Alpha",
      status: "current",
      created: "2026-01-01",
    });
    const wtRoot = path.join(tmp, "_worktrees");
    await makeWorktree(wtRoot, "aihub", "other", "space/PRO-999");

    const items = await scanProjects(tmp, false, wtRoot);
    expect(items[0]?.worktrees).toEqual([]);
  });

  it("handles non-git worktree subdirs gracefully", async () => {
    await makeProject(tmp, "PRO-001", {
      title: "Alpha",
      status: "current",
      created: "2026-01-01",
    });
    const wtRoot = path.join(tmp, "_worktrees");
    await fs.mkdir(path.join(wtRoot, "aihub", "garbage"), { recursive: true });

    const items = await scanProjects(tmp, false, wtRoot);
    expect(items).toHaveLength(1);
    expect(items[0]?.worktrees).toEqual([]);
  });

  it("discovers worktrees via repo frontmatter using git worktree list", async () => {
    const repoDir = path.join(tmp, "repo");
    await fs.mkdir(repoDir, { recursive: true });
    await execFileAsync("git", ["init", "-q", "-b", "main"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.email", "t@t.t"], {
      cwd: repoDir,
    });
    await execFileAsync("git", ["config", "user.name", "t"], { cwd: repoDir });
    await execFileAsync("git", ["config", "commit.gpgsign", "false"], {
      cwd: repoDir,
    });
    await fs.writeFile(path.join(repoDir, "x"), "x", "utf-8");
    await execFileAsync("git", ["add", "."], { cwd: repoDir });
    await execFileAsync("git", ["commit", "-q", "-m", "init"], {
      cwd: repoDir,
    });

    const wtPath = path.join(tmp, "elsewhere", "feat");
    await execFileAsync(
      "git",
      ["worktree", "add", "-b", "space/PRO-001", wtPath],
      { cwd: repoDir }
    );

    await makeProject(tmp, "PRO-001", {
      title: "Alpha",
      status: "current",
      created: "2026-01-01",
      repo: repoDir,
    });

    const items = await scanProjects(tmp, false, path.join(tmp, "missing"));
    expect(items).toHaveLength(1);
    const wts = items[0]?.worktrees ?? [];
    const found = wts.find((w) => w.branch === "space/PRO-001");
    expect(found).toBeTruthy();
    expect(await fs.realpath(found!.path)).toBe(await fs.realpath(wtPath));
  });

  it("dedupes worktrees discovered by both root scan and git worktree list", async () => {
    const repoDir = path.join(tmp, "repo");
    await fs.mkdir(repoDir, { recursive: true });
    await execFileAsync("git", ["init", "-q", "-b", "main"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.email", "t@t.t"], {
      cwd: repoDir,
    });
    await execFileAsync("git", ["config", "user.name", "t"], { cwd: repoDir });
    await execFileAsync("git", ["config", "commit.gpgsign", "false"], {
      cwd: repoDir,
    });
    await fs.writeFile(path.join(repoDir, "x"), "x", "utf-8");
    await execFileAsync("git", ["add", "."], { cwd: repoDir });
    await execFileAsync("git", ["commit", "-q", "-m", "init"], {
      cwd: repoDir,
    });

    const wtRoot = path.join(tmp, "_wts");
    const wtPath = path.join(wtRoot, "aihub", "feat");
    await fs.mkdir(path.dirname(wtPath), { recursive: true });
    await execFileAsync(
      "git",
      ["worktree", "add", "-b", "space/PRO-001", wtPath],
      { cwd: repoDir }
    );

    await makeProject(tmp, "PRO-001", {
      title: "Alpha",
      status: "current",
      created: "2026-01-01",
      repo: repoDir,
    });

    const items = await scanProjects(tmp, false, wtRoot);
    const wts = items[0]?.worktrees ?? [];
    expect(wts).toHaveLength(1);
    expect(wts[0]?.branch).toBe("space/PRO-001");
  });

  it("builds the root worktree index once for multiple projects", async () => {
    await makeProject(tmp, "PRO-001", {
      title: "Alpha",
      status: "current",
      created: "2026-01-01",
    });
    await makeProject(tmp, "PRO-002", {
      title: "Beta",
      status: "current",
      created: "2026-01-02",
    });
    const wtRoot = path.join(tmp, "_worktrees");
    await makeWorktree(wtRoot, "aihub", "alpha", "space/PRO-001");
    await makeWorktree(wtRoot, "aihub", "beta", "space/PRO-002");

    const gitLog = await withGitLog(tmp);
    try {
      const items = await scanProjects(tmp, false, wtRoot);
      expect(items).toHaveLength(2);
    } finally {
      gitLog.restore();
    }

    const log = await readGitLog(gitLog.logPath);
    const branchReads = log.filter((line) =>
      line.endsWith("|rev-parse --abbrev-ref HEAD")
    );
    expect(branchReads).toHaveLength(2);
  });

  it("runs git worktree list once per unique repo", async () => {
    const repoDir = path.join(tmp, "repo");
    await fs.mkdir(repoDir, { recursive: true });
    await execFileAsync("git", ["init", "-q", "-b", "main"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.email", "t@t.t"], {
      cwd: repoDir,
    });
    await execFileAsync("git", ["config", "user.name", "t"], { cwd: repoDir });
    await execFileAsync("git", ["config", "commit.gpgsign", "false"], {
      cwd: repoDir,
    });
    await fs.writeFile(path.join(repoDir, "x"), "x", "utf-8");
    await execFileAsync("git", ["add", "."], { cwd: repoDir });
    await execFileAsync("git", ["commit", "-q", "-m", "init"], {
      cwd: repoDir,
    });
    await execFileAsync(
      "git",
      ["worktree", "add", "-b", "space/PRO-001", path.join(tmp, "wt-1")],
      {
        cwd: repoDir,
      }
    );

    await makeProject(tmp, "PRO-001", {
      title: "Alpha",
      status: "current",
      created: "2026-01-01",
      repo: repoDir,
    });
    await makeProject(tmp, "PRO-002", {
      title: "Beta",
      status: "current",
      created: "2026-01-02",
      repo: repoDir,
    });

    const gitLog = await withGitLog(tmp);
    try {
      const items = await scanProjects(tmp, false, path.join(tmp, "missing"));
      expect(items).toHaveLength(2);
    } finally {
      gitLog.restore();
    }

    const log = await readGitLog(gitLog.logPath);
    const worktreeLists = log.filter((line) =>
      line.endsWith("|worktree list --porcelain")
    );
    expect(worktreeLists).toHaveLength(1);
  });

  it("uses dir name as id when frontmatter id missing", async () => {
    await makeProject(tmp, "PRO-X", {
      title: "X",
      status: "current",
      created: "2026-01-01",
    });
    const items = await scanProjects(tmp, false, emptyWtRoot);
    expect(items[0]?.id).toBe("PRO-X");
  });

  it("skips dirs without README.md", async () => {
    await fs.mkdir(path.join(tmp, "PRO-empty"), { recursive: true });
    const items = await scanProjects(tmp, false, emptyWtRoot);
    expect(items).toEqual([]);
  });
});
