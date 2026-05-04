import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  GatewayConfig,
  CreateProjectRequest,
  UpdateProjectRequest,
  UploadedAttachment,
  ProjectStatus,
} from "@aihub/shared";
import { expandPath } from "@aihub/shared";
import { parseMarkdownFile } from "../taskboard/parser.js";
import { getProjectsContext } from "../context.js";
import { listAreas } from "../areas/store.js";
import { dirExists } from "../util/fs.js";
import { getProjectsRoot } from "../util/paths.js";
import { listSlices, updateSlice, type SliceRecord } from "./slices.js";

function getProjectsStatePath(): string {
  return path.join(getProjectsContext().getDataDir(), "projects.json");
}
const THREAD_FILE = "THREAD.md";
const ARCHIVE_DIR = ".archive";
const DONE_DIR = ".done";
const TRASH_DIR = ".trash";
const LEGACY_TRASH_DIRS = ["Trash", "trash"];
const DONE_STATUSES = new Set(["done", "cancelled"]);
const PROJECT_LIFECYCLE_STATUSES = new Set([
  "shaping",
  "active",
  "done",
  "cancelled",
  "archived",
]);
const LEGACY_PROJECT_STATUSES = new Set([
  "not_now",
  "maybe",
  "todo",
  "in_progress",
  "review",
  "ready_to_merge",
  "trashed",
]);

export type ProjectListItem = {
  id: string;
  title: string;
  path: string;
  absolutePath: string;
  repoValid: boolean;
  frontmatter: Record<string, unknown>;
};

export type ProjectDetail = {
  id: string;
  title: string;
  path: string;
  absolutePath: string;
  repoValid: boolean;
  frontmatter: Record<string, unknown>;
  docs: Record<string, string>;
  thread: ProjectThreadEntry[];
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

export type ArchiveProjectResult =
  | { ok: true; data: { id: string; path: string; archivedPath: string } }
  | { ok: false; error: string };

export type UnarchiveProjectResult =
  | { ok: true; data: { id: string; path: string } }
  | { ok: false; error: string };

export type ProjectThreadEntry = {
  author: string;
  date: string;
  body: string;
};

async function isValidGitRepo(repoPath?: string): Promise<boolean> {
  if (!repoPath) return false;
  const expandedRepoPath = expandPath(repoPath);
  if (!(await dirExists(expandedRepoPath))) return false;
  try {
    await fs.stat(path.join(expandedRepoPath, ".git"));
    return true;
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

async function migrateTrashRoot(root: string): Promise<void> {
  const hiddenTrash = path.join(root, TRASH_DIR);
  if (await dirExists(hiddenTrash)) return;
  for (const legacy of LEGACY_TRASH_DIRS) {
    const legacyPath = path.join(root, legacy);
    if (await dirExists(legacyPath)) {
      await fs.rename(legacyPath, hiddenTrash);
      return;
    }
  }
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

type ProjectLocation = {
  dirName: string;
  baseRoot: string;
  path: string;
};

async function readProjectsState(): Promise<ProjectsState> {
  try {
    const raw = await fs.readFile(getProjectsStatePath(), "utf8");
    const json = JSON.parse(raw) as ProjectsState;
    return { lastId: typeof json.lastId === "number" ? json.lastId : 0 };
  } catch {
    return { lastId: 0 };
  }
}

async function writeProjectsState(state: ProjectsState): Promise<void> {
  await ensureDir(getProjectsContext().getDataDir());
  await fs.writeFile(
    getProjectsStatePath(),
    JSON.stringify(state, null, 2),
    "utf8"
  );
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

function formatMarkdown(
  frontmatter: Record<string, unknown>,
  content: string
): string {
  const fm = formatFrontmatter(frontmatter);
  return `${fm}${content}`;
}

function formatThreadFrontmatter(projectId: string): string {
  return `---\nproject: ${projectId}\n---\n`;
}

function formatThreadEntry(entry: ProjectThreadEntry): string {
  const body = entry.body.trim();
  return `[author:${entry.author}]\n[date:${entry.date}]\n${body}\n`;
}

function parseThreadSections(raw: string): string[] {
  const fmMatch = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  const withoutFrontmatter = fmMatch ? raw.slice(fmMatch[0].length) : raw;
  return withoutFrontmatter
    .split(/\r?\n---\r?\n---\r?\n/)
    .map((section) => section.trim())
    .filter(Boolean);
}

function parseThreadEntry(section: string): ProjectThreadEntry | null {
  const lines = section.split(/\r?\n/);
  let author = "";
  let date = "";
  let cursor = 0;
  for (; cursor < lines.length; cursor += 1) {
    const line = lines[cursor]?.trim();
    if (!line) continue;
    const authorMatch = line.match(/^\[author:(.+)\]$/);
    if (authorMatch) {
      author = authorMatch[1].trim();
      continue;
    }
    const dateMatch = line.match(/^\[date:(.+)\]$/);
    if (dateMatch) {
      date = dateMatch[1].trim();
      continue;
    }
    break;
  }
  const body = lines.slice(cursor).join("\n").trim();
  if (!author && !date && !body) return null;
  return { author, date, body };
}

async function readMarkdownIfExists(filePath: string): Promise<{
  frontmatter: Record<string, unknown>;
  content: string;
  title: string;
} | null> {
  if (!(await fileExists(filePath))) return null;
  return parseMarkdownFile(filePath);
}

export async function findProjectDir(
  root: string,
  id: string
): Promise<string | null> {
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

async function findArchivedProjectDir(
  root: string,
  id: string
): Promise<string | null> {
  return findProjectDir(path.join(root, ARCHIVE_DIR), id);
}

async function findDoneProjectDir(
  root: string,
  id: string
): Promise<string | null> {
  return findProjectDir(path.join(root, DONE_DIR), id);
}

function projectRelativePath(
  root: string,
  baseRoot: string,
  dirName: string
): string {
  const prefix = path.relative(root, baseRoot);
  return prefix ? path.join(prefix, dirName) : dirName;
}

export async function findProjectLocation(
  root: string,
  id: string,
  options?: { includeDone?: boolean; includeArchived?: boolean }
): Promise<ProjectLocation | null> {
  const activeDir = await findProjectDir(root, id);
  if (activeDir) {
    return { dirName: activeDir, baseRoot: root, path: activeDir };
  }

  if (options?.includeDone !== false) {
    const doneRoot = path.join(root, DONE_DIR);
    const doneDir = await findDoneProjectDir(root, id);
    if (doneDir) {
      return {
        dirName: doneDir,
        baseRoot: doneRoot,
        path: path.join(DONE_DIR, doneDir),
      };
    }
  }

  if (options?.includeArchived) {
    const archiveRoot = path.join(root, ARCHIVE_DIR);
    const archivedDir = await findArchivedProjectDir(root, id);
    if (archivedDir) {
      return {
        dirName: archivedDir,
        baseRoot: archiveRoot,
        path: path.join(ARCHIVE_DIR, archivedDir),
      };
    }
  }

  return null;
}

function toStringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function normalizeStatus(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function projectStatusMigrationHint(status: string): string {
  return `Legacy project status "${status}" no longer supported. Run \`aihub projects migrate-to-slices\`.`;
}

function validateProjectStatus(status: unknown): string | null {
  const normalized = normalizeStatus(status);
  if (!normalized) return null;
  if (PROJECT_LIFECYCLE_STATUSES.has(normalized)) return normalized;
  if (LEGACY_PROJECT_STATUSES.has(normalized)) {
    throw new Error(projectStatusMigrationHint(normalized));
  }
  throw new Error(`Invalid project status: ${String(status)}`);
}

async function cascadeProjectCancellation(projectDir: string): Promise<void> {
  const slices = await listSlices(projectDir);
  await Promise.all(
    slices
      .filter(
        (slice) =>
          slice.frontmatter.status !== "done" &&
          slice.frontmatter.status !== "cancelled"
      )
      .map((slice) =>
        updateSlice(projectDir, slice.id, {
          status: "cancelled",
        })
      )
  );
}

function shouldAutoMarkProjectDone(
  status: string | null,
  slices: SliceRecord[]
): boolean {
  if (status !== "active") return false;
  if (slices.length === 0) return false;
  const hasDone = slices.some((slice) => slice.frontmatter.status === "done");
  const allTerminal = slices.every(
    (slice) =>
      slice.frontmatter.status === "done" ||
      slice.frontmatter.status === "cancelled"
  );
  return hasDone && allTerminal;
}

async function getAreaRepoMap(
  config: GatewayConfig
): Promise<Map<string, string>> {
  const areas = await listAreas(config);
  const map = new Map<string, string>();
  for (const area of areas) {
    if (!area.repo) continue;
    map.set(area.id, area.repo);
  }
  return map;
}

function resolveProjectRepo(
  frontmatter: Record<string, unknown>,
  areaRepoMap: Map<string, string>
): string | undefined {
  const projectRepo = toStringField(frontmatter.repo);
  if (projectRepo) return projectRepo;
  const areaId = toStringField(frontmatter.area);
  if (!areaId) return undefined;
  return areaRepoMap.get(areaId);
}

async function listProjectItemsFromRoot(
  scanRoot: string,
  pathPrefix: string,
  areaRepoMap: Map<string, string>,
  areaFilter?: string
): Promise<ProjectListItem[]> {
  if (!(await dirExists(scanRoot))) return [];
  const entries = await fs.readdir(scanRoot, { withFileTypes: true });
  const projects: ProjectListItem[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirName = entry.name;
    if (dirName.startsWith(".")) continue;
    const dirPath = path.join(scanRoot, dirName);
    try {
      const dirEntries = await fs.readdir(dirPath, { withFileTypes: true });
      const mdFiles = dirEntries
        .filter(
          (e) => e.isFile() && e.name.endsWith(".md") && e.name !== THREAD_FILE
        )
        .map((e) => e.name);
      if (mdFiles.length === 0) continue;

      // Priority: README.md frontmatter > SPECS.md frontmatter > first .md file
      let frontmatter: Record<string, unknown> = {};
      let title = dirName;
      const specsFile = mdFiles.find((f) => f.toUpperCase() === "SPECS.MD");
      const readmeFile = mdFiles.find((f) => f.toUpperCase() === "README.MD");
      const primaryFile = readmeFile ?? specsFile ?? mdFiles[0];
      if (primaryFile) {
        const parsed = await readMarkdownIfExists(
          path.join(dirPath, primaryFile)
        );
        if (parsed) {
          frontmatter = parsed.frontmatter;
          title = parsed.title;
        }
      }

      const id = toStringField(frontmatter.id) ?? dirName.split("_")[0];
      const resolvedTitle = toStringField(frontmatter.title) ?? title;
      try {
        validateProjectStatus(frontmatter.status);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        projects.push({
          id,
          title: resolvedTitle,
          path: pathPrefix ? path.join(pathPrefix, dirName) : dirName,
          absolutePath: dirPath,
          repoValid: false,
          frontmatter: {
            ...frontmatter,
            id,
            title: resolvedTitle,
            statusValidationError: message,
          },
        });
        continue;
      }
      const resolvedRepo = resolveProjectRepo(frontmatter, areaRepoMap);
      const repoValid = await isValidGitRepo(resolvedRepo);
      const resolvedFrontmatter: Record<string, unknown> = {
        ...frontmatter,
        id,
        title: resolvedTitle,
      };
      if (resolvedRepo) {
        resolvedFrontmatter.repo = resolvedRepo;
      }
      if (areaFilter) {
        const projectArea = toStringField(resolvedFrontmatter.area);
        if (projectArea !== areaFilter) continue;
      }
      projects.push({
        id,
        title: resolvedTitle,
        path: pathPrefix ? path.join(pathPrefix, dirName) : dirName,
        absolutePath: dirPath,
        repoValid,
        frontmatter: resolvedFrontmatter,
      });
    } catch {
      // Skip unreadable project folder
    }
  }
  return projects;
}

export async function listProjects(
  config: GatewayConfig,
  options?: { area?: string }
): Promise<ProjectListResult> {
  const root = getProjectsRoot(config);
  if (!(await dirExists(root))) {
    return { ok: true, data: [] };
  }
  await migrateTrashRoot(root);
  const areaRepoMap = await getAreaRepoMap(config);
  const areaFilter = options?.area?.trim();
  const projects = [
    ...(await listProjectItemsFromRoot(root, "", areaRepoMap, areaFilter)),
    ...(await listProjectItemsFromRoot(
      path.join(root, DONE_DIR),
      DONE_DIR,
      areaRepoMap,
      areaFilter
    )),
  ];

  return { ok: true, data: projects };
}

export async function listArchivedProjects(
  config: GatewayConfig
): Promise<ProjectListResult> {
  const root = getProjectsRoot(config);
  const archiveRoot = path.join(root, ARCHIVE_DIR);
  if (!(await dirExists(archiveRoot))) {
    return { ok: true, data: [] };
  }
  const areaRepoMap = await getAreaRepoMap(config);
  const projects = await listProjectItemsFromRoot(
    archiveRoot,
    ARCHIVE_DIR,
    areaRepoMap
  );

  return { ok: true, data: projects };
}

export async function getProject(
  config: GatewayConfig,
  id: string
): Promise<ProjectItemResult> {
  const root = getProjectsRoot(config);
  const areaRepoMap = await getAreaRepoMap(config);
  await migrateTrashRoot(root);
  const location = await findProjectLocation(root, id, {
    includeArchived: true,
  });
  if (!location) {
    return { ok: false, error: `Project not found: ${id}` };
  }
  const { dirName, baseRoot } = location;

  const dirPath = path.join(baseRoot, dirName);
  const threadPath = path.join(dirPath, THREAD_FILE);
  const threadRaw = (await fileExists(threadPath))
    ? await fs.readFile(threadPath, "utf8")
    : "";
  const thread = threadRaw
    ? (parseThreadSections(threadRaw)
        .map(parseThreadEntry)
        .filter(Boolean) as ProjectThreadEntry[])
    : [];

  // Scan for all .md files at root (non-recursive)
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const mdFiles = entries
    .filter(
      (e) => e.isFile() && e.name.endsWith(".md") && e.name !== THREAD_FILE
    )
    .map((e) => e.name);

  // Build docs map
  const docs: Record<string, string> = {};
  let frontmatter: Record<string, unknown> = {};
  let title = dirName;
  const specsFile = mdFiles.find((f) => f.toUpperCase() === "SPECS.MD");
  const readmeFile = mdFiles.find((f) => f.toUpperCase() === "README.MD");

  for (const file of mdFiles) {
    const parsed = await readMarkdownIfExists(path.join(dirPath, file));
    if (parsed) {
      const key = file.replace(/\.md$/i, "").toUpperCase();
      docs[key] = parsed.content;
      // Use README.md frontmatter if available, else SPECS.md
      if (file === readmeFile) {
        frontmatter = parsed.frontmatter;
        title = parsed.title;
      } else if (file === specsFile && !readmeFile) {
        frontmatter = parsed.frontmatter;
        title = parsed.title;
      }
    }
  }

  const resolvedTitle = toStringField(frontmatter.title) ?? title;
  const resolvedId = toStringField(frontmatter.id) ?? id;
  try {
    validateProjectStatus(frontmatter.status);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const resolvedRepo = resolveProjectRepo(frontmatter, areaRepoMap);
  const repoValid = await isValidGitRepo(resolvedRepo);
  const resolvedFrontmatter: Record<string, unknown> = {
    ...frontmatter,
    id: resolvedId,
    title: resolvedTitle,
  };
  if (resolvedRepo) {
    resolvedFrontmatter.repo = resolvedRepo;
  }

  return {
    ok: true,
    data: {
      id: resolvedId,
      title: resolvedTitle,
      path: projectRelativePath(root, baseRoot, dirName),
      absolutePath: dirPath,
      repoValid,
      frontmatter: resolvedFrontmatter,
      docs,
      thread,
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
  await migrateTrashRoot(root);
  await ensureDir(root);
  const id = await allocateProjectId();
  const slug = slugifyTitle(trimmedTitle);
  const dirName = `${id}_${slug}`;
  const dirPath = path.join(root, dirName);

  await fs.mkdir(dirPath);

  const created = new Date().toISOString();
  let requestedStatus = "shaping";
  try {
    requestedStatus =
      validateProjectStatus(input.status ?? "shaping") ?? "shaping";
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const frontmatter: Record<string, unknown> = {
    id,
    title: trimmedTitle,
    status: requestedStatus,
    created,
  };
  if (input.area) frontmatter.area = input.area;
  const readmeBody = input.description
    ? `# ${trimmedTitle}\n\n${input.description}\n`
    : `# ${trimmedTitle}\n`;
  const readmeContent = formatMarkdown(frontmatter, readmeBody);
  await fs.writeFile(path.join(dirPath, "README.md"), readmeContent, "utf8");
  if (input.specs !== undefined) {
    await fs.writeFile(path.join(dirPath, "SPECS.md"), input.specs, "utf8");
  }
  await fs.writeFile(
    path.join(dirPath, THREAD_FILE),
    formatThreadFrontmatter(id),
    "utf8"
  );

  const docs: Record<string, string> = { README: readmeBody };
  if (input.specs !== undefined) {
    docs.SPECS = input.specs;
  }

  return {
    ok: true,
    data: {
      id,
      title: trimmedTitle,
      path: dirName,
      absolutePath: dirPath,
      repoValid: false,
      frontmatter,
      docs,
      thread: [],
    },
  };
}

export async function updateProject(
  config: GatewayConfig,
  id: string,
  input: UpdateProjectRequest
): Promise<ProjectItemResult> {
  const root = getProjectsRoot(config);
  await migrateTrashRoot(root);
  const location = await findProjectLocation(root, id);
  if (!location) {
    return { ok: false, error: `Project not found: ${id}` };
  }

  const { dirName, baseRoot } = location;
  const dirPath = path.join(baseRoot, dirName);
  const currentSpecsPath = path.join(dirPath, "SPECS.md");
  const currentReadmePath = path.join(dirPath, "README.md");
  const parsedSpecs = await readMarkdownIfExists(currentSpecsPath);
  const parsedReadme = await readMarkdownIfExists(currentReadmePath);
  const currentFrontmatter =
    parsedReadme?.frontmatter ?? parsedSpecs?.frontmatter ?? {};
  let currentStatus: string | null;
  try {
    currentStatus = validateProjectStatus(currentFrontmatter.status);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const currentTitle =
    toStringField(currentFrontmatter.title) ??
    parsedReadme?.title ??
    parsedSpecs?.title ??
    id;
  const nextTitle = input.title ?? currentTitle;
  const nextSlug = slugifyTitle(nextTitle);
  const nextDirName = `${id}_${nextSlug}`;
  let requestedStatus: string | null;
  try {
    requestedStatus =
      input.status !== undefined
        ? validateProjectStatus(input.status)
        : currentStatus;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const nextStatus = requestedStatus ?? currentStatus;
  const nextBaseRoot =
    nextStatus && DONE_STATUSES.has(nextStatus)
      ? path.join(root, DONE_DIR)
      : input.status && baseRoot === path.join(root, DONE_DIR)
        ? root
        : baseRoot;
  let finalDirName = dirName;
  let finalBaseRoot = baseRoot;

  if (nextDirName !== dirName || nextBaseRoot !== baseRoot) {
    await ensureDir(nextBaseRoot);
    const targetPath = path.join(nextBaseRoot, nextDirName);
    if (await dirExists(targetPath)) {
      return { ok: false, error: `Project already exists: ${nextDirName}` };
    }
    await fs.rename(dirPath, targetPath);
    finalDirName = nextDirName;
    finalBaseRoot = nextBaseRoot;
  }

  const finalDirPath = path.join(finalBaseRoot, finalDirName);

  let nextFrontmatter: Record<string, unknown> = {
    ...currentFrontmatter,
    id,
    title: nextTitle,
    ...(nextStatus ? { status: nextStatus } : {}),
  };

  if (input.repo === "") delete nextFrontmatter.repo;
  else if (input.repo) nextFrontmatter.repo = input.repo;

  if (input.area === "") delete nextFrontmatter.area;
  else if (input.area) nextFrontmatter.area = input.area;

  if (input.sessionKeys === null) delete nextFrontmatter.sessionKeys;
  else if (input.sessionKeys) nextFrontmatter.sessionKeys = input.sessionKeys;

  // Handle docs updates (new format)
  if (input.docs) {
    for (const [key, content] of Object.entries(input.docs)) {
      const fileName = `${key}.md`;
      const filePath = path.join(finalDirPath, fileName);
      // README.md gets frontmatter
      if (key === "README") {
        await fs.writeFile(
          filePath,
          formatMarkdown(nextFrontmatter, content),
          "utf8"
        );
      } else {
        await fs.writeFile(filePath, content, "utf8");
      }
    }
  }

  // Handle legacy readme/specs updates
  if (input.readme !== undefined && !input.docs?.README) {
    await fs.writeFile(
      path.join(finalDirPath, "README.md"),
      formatMarkdown(nextFrontmatter, input.readme),
      "utf8"
    );
  }
  if (input.specs !== undefined && !input.docs?.SPECS) {
    await fs.writeFile(
      path.join(finalDirPath, "SPECS.md"),
      input.specs,
      "utf8"
    );
  }

  // Ensure frontmatter update even if no docs changed
  if (!input.docs?.README && input.readme === undefined) {
    const existingReadme = parsedReadme?.content ?? "";
    await fs.writeFile(
      path.join(finalDirPath, "README.md"),
      formatMarkdown(nextFrontmatter, existingReadme),
      "utf8"
    );
  }

  const finalThreadPath = path.join(finalDirPath, THREAD_FILE);
  if (!(await fileExists(finalThreadPath))) {
    await fs.writeFile(finalThreadPath, formatThreadFrontmatter(id), "utf8");
  }

  if (nextStatus === "cancelled") {
    await cascadeProjectCancellation(finalDirPath);
  }

  const slicesAfterUpdate = await listSlices(finalDirPath);
  if (shouldAutoMarkProjectDone(nextStatus ?? null, slicesAfterUpdate)) {
    nextFrontmatter = {
      ...nextFrontmatter,
      status: "done",
    };
    const existingReadme = await readMarkdownIfExists(
      path.join(finalDirPath, "README.md")
    );
    await fs.writeFile(
      path.join(finalDirPath, "README.md"),
      formatMarkdown(nextFrontmatter, existingReadme?.content ?? ""),
      "utf8"
    );
  }

  // Re-read all docs
  const entries = await fs.readdir(finalDirPath, { withFileTypes: true });
  const mdFiles = entries
    .filter(
      (e) => e.isFile() && e.name.endsWith(".md") && e.name !== THREAD_FILE
    )
    .map((e) => e.name);

  const docs: Record<string, string> = {};
  for (const file of mdFiles) {
    const parsed = await readMarkdownIfExists(path.join(finalDirPath, file));
    if (parsed) {
      const key = file.replace(/\.md$/i, "").toUpperCase();
      docs[key] = parsed.content;
    }
  }

  const areaRepoMap = await getAreaRepoMap(config);
  const resolvedRepo = resolveProjectRepo(nextFrontmatter, areaRepoMap);
  const repoValid = await isValidGitRepo(resolvedRepo);
  const resolvedFrontmatter = { ...nextFrontmatter };
  if (resolvedRepo) {
    resolvedFrontmatter.repo = resolvedRepo;
  }

  return {
    ok: true,
    data: {
      id,
      title: nextTitle,
      path: projectRelativePath(root, finalBaseRoot, finalDirName),
      absolutePath: finalDirPath,
      repoValid,
      frontmatter: resolvedFrontmatter,
      docs,
      thread: [],
    },
  };
}

export async function deleteProject(
  config: GatewayConfig,
  id: string
): Promise<DeleteProjectResult> {
  const root = getProjectsRoot(config);
  const location = await findProjectLocation(root, id);
  if (!location) {
    return { ok: false, error: `Project not found: ${id}` };
  }

  await migrateTrashRoot(root);
  const trashRoot = path.join(root, TRASH_DIR);
  await ensureDir(trashRoot);

  const sourcePath = path.join(location.baseRoot, location.dirName);
  const targetPath = path.join(trashRoot, location.dirName);
  if (await dirExists(targetPath)) {
    return {
      ok: false,
      error: `Trash already contains project: ${location.dirName}`,
    };
  }

  await fs.rename(sourcePath, targetPath);

  return {
    ok: true,
    data: {
      id,
      path: location.path,
      trashedPath: path.join(TRASH_DIR, location.dirName),
    },
  };
}

export async function archiveProject(
  config: GatewayConfig,
  id: string
): Promise<ArchiveProjectResult> {
  const root = getProjectsRoot(config);
  const location = await findProjectLocation(root, id);
  if (!location) {
    return { ok: false, error: `Project not found: ${id}` };
  }

  const archiveRoot = path.join(root, ARCHIVE_DIR);
  await ensureDir(archiveRoot);

  const targetPath = path.join(archiveRoot, location.dirName);
  if (await dirExists(targetPath)) {
    return {
      ok: false,
      error: `Archive already contains project: ${location.dirName}`,
    };
  }

  const updated = await updateProject(config, id, { status: "archived" });
  if (!updated.ok) {
    return { ok: false, error: updated.error };
  }

  const sourcePath = updated.data.absolutePath;
  const dirName = path.basename(sourcePath);
  await fs.rename(sourcePath, targetPath);

  return {
    ok: true,
    data: { id, path: dirName, archivedPath: path.join(ARCHIVE_DIR, dirName) },
  };
}

export async function unarchiveProject(
  config: GatewayConfig,
  id: string,
  nextStatus: ProjectStatus
): Promise<UnarchiveProjectResult> {
  const root = getProjectsRoot(config);
  const archiveRoot = path.join(root, ARCHIVE_DIR);
  const dirName = await findProjectDir(archiveRoot, id);
  if (!dirName) {
    return { ok: false, error: `Project not found: ${id}` };
  }

  const sourcePath = path.join(archiveRoot, dirName);
  const targetPath = path.join(root, dirName);
  if (await dirExists(targetPath)) {
    return { ok: false, error: `Project already exists: ${dirName}` };
  }

  await fs.rename(sourcePath, targetPath);
  const updated = await updateProject(config, id, { status: nextStatus });
  if (!updated.ok) {
    return { ok: false, error: updated.error };
  }

  return { ok: true, data: { id, path: dirName } };
}

export type ProjectCommentResult =
  | { ok: true; data: ProjectThreadEntry }
  | { ok: false; error: string };

export async function appendProjectComment(
  config: GatewayConfig,
  projectId: string,
  entry: ProjectThreadEntry
): Promise<ProjectCommentResult> {
  const root = getProjectsRoot(config);
  const location = await findProjectLocation(root, projectId);
  if (!location) {
    return { ok: false, error: `Project not found: ${projectId}` };
  }

  const threadPath = path.join(
    location.baseRoot,
    location.dirName,
    THREAD_FILE
  );
  const formatted = formatThreadEntry(entry);
  if (!(await fileExists(threadPath))) {
    const initial = formatThreadFrontmatter(projectId) + formatted;
    await fs.writeFile(threadPath, initial, "utf8");
    return { ok: true, data: entry };
  }

  const raw = await fs.readFile(threadPath, "utf8");
  const fmMatch = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  const prefix = fmMatch ? fmMatch[0] : formatThreadFrontmatter(projectId);
  const rest = fmMatch ? raw.slice(fmMatch[0].length) : raw;
  const separator = rest.trim() ? "\n---\n---\n\n" : "\n";
  const next = `${prefix}${rest}${separator}${formatted}`;
  await fs.writeFile(threadPath, next, "utf8");
  return { ok: true, data: entry };
}

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
]);
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

async function generateUniqueName(
  dir: string,
  baseName: string
): Promise<string> {
  const ext = path.extname(baseName);
  const nameWithoutExt = path.basename(baseName, ext);
  let candidate = baseName;
  let counter = 1;
  while (
    await fs
      .access(path.join(dir, candidate))
      .then(() => true)
      .catch(() => false)
  ) {
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
  const location = await findProjectLocation(root, projectId);
  if (!location) {
    return { ok: false, error: `Project not found: ${projectId}` };
  }

  const attachmentsDir = path.join(
    location.baseRoot,
    location.dirName,
    "attachments"
  );
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
  const location = await findProjectLocation(root, projectId);
  if (!location) {
    return { ok: false, error: `Project not found: ${projectId}` };
  }
  if (!fileName || fileName === "." || fileName === "..") {
    return { ok: false, error: "Invalid attachment name" };
  }
  if (
    fileName !== path.basename(fileName) ||
    fileName.includes("/") ||
    fileName.includes("\\")
  ) {
    return { ok: false, error: "Invalid attachment name" };
  }

  const attachmentsDir = path.join(
    location.baseRoot,
    location.dirName,
    "attachments"
  );
  const filePath = path.join(attachmentsDir, fileName);
  if (!(await fileExists(filePath))) {
    return { ok: false, error: "Attachment not found" };
  }
  return { ok: true, data: { path: filePath, name: fileName } };
}

export async function updateProjectComment(
  config: GatewayConfig,
  projectId: string,
  index: number,
  body: string
): Promise<ProjectCommentResult> {
  const root = getProjectsRoot(config);
  const location = await findProjectLocation(root, projectId);
  if (!location) {
    return { ok: false, error: `Project not found: ${projectId}` };
  }

  const threadPath = path.join(
    location.baseRoot,
    location.dirName,
    THREAD_FILE
  );
  if (!(await fileExists(threadPath))) {
    return { ok: false, error: "Thread file not found" };
  }

  const raw = await fs.readFile(threadPath, "utf8");
  const fmMatch = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  const prefix = fmMatch ? fmMatch[0] : formatThreadFrontmatter(projectId);
  const sections = parseThreadSections(raw);

  if (index < 0 || index >= sections.length) {
    return { ok: false, error: "Comment not found" };
  }

  const entry = parseThreadEntry(sections[index]);
  if (!entry) {
    return { ok: false, error: "Failed to parse comment" };
  }

  const updatedEntry = { ...entry, body };
  sections[index] =
    `[author:${updatedEntry.author}]\n[date:${updatedEntry.date}]\n${body.trim()}`;

  const next = prefix + sections.map((s) => s + "\n").join("\n---\n---\n\n");
  await fs.writeFile(threadPath, next, "utf8");

  return { ok: true, data: updatedEntry };
}

export type DeleteCommentResult =
  | { ok: true; data: { index: number } }
  | { ok: false; error: string };

export async function deleteProjectComment(
  config: GatewayConfig,
  projectId: string,
  index: number
): Promise<DeleteCommentResult> {
  const root = getProjectsRoot(config);
  const location = await findProjectLocation(root, projectId);
  if (!location) {
    return { ok: false, error: `Project not found: ${projectId}` };
  }

  const threadPath = path.join(
    location.baseRoot,
    location.dirName,
    THREAD_FILE
  );
  if (!(await fileExists(threadPath))) {
    return { ok: false, error: "Thread file not found" };
  }

  const raw = await fs.readFile(threadPath, "utf8");
  const fmMatch = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  const prefix = fmMatch ? fmMatch[0] : formatThreadFrontmatter(projectId);
  const sections = parseThreadSections(raw);

  if (index < 0 || index >= sections.length) {
    return { ok: false, error: "Comment not found" };
  }

  sections.splice(index, 1);

  const next =
    sections.length > 0
      ? prefix + sections.map((s) => s + "\n").join("\n---\n---\n\n")
      : prefix;
  await fs.writeFile(threadPath, next, "utf8");

  return { ok: true, data: { index } };
}
