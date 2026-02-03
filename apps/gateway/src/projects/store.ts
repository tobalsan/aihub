import * as fs from "node:fs/promises";
import * as path from "node:path";
import { homedir } from "node:os";
import type { GatewayConfig, CreateProjectRequest, UpdateProjectRequest, UploadedAttachment } from "@aihub/shared";
import { parseMarkdownFile } from "../taskboard/parser.js";
import { CONFIG_DIR } from "../config/index.js";

const PROJECTS_STATE_PATH = path.join(CONFIG_DIR, "projects.json");

export type ProjectListItem = {
  id: string;
  title: string;
  path: string;
  absolutePath: string;
  frontmatter: Record<string, unknown>;
};

export type ProjectDetail = {
  id: string;
  title: string;
  path: string;
  absolutePath: string;
  frontmatter: Record<string, unknown>;
  content: string;
};

export type ProjectListResult =
  | { ok: true; data: ProjectListItem[] }
  | { ok: false; error: string };

export type ProjectItemResult =
  | { ok: true; data: ProjectDetail }
  | { ok: false; error: string };

export type DeleteProjectResult =
  | { ok: true; data: { id: string; path: string; trashedPath: string } }
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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
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
        absolutePath: path.join(root, dirName),
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
      absolutePath: path.join(root, dirName),
      frontmatter: { ...frontmatter, id: resolvedId, title: resolvedTitle },
      content,
    },
  };
}

export async function createProject(
  config: GatewayConfig,
  input: CreateProjectRequest
): Promise<ProjectItemResult> {
  const trimmedTitle = input.title.trim();
  const wordCount = trimmedTitle.split(/\s+/).filter(Boolean).length;
  if (wordCount < 2) {
    return { ok: false, error: "Title must contain at least two words" };
  }

  const root = getProjectsRoot(config);
  await ensureDir(root);
  const id = await allocateProjectId();
  const slug = slugifyTitle(trimmedTitle);
  const dirName = `${id}_${slug}`;
  const dirPath = path.join(root, dirName);

  await fs.mkdir(dirPath);

  const created = new Date().toISOString();
  const frontmatter: Record<string, unknown> = {
    id,
    title: trimmedTitle,
    status: input.status ?? "maybe",
    created,
  };
  if (input.domain) frontmatter.domain = input.domain;
  if (input.owner) frontmatter.owner = input.owner;
  if (input.executionMode) frontmatter.executionMode = input.executionMode;
  if (input.appetite) frontmatter.appetite = input.appetite;
  const content = input.description
    ? `# ${trimmedTitle}\n\n${input.description}\n`
    : `# ${trimmedTitle}\n`;
  const readme = formatMarkdown(frontmatter, content);
  await fs.writeFile(path.join(dirPath, "README.md"), readme, "utf8");

  return {
    ok: true,
    data: {
      id,
      title: trimmedTitle,
      path: dirName,
      absolutePath: dirPath,
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

  const nextFrontmatter: Record<string, unknown> = {
    ...parsed.frontmatter,
    id,
    title: nextTitle,
    ...(input.status ? { status: input.status } : {}),
    ...(input.appetite ? { appetite: input.appetite } : {}),
  };

  if (input.domain === "") delete nextFrontmatter.domain;
  else if (input.domain) nextFrontmatter.domain = input.domain;

  if (input.owner === "") delete nextFrontmatter.owner;
  else if (input.owner) nextFrontmatter.owner = input.owner;

  if (input.executionMode === "") delete nextFrontmatter.executionMode;
  else if (input.executionMode) nextFrontmatter.executionMode = input.executionMode;

  if (input.repo === "") delete nextFrontmatter.repo;
  else if (input.repo) nextFrontmatter.repo = input.repo;

  if (input.runAgent === "") delete nextFrontmatter.runAgent;
  else if (input.runAgent) nextFrontmatter.runAgent = input.runAgent;

  if (input.runMode === "") delete nextFrontmatter.runMode;
  else if (input.runMode) nextFrontmatter.runMode = input.runMode;

  if (input.sessionKeys === null) delete nextFrontmatter.sessionKeys;
  else if (input.sessionKeys) nextFrontmatter.sessionKeys = input.sessionKeys;

  if (input.appetite === "") delete nextFrontmatter.appetite;
  else if (input.appetite) nextFrontmatter.appetite = input.appetite;
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
      absolutePath: path.join(root, finalDirName),
      frontmatter: nextFrontmatter,
      content: nextContent,
    },
  };
}

export async function deleteProject(
  config: GatewayConfig,
  id: string
): Promise<DeleteProjectResult> {
  const root = getProjectsRoot(config);
  const dirName = await findProjectDir(root, id);
  if (!dirName) {
    return { ok: false, error: `Project not found: ${id}` };
  }

  const trashRoot = path.join(root, "trash");
  await ensureDir(trashRoot);

  const sourcePath = path.join(root, dirName);
  const targetPath = path.join(trashRoot, dirName);
  if (await dirExists(targetPath)) {
    return { ok: false, error: `Trash already contains project: ${dirName}` };
  }

  await fs.rename(sourcePath, targetPath);

  return { ok: true, data: { id, path: dirName, trashedPath: path.join("trash", dirName) } };
}

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

async function generateUniqueName(dir: string, baseName: string): Promise<string> {
  const ext = path.extname(baseName);
  const nameWithoutExt = path.basename(baseName, ext);
  let candidate = baseName;
  let counter = 1;
  while (await fs.access(path.join(dir, candidate)).then(() => true).catch(() => false)) {
    candidate = `${nameWithoutExt}-${counter}${ext}`;
    counter++;
  }
  return candidate;
}

export type SaveAttachmentsResult =
  | { ok: true; data: UploadedAttachment[] }
  | { ok: false; error: string };

export async function saveAttachments(
  config: GatewayConfig,
  projectId: string,
  files: Array<{ name: string; data: Buffer }>
): Promise<SaveAttachmentsResult> {
  const root = getProjectsRoot(config);
  const dirName = await findProjectDir(root, projectId);
  if (!dirName) {
    return { ok: false, error: `Project not found: ${projectId}` };
  }

  const attachmentsDir = path.join(root, dirName, "attachments");
  await ensureDir(attachmentsDir);

  const results: UploadedAttachment[] = [];

  for (const file of files) {
    if (file.data.length > MAX_FILE_SIZE) {
      return { ok: false, error: `File ${file.name} exceeds 20MB limit` };
    }

    const savedName = await generateUniqueName(attachmentsDir, file.name);
    const filePath = path.join(attachmentsDir, savedName);
    await fs.writeFile(filePath, file.data);

    const ext = path.extname(savedName).toLowerCase();
    results.push({
      originalName: file.name,
      savedName,
      path: `attachments/${savedName}`,
      isImage: IMAGE_EXTENSIONS.has(ext),
    });
  }

  return { ok: true, data: results };
}

export type ResolveAttachmentResult =
  | { ok: true; data: { path: string; name: string } }
  | { ok: false; error: string };

export async function resolveAttachmentFile(
  config: GatewayConfig,
  projectId: string,
  fileName: string
): Promise<ResolveAttachmentResult> {
  const root = getProjectsRoot(config);
  const dirName = await findProjectDir(root, projectId);
  if (!dirName) {
    return { ok: false, error: `Project not found: ${projectId}` };
  }
  if (!fileName || fileName === "." || fileName === "..") {
    return { ok: false, error: "Invalid attachment name" };
  }
  if (fileName !== path.basename(fileName) || fileName.includes("/") || fileName.includes("\\")) {
    return { ok: false, error: "Invalid attachment name" };
  }

  const attachmentsDir = path.join(root, dirName, "attachments");
  const filePath = path.join(attachmentsDir, fileName);
  if (!(await fileExists(filePath))) {
    return { ok: false, error: "Attachment not found" };
  }
  return { ok: true, data: { path: filePath, name: fileName } };
}
