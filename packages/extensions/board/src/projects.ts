import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { expandPath } from "@aihub/shared";
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
    case "in_progress":
      return "active";
    case "review":
      return "review";
    case "not_now":
    case "maybe":
      return "stale";
    case "done":
    case "cancelled":
    case "archived":
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
  repo?: string;
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
  const repo = asString(frontmatter.repo);
  return { id, title, area, status, created, repo };
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

function branchMatchesProject(branch: string, id: string): boolean {
  return (
    branch === `space/${id}` ||
    branch.startsWith(`space/${id}/`) ||
    branch.startsWith(`${id}/`)
  );
}

async function isGitWorktree(dir: string): Promise<boolean> {
  try {
    await fs.access(path.join(dir, ".git"));
    return true;
  } catch {
    return false;
  }
}

async function scanWorktreesFromRoot(
  id: string,
  worktreesRoot: string
): Promise<BoardWorktree[]> {
  let projectDirs: import("node:fs").Dirent[];
  try {
    projectDirs = await fs.readdir(worktreesRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: BoardWorktree[] = [];
  for (const proj of projectDirs) {
    if (!proj.isDirectory()) continue;
    const projPath = path.join(worktreesRoot, proj.name);
    let inner: import("node:fs").Dirent[];
    try {
      inner = await fs.readdir(projPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of inner) {
      if (!entry.isDirectory()) continue;
      const wtPath = path.join(projPath, entry.name);
      if (!(await isGitWorktree(wtPath))) continue;
      const wt = await readWorktree(wtPath, entry.name);
      if (wt && branchMatchesProject(wt.branch, id)) out.push(wt);
    }
  }
  return out;
}

async function scanWorktreesFromRepo(
  id: string,
  repo: string
): Promise<BoardWorktree[]> {
  const repoPath = expandPath(repo);
  let raw: string;
  try {
    raw = await gitText(["worktree", "list", "--porcelain"], repoPath);
  } catch {
    return [];
  }
  const out: BoardWorktree[] = [];
  const blocks = raw.split(/\n\s*\n/);
  for (const block of blocks) {
    let wtPath: string | undefined;
    let branch: string | undefined;
    for (const line of block.split("\n")) {
      if (line.startsWith("worktree ")) {
        wtPath = line.slice("worktree ".length).trim();
      } else if (line.startsWith("branch ")) {
        const ref = line.slice("branch ".length).trim();
        branch = ref.startsWith("refs/heads/")
          ? ref.slice("refs/heads/".length)
          : ref;
      }
    }
    if (!wtPath || !branch) continue;
    if (!branchMatchesProject(branch, id)) continue;
    const wt = await readWorktree(wtPath, path.basename(wtPath));
    if (wt) out.push(wt);
  }
  return out;
}

async function canonicalPath(p: string): Promise<string> {
  try {
    return await fs.realpath(p);
  } catch {
    return path.resolve(p);
  }
}

async function scanWorktrees(
  id: string,
  worktreesRoot: string,
  repo?: string
): Promise<BoardWorktree[]> {
  const fromRoot = await scanWorktreesFromRoot(id, worktreesRoot);
  const fromRepo = repo ? await scanWorktreesFromRepo(id, repo) : [];
  const dedup = new Map<string, BoardWorktree>();
  for (const wt of [...fromRoot, ...fromRepo]) {
    const key = await canonicalPath(wt.path);
    if (!dedup.has(key)) dedup.set(key, wt);
  }
  const result = [...dedup.values()];
  result.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

export async function scanProjects(
  projectsRoot: string,
  includeDone: boolean,
  worktreesRoot?: string
): Promise<BoardProject[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(projectsRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const wtRoot = worktreesRoot ?? expandPath("~/.worktrees");

  const projects: BoardProject[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    if (!PROJECT_DIR_PATTERN.test(entry.name)) continue;
    const meta = await readProjectMeta(projectsRoot, entry.name);
    if (!meta) continue;
    const group = statusToGroup(meta.status);
    if (!includeDone && group === "done") continue;
    const worktrees = await scanWorktrees(meta.id, wtRoot, meta.repo);
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
