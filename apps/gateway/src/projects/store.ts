import * as fs from "node:fs/promises";
import * as path from "node:path";
import { homedir } from "node:os";
import type { GatewayConfig, CreateProjectRequest, UpdateProjectRequest } from "@aihub/shared";
import { parseMarkdownFile } from "../taskboard/parser.js";
import { CONFIG_DIR } from "../config/index.js";

const PROJECTS_STATE_PATH = path.join(CONFIG_DIR, "projects.json");

export type ProjectListItem = {
  id: string;
  title: string;
  path: string;
  frontmatter: Record<string, unknown>;
};

export type ProjectDetail = {
  id: string;
  title: string;
  path: string;
  frontmatter: Record<string, unknown>;
  content: string;
};

export type ProjectListResult =
  | { ok: true; data: ProjectListItem[] }
  | { ok: false; error: string };

export type ProjectItemResult =
  | { ok: true; data: ProjectDetail }
  | { ok: false; error: string };

function expandPath(p: string): string {
  if (p.startsWith("~/")) {
    return path.join(homedir(), p.slice(2));
  }
  return p;
}

function getProjectsRoot(config: GatewayConfig): string {
  const root = config.projects?.root ?? "~/projects";
  return expandPath(root);
}

async function dirExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "project";
}

type ProjectsState = { lastId: number };

async function readProjectsState(): Promise<ProjectsState> {
  try {
    const raw = await fs.readFile(PROJECTS_STATE_PATH, "utf8");
    const json = JSON.parse(raw) as ProjectsState;
    return { lastId: typeof json.lastId === "number" ? json.lastId : 0 };
  } catch {
    return { lastId: 0 };
  }
}

async function writeProjectsState(state: ProjectsState): Promise<void> {
  await ensureDir(CONFIG_DIR);
  await fs.writeFile(PROJECTS_STATE_PATH, JSON.stringify(state, null, 2), "utf8");
}

async function allocateProjectId(): Promise<string> {
  const state = await readProjectsState();
  const next = state.lastId + 1;
  state.lastId = next;
  await writeProjectsState(state);
  return `PRO-${next}`;
}

function formatFrontmatterValue(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value ?? "");
}

function formatFrontmatter(frontmatter: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (value === undefined) continue;
    lines.push(`${key}: ${formatFrontmatterValue(value)}`);
  }
  return `---\n${lines.join("\n")}\n---\n`;
}

function formatMarkdown(frontmatter: Record<string, unknown>, content: string): string {
  const fm = formatFrontmatter(frontmatter);
  return `${fm}${content}`;
}

async function findProjectDir(root: string, id: string): Promise<string | null> {
  if (!(await dirExists(root))) return null;
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === id || entry.name.startsWith(`${id}_`)) {
      return entry.name;
    }
  }
  return null;
}

function toStringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export async function listProjects(config: GatewayConfig): Promise<ProjectListResult> {
  const root = getProjectsRoot(config);
  if (!(await dirExists(root))) {
    return { ok: true, data: [] };
  }

  const entries = await fs.readdir(root, { withFileTypes: true });
  const projects: ProjectListItem[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirName = entry.name;
    const readmePath = path.join(root, dirName, "README.md");
    try {
      const { frontmatter, title } = await parseMarkdownFile(readmePath);
      const id = toStringField(frontmatter.id) ?? dirName.split("_")[0];
      const resolvedTitle = toStringField(frontmatter.title) ?? title;
      projects.push({
        id,
        title: resolvedTitle,
        path: dirName,
        frontmatter: { ...frontmatter, id, title: resolvedTitle },
      });
    } catch {
      // Skip invalid project folder
    }
  }

  return { ok: true, data: projects };
}

export async function getProject(
  config: GatewayConfig,
  id: string
): Promise<ProjectItemResult> {
  const root = getProjectsRoot(config);
  const dirName = await findProjectDir(root, id);
  if (!dirName) {
    return { ok: false, error: `Project not found: ${id}` };
  }

  const readmePath = path.join(root, dirName, "README.md");
  const { frontmatter, content, title } = await parseMarkdownFile(readmePath);
  const resolvedTitle = toStringField(frontmatter.title) ?? title;
  const resolvedId = toStringField(frontmatter.id) ?? id;

  return {
    ok: true,
    data: {
      id: resolvedId,
      title: resolvedTitle,
      path: dirName,
      frontmatter: { ...frontmatter, id: resolvedId, title: resolvedTitle },
      content,
    },
  };
}

export async function createProject(
  config: GatewayConfig,
  input: CreateProjectRequest
): Promise<ProjectItemResult> {
  const root = getProjectsRoot(config);
  await ensureDir(root);
  const id = await allocateProjectId();
  const slug = slugifyTitle(input.title);
  const dirName = `${id}_${slug}`;
  const dirPath = path.join(root, dirName);

  await fs.mkdir(dirPath);

  const created = new Date().toISOString();
  const frontmatter = {
    id,
    title: input.title,
    status: input.status ?? "maybe",
    created,
    domain: input.domain,
    owner: input.owner,
    executionMode: input.executionMode,
    appetite: input.appetite,
  };
  const content = `# ${input.title}\n`;
  const readme = formatMarkdown(frontmatter, content);
  await fs.writeFile(path.join(dirPath, "README.md"), readme, "utf8");

  return {
    ok: true,
    data: {
      id,
      title: input.title,
      path: dirName,
      frontmatter,
      content,
    },
  };
}

export async function updateProject(
  config: GatewayConfig,
  id: string,
  input: UpdateProjectRequest
): Promise<ProjectItemResult> {
  const root = getProjectsRoot(config);
  const dirName = await findProjectDir(root, id);
  if (!dirName) {
    return { ok: false, error: `Project not found: ${id}` };
  }

  const currentReadmePath = path.join(root, dirName, "README.md");
  const parsed = await parseMarkdownFile(currentReadmePath);
  const currentTitle = toStringField(parsed.frontmatter.title) ?? parsed.title;
  const nextTitle = input.title ?? currentTitle;
  const nextSlug = slugifyTitle(nextTitle);
  const nextDirName = `${id}_${nextSlug}`;
  let finalDirName = dirName;

  if (nextDirName !== dirName) {
    const targetPath = path.join(root, nextDirName);
    if (await dirExists(targetPath)) {
      return { ok: false, error: `Project already exists: ${nextDirName}` };
    }
    await fs.rename(path.join(root, dirName), targetPath);
    finalDirName = nextDirName;
  }

  const nextFrontmatter = {
    ...parsed.frontmatter,
    id,
    title: nextTitle,
    ...(input.status ? { status: input.status } : {}),
    ...(input.domain ? { domain: input.domain } : {}),
    ...(input.owner ? { owner: input.owner } : {}),
    ...(input.executionMode ? { executionMode: input.executionMode } : {}),
    ...(input.appetite ? { appetite: input.appetite } : {}),
  };
  const nextContent = input.content ?? parsed.content;
  const readme = formatMarkdown(nextFrontmatter, nextContent);
  const finalReadmePath = path.join(root, finalDirName, "README.md");
  await fs.writeFile(finalReadmePath, readme, "utf8");

  return {
    ok: true,
    data: {
      id,
      title: nextTitle,
      path: finalDirName,
      frontmatter: nextFrontmatter,
      content: nextContent,
    },
  };
}
