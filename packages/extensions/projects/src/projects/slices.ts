import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseMarkdownFile } from "../taskboard/parser.js";

const COUNTERS_FILE = "counters.json";
const README_FILE = "README.md";
const SPECS_FILE = "SPECS.md";
const TASKS_FILE = "TASKS.md";
const VALIDATION_FILE = "VALIDATION.md";
const THREAD_FILE = "THREAD.md";
const META_DIR = ".meta";
const SLICES_DIR = "slices";
const LOCK_DIR = ".slice-counter.lock";
const SCOPE_MAP_LOCK_DIR = ".scope-map.lock";
const SCOPE_MAP_FILE = "SCOPE_MAP.md";
const PROJECT_ID_PATTERN = /^PRO-\d+$/;
const SLICE_ID_PATTERN = /^PRO-\d+-S\d+$/;

export type SliceStatus =
  | "todo"
  | "in_progress"
  | "review"
  | "ready_to_merge"
  | "done"
  | "cancelled";

export type SliceHillPosition = "figuring" | "executing" | "done";

export type SliceFrontmatter = {
  id: string;
  project_id: string;
  title: string;
  status: SliceStatus;
  hill_position: SliceHillPosition;
  created_at: string;
  updated_at: string;
} & Record<string, unknown>;

export type SliceRecord = {
  id: string;
  projectId: string;
  dirPath: string;
  frontmatter: SliceFrontmatter;
  docs: {
    readme: string;
    specs: string;
    tasks: string;
    validation: string;
    thread: string;
  };
};

export type CreateSliceInput = {
  projectId: string;
  title: string;
  status?: SliceStatus;
  hillPosition?: SliceHillPosition;
  readme?: string;
  specs?: string;
  tasks?: string;
  validation?: string;
  thread?: string;
};

export type UpdateSliceInput = {
  title?: string;
  status?: SliceStatus;
  hillPosition?: SliceHillPosition;
  readme?: string;
  specs?: string;
  tasks?: string;
  validation?: string;
  thread?: string;
  frontmatter?: Record<string, unknown>;
};

function formatFrontmatterValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function formatFrontmatter(frontmatter: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (value === undefined) continue;
    lines.push(`${key}: ${formatFrontmatterValue(value)}`);
  }
  return `---\n${lines.join("\n")}\n---\n`;
}

function toMarkdown(frontmatter: Record<string, unknown>, content: string): string {
  return `${formatFrontmatter(frontmatter)}${content}`;
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  const name = path.basename(filePath);
  const tmpPath = path.join(dir, `.${name}.${process.pid}.${Date.now()}.tmp`);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(tmpPath, content, "utf8");
  await fs.rename(tmpPath, filePath);
}

async function withProjectLock<T>(
  projectDir: string,
  lockDirName: string,
  task: () => Promise<T>
): Promise<T> {
  const lockPath = path.join(projectDir, META_DIR, lockDirName);
  await fs.mkdir(path.join(projectDir, META_DIR), { recursive: true });
  while (true) {
    try {
      await fs.mkdir(lockPath);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  try {
    return await task();
  } finally {
    await fs.rm(lockPath, { recursive: true, force: true });
  }
}

async function withCounterLock<T>(projectDir: string, task: () => Promise<T>): Promise<T> {
  return withProjectLock(projectDir, LOCK_DIR, task);
}

async function withScopeMapLock<T>(projectDir: string, task: () => Promise<T>): Promise<T> {
  return withProjectLock(projectDir, SCOPE_MAP_LOCK_DIR, task);
}

type CountersState = { lastSliceId: number };

function assertValidProjectId(projectId: string): void {
  if (!PROJECT_ID_PATTERN.test(projectId)) {
    throw new Error(`Invalid projectId: ${projectId}`);
  }
}

function assertValidSliceId(sliceId: string): void {
  if (!SLICE_ID_PATTERN.test(sliceId)) {
    throw new Error(`Invalid sliceId: ${sliceId}`);
  }
}

function formatSliceId(projectId: string, sliceNumber: number): string {
  return `${projectId}-S${String(sliceNumber).padStart(2, "0")}`;
}

async function allocateSliceId(projectDir: string, projectId: string): Promise<string> {
  return withCounterLock(projectDir, async () => {
    const countersPath = path.join(projectDir, META_DIR, COUNTERS_FILE);
    const state = await readJsonFile<CountersState>(countersPath, { lastSliceId: 0 });
    const next = state.lastSliceId + 1;
    await writeFileAtomic(countersPath, JSON.stringify({ lastSliceId: next }, null, 2));
    await fs.mkdir(path.join(projectDir, SLICES_DIR), { recursive: true });
    return formatSliceId(projectId, next);
  });
}

function coerceFrontmatter(frontmatter: Record<string, unknown>): SliceFrontmatter {
  return frontmatter as SliceFrontmatter;
}

type ScopeMapRow = {
  id: string;
  title: string;
  status: string;
  hillPosition: string;
};

function escapeCell(value: string): string {
  return value.replace(/\r?\n/g, "<br>").replace(/\|/g, "\\|");
}

function renderScopeMap(projectId: string, rows: ScopeMapRow[]): string {
  const lines = [
    "<!-- Auto-generated by aihub. Do not edit by hand. -->",
    `# Scope map — ${projectId}`,
    "",
    "| Slice | Title | Status | Hill |",
    "|-------|-------|--------|------|",
  ];

  for (const row of rows) {
    lines.push(
      `| ${escapeCell(row.id)} | ${escapeCell(row.title)} | ${escapeCell(row.status)} | ${escapeCell(row.hillPosition)} |`
    );
  }

  lines.push("");
  return lines.join("\n");
}

export async function regenerateScopeMap(projectDir: string, projectId: string): Promise<void> {
  assertValidProjectId(projectId);

  await withScopeMapLock(projectDir, async () => {
    const slicesDir = path.join(projectDir, SLICES_DIR);
    const rows: ScopeMapRow[] = [];

    try {
      const entries = await fs.readdir(slicesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const readmePath = path.join(slicesDir, entry.name, README_FILE);
        try {
          const parsed = await parseMarkdownFile(readmePath);
          const frontmatter = coerceFrontmatter(parsed.frontmatter);
          const id = String(frontmatter.id ?? entry.name);
          rows.push({
            id,
            title: String(frontmatter.title ?? ""),
            status: String(frontmatter.status ?? ""),
            hillPosition: String(frontmatter.hill_position ?? ""),
          });
        } catch {
          // ignore invalid/incomplete slice dir entries
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    rows.sort((a, b) => a.id.localeCompare(b.id));
    const content = renderScopeMap(projectId, rows);
    await writeFileAtomic(path.join(projectDir, SCOPE_MAP_FILE), content);
  });
}

export async function createSlice(projectDir: string, input: CreateSliceInput): Promise<SliceRecord> {
  assertValidProjectId(input.projectId);
  const now = new Date().toISOString();
  const id = await allocateSliceId(projectDir, input.projectId);
  const sliceDir = path.join(projectDir, SLICES_DIR, id);
  await fs.mkdir(sliceDir, { recursive: true });

  const readmeBody = input.readme ?? "## Must\n\n## Nice\n";
  const frontmatter: SliceFrontmatter = {
    id,
    project_id: input.projectId,
    title: input.title,
    status: input.status ?? "todo",
    hill_position: input.hillPosition ?? "figuring",
    created_at: now,
    updated_at: now,
  };

  await Promise.all([
    writeFileAtomic(path.join(sliceDir, README_FILE), toMarkdown(frontmatter, readmeBody)),
    writeFileAtomic(path.join(sliceDir, SPECS_FILE), input.specs ?? ""),
    writeFileAtomic(path.join(sliceDir, TASKS_FILE), input.tasks ?? ""),
    writeFileAtomic(path.join(sliceDir, VALIDATION_FILE), input.validation ?? ""),
    writeFileAtomic(path.join(sliceDir, THREAD_FILE), input.thread ?? ""),
  ]);

  await regenerateScopeMap(projectDir, input.projectId);
  return getSlice(projectDir, id);
}

export async function getSlice(projectDir: string, sliceId: string): Promise<SliceRecord> {
  assertValidSliceId(sliceId);
  const sliceDir = path.join(projectDir, SLICES_DIR, sliceId);
  const parsed = await parseMarkdownFile(path.join(sliceDir, README_FILE));
  const [specs, tasks, validation, thread] = await Promise.all([
    fs.readFile(path.join(sliceDir, SPECS_FILE), "utf8").catch(() => ""),
    fs.readFile(path.join(sliceDir, TASKS_FILE), "utf8").catch(() => ""),
    fs.readFile(path.join(sliceDir, VALIDATION_FILE), "utf8").catch(() => ""),
    fs.readFile(path.join(sliceDir, THREAD_FILE), "utf8").catch(() => ""),
  ]);

  const frontmatter = coerceFrontmatter(parsed.frontmatter);
  return {
    id: sliceId,
    projectId: String(frontmatter.project_id),
    dirPath: sliceDir,
    frontmatter,
    docs: {
      readme: parsed.content,
      specs,
      tasks,
      validation,
      thread,
    },
  };
}

export async function updateSlice(
  projectDir: string,
  sliceId: string,
  input: UpdateSliceInput
): Promise<SliceRecord> {
  assertValidSliceId(sliceId);
  const current = await getSlice(projectDir, sliceId);
  const now = new Date().toISOString();
  const nextFrontmatter: SliceFrontmatter = {
    ...current.frontmatter,
    ...(input.frontmatter ?? {}),
    ...(input.title ? { title: input.title } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.hillPosition ? { hill_position: input.hillPosition } : {}),
    updated_at: now,
  };

  const sliceDir = current.dirPath;
  await Promise.all([
    writeFileAtomic(
      path.join(sliceDir, README_FILE),
      toMarkdown(nextFrontmatter, input.readme ?? current.docs.readme)
    ),
    input.specs !== undefined
      ? writeFileAtomic(path.join(sliceDir, SPECS_FILE), input.specs)
      : Promise.resolve(),
    input.tasks !== undefined
      ? writeFileAtomic(path.join(sliceDir, TASKS_FILE), input.tasks)
      : Promise.resolve(),
    input.validation !== undefined
      ? writeFileAtomic(path.join(sliceDir, VALIDATION_FILE), input.validation)
      : Promise.resolve(),
    input.thread !== undefined
      ? writeFileAtomic(path.join(sliceDir, THREAD_FILE), input.thread)
      : Promise.resolve(),
  ]);

  return getSlice(projectDir, sliceId);
}

export async function readSliceCounters(projectDir: string): Promise<CountersState> {
  return readJsonFile(path.join(projectDir, META_DIR, COUNTERS_FILE), { lastSliceId: 0 });
}
