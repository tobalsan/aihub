import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { splitFrontmatter } from "./frontmatter.js";

const execFileAsync = promisify(execFile);

export type BoardProjectGroup = "active" | "review" | "stale" | "done";

export type BoardWorktree = {
  name: string;
  path: string;
  branch: string;
  dirty: boolean;
  ahead: number;
};

export type BoardProject = {
  id: string;
  title: string;
  area: string;
  status: string;
  group: BoardProjectGroup;
  created: string;
  worktrees: BoardWorktree[];
};

const PROJECT_DIR_PATTERN = /^PRO-/;
const SKIP_DIRS = new Set([".workspaces", ".archive", ".trash"]);

const GROUP_ORDER: Record<BoardProjectGroup, number> = {
  review: 0,
  active: 1,
  stale: 2,
  done: 3,
};

export function statusToGroup(status: string): BoardProjectGroup {
  switch (status) {
    case "current":
    case "todo":
    case "shaping":
      return "active";
    case "review":
      return "review";
    case "not_now":
      return "stale";
    case "done":
    case "cancelled":
      return "done";
    default:
      return "stale";
  }
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return undefined;
}

async function readProjectMeta(
  projectsRoot: string,
  dirName: string
): Promise<{
  id: string;
  title: string;
  area: string;
  status: string;
  created: string;
} | null> {
  const projectDir = path.join(projectsRoot, dirName);
  const readmePath = path.join(projectDir, "README.md");
  let raw: string;
  try {
    raw = await fs.readFile(readmePath, "utf-8");
  } catch {
    return null;
  }
  const { frontmatter } = splitFrontmatter(raw);
  const id = asString(frontmatter.id) ?? dirName;
  const title = asString(frontmatter.title) ?? dirName;
  const area = asString(frontmatter.area) ?? "";
  const status = asString(frontmatter.status) ?? "";
  const created = asString(frontmatter.created) ?? "";
  return { id, title, area, status, created };
}

async function gitText(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout;
}

async function readWorktree(
  worktreePath: string,
  name: string
): Promise<BoardWorktree | null> {
  let branch = "";
  try {
    branch = (
      await gitText(["rev-parse", "--abbrev-ref", "HEAD"], worktreePath)
    ).trim();
  } catch {
    return null;
  }
  let dirty = false;
  try {
    const status = await gitText(["status", "--porcelain"], worktreePath);
    dirty = status.trim().length > 0;
  } catch {
    dirty = false;
  }
  let ahead = 0;
  try {
    const out = await gitText(
      ["rev-list", "--count", "HEAD", "--not", "origin/main"],
      worktreePath
    );
    const n = Number.parseInt(out.trim(), 10);
    ahead = Number.isFinite(n) ? n : 0;
  } catch {
    ahead = 0;
  }
  return { name, path: worktreePath, branch, dirty, ahead };
}

async function scanWorktrees(
  projectsRoot: string,
  id: string
): Promise<BoardWorktree[]> {
  const dir = path.join(projectsRoot, ".workspaces", id);
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const worktrees: BoardWorktree[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const wtPath = path.join(dir, entry.name);
    const wt = await readWorktree(wtPath, entry.name);
    if (wt) worktrees.push(wt);
  }
  worktrees.sort((a, b) => a.name.localeCompare(b.name));
  return worktrees;
}

export async function scanProjects(
  projectsRoot: string,
  includeDone: boolean
): Promise<BoardProject[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(projectsRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const projects: BoardProject[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    if (!PROJECT_DIR_PATTERN.test(entry.name)) continue;
    const meta = await readProjectMeta(projectsRoot, entry.name);
    if (!meta) continue;
    const group = statusToGroup(meta.status);
    if (!includeDone && group === "done") continue;
    const worktrees = await scanWorktrees(projectsRoot, meta.id);
    projects.push({
      id: meta.id,
      title: meta.title,
      area: meta.area,
      status: meta.status,
      group,
      created: meta.created,
      worktrees,
    });
  }

  projects.sort((a, b) => {
    const g = GROUP_ORDER[a.group] - GROUP_ORDER[b.group];
    if (g !== 0) return g;
    return b.created.localeCompare(a.created);
  });

  return projects;
}
