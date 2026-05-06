import * as fs from "node:fs/promises";
import * as path from "node:path";
import { parseMarkdownFile } from "../taskboard/parser.js";
import { emitSliceSpecsFallbackHint } from "./fallback-hints.js";
import * as documentStore from "./document-store.js";

const COUNTERS_FILE = "counters.json";
const README_FILE = documentStore.README_FILE;
const SPECS_FILE = documentStore.SPECS_FILE;
const TASKS_FILE = documentStore.TASKS_FILE;
const VALIDATION_FILE = documentStore.VALIDATION_FILE;
const THREAD_FILE = documentStore.THREAD_FILE;
const META_DIR = documentStore.META_DIR;
const SLICES_DIR = documentStore.SLICES_DIR;

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
  repo?: string;
  merger_conflict?: {
    summary: string;
    at: string;
    source: "merger_outcome" | "merger_comment";
  };
  blocked_by?: string[];
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
  sliceId?: string;
  status?: SliceStatus;
  hillPosition?: SliceHillPosition;
  repo?: string;
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

function toMarkdown(
  frontmatter: Record<string, unknown>,
  content: string
): string {
  return documentStore.formatMarkdown(frontmatter, content);
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function withCounterLock<T>(
  projectDir: string,
  task: () => Promise<T>
): Promise<T> {
  return documentStore.withCounterLock(projectDir, task);
}

type CountersState = { lastSliceId: number };

export function normalizeRepoValue(repo: unknown): string | undefined {
  return documentStore.normalizeRepoValue(repo);
}

async function assertValidSliceRepo(
  repo: unknown
): Promise<string | undefined> {
  return documentStore.assertValidSliceRepo(repo);
}

export async function assertSliceRepoInvariant(
  projectDir: string,
  sliceFrontmatter: Pick<SliceFrontmatter, "project_id" | "repo">,
  action: "create" | "update"
): Promise<void> {
  await documentStore.assertSliceRepoInvariant(
    projectDir,
    sliceFrontmatter,
    action
  );
}

function formatSliceId(projectId: string, sliceNumber: number): string {
  return `${projectId}-S${String(sliceNumber).padStart(2, "0")}`;
}

function parseSliceNumber(projectId: string, candidate: string): number | null {
  const prefix = `${projectId}-S`;
  if (!candidate.startsWith(prefix)) return null;
  const suffix = candidate.slice(prefix.length);
  if (!/^\d+$/.test(suffix)) return null;
  return Number.parseInt(suffix, 10);
}

async function findMaxSliceNumberOnDisk(
  projectDir: string,
  projectId: string
): Promise<number> {
  const slicesDir = path.join(projectDir, SLICES_DIR);
  let max = 0;

  async function visit(dir: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const sliceNumber = parseSliceNumber(projectId, entry.name);
      if (sliceNumber !== null) max = Math.max(max, sliceNumber);
      await visit(path.join(dir, entry.name));
    }
  }

  await visit(slicesDir);
  return max;
}

async function allocateSliceId(
  projectDir: string,
  projectId: string
): Promise<string> {
  return withCounterLock(projectDir, async () => {
    const countersPath = path.join(projectDir, META_DIR, COUNTERS_FILE);
    const state = await readJsonFile<CountersState>(countersPath, {
      lastSliceId: 0,
    });
    const maxOnDisk = await findMaxSliceNumberOnDisk(projectDir, projectId);
    const next = Math.max(state.lastSliceId, maxOnDisk) + 1;
    await documentStore.writeFileAtomic(
      countersPath,
      JSON.stringify({ lastSliceId: next }, null, 2)
    );
    await fs.mkdir(path.join(projectDir, SLICES_DIR), { recursive: true });
    return formatSliceId(projectId, next);
  });
}

async function reserveSliceId(
  projectDir: string,
  projectId: string,
  requestedId?: string
): Promise<string> {
  if (!requestedId) return allocateSliceId(projectDir, projectId);
  documentStore.assertValidSliceId(requestedId);
  if (!requestedId.startsWith(`${projectId}-S`)) {
    throw new Error(
      `sliceId ${requestedId} does not belong to project ${projectId}`
    );
  }

  return withCounterLock(projectDir, async () => {
    const countersPath = path.join(projectDir, META_DIR, COUNTERS_FILE);
    const state = await readJsonFile<CountersState>(countersPath, {
      lastSliceId: 0,
    });
    const maxOnDisk = await findMaxSliceNumberOnDisk(projectDir, projectId);
    const maxEver = Math.max(state.lastSliceId, maxOnDisk);
    const requestedNumber = parseSliceNumber(projectId, requestedId);
    if (requestedNumber === null || requestedNumber <= maxEver) {
      throw new Error(`Slice id already assigned: ${requestedId}`);
    }
    await documentStore.writeFileAtomic(
      countersPath,
      JSON.stringify({ lastSliceId: requestedNumber }, null, 2)
    );
    await fs.mkdir(path.join(projectDir, SLICES_DIR), { recursive: true });
    return requestedId;
  });
}

function coerceFrontmatter(
  frontmatter: Record<string, unknown>
): SliceFrontmatter {
  return frontmatter as SliceFrontmatter;
}

export async function regenerateScopeMap(
  projectDir: string,
  projectId: string
): Promise<void> {
  await documentStore.regenerateScopeMap(projectDir, projectId);
}

export async function createSlice(
  projectDir: string,
  input: CreateSliceInput
): Promise<SliceRecord> {
  documentStore.assertValidProjectId(input.projectId);
  const now = new Date().toISOString();
  const repo = await assertValidSliceRepo(input.repo);
  await assertSliceRepoInvariant(
    projectDir,
    { project_id: input.projectId, repo },
    "create"
  );
  const id = await reserveSliceId(projectDir, input.projectId, input.sliceId);
  const sliceDir = path.join(projectDir, SLICES_DIR, id);
  await fs.mkdir(path.join(projectDir, SLICES_DIR), { recursive: true });
  await fs.mkdir(sliceDir);

  const readmeBody = input.readme ?? "";
  const frontmatter: SliceFrontmatter = {
    id,
    project_id: input.projectId,
    title: input.title,
    status: input.status ?? "todo",
    repo,
    hill_position: input.hillPosition ?? "figuring",
    created_at: now,
    updated_at: now,
  };

  await Promise.all([
    documentStore.writeFileAtomic(
      path.join(sliceDir, README_FILE),
      toMarkdown(frontmatter, readmeBody)
    ),
    documentStore.writeFileAtomic(
      path.join(sliceDir, SPECS_FILE),
      input.specs ?? ""
    ),
    documentStore.writeFileAtomic(
      path.join(sliceDir, TASKS_FILE),
      input.tasks ?? ""
    ),
    documentStore.writeFileAtomic(
      path.join(sliceDir, VALIDATION_FILE),
      input.validation ?? ""
    ),
    documentStore.writeFileAtomic(
      path.join(sliceDir, THREAD_FILE),
      input.thread ?? ""
    ),
  ]);

  await regenerateScopeMap(projectDir, input.projectId);
  return getSlice(projectDir, id);
}

export async function getSlice(
  projectDir: string,
  sliceId: string
): Promise<SliceRecord> {
  documentStore.assertValidSliceId(sliceId);
  const sliceDir = path.join(projectDir, SLICES_DIR, sliceId);
  const parsed = await parseMarkdownFile(path.join(sliceDir, README_FILE));
  const [specs, tasks, validation, thread] = await Promise.all([
    fs.readFile(path.join(sliceDir, SPECS_FILE), "utf8").catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        emitSliceSpecsFallbackHint(sliceId);
        return parsed.content;
      }
      throw error;
    }),
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

export async function listSlices(projectDir: string): Promise<SliceRecord[]> {
  const slicesRoot = path.join(projectDir, SLICES_DIR);
  try {
    const entries = await fs.readdir(slicesRoot, { withFileTypes: true });
    const ids = entries
      .filter(
        (entry) =>
          entry.isDirectory() && documentStore.isSliceDirName(entry.name)
      )
      .map((entry) => entry.name)
      .sort();
    return Promise.all(ids.map((id) => getSlice(projectDir, id)));
  } catch {
    return [];
  }
}

export async function updateSlice(
  projectDir: string,
  sliceId: string,
  input: UpdateSliceInput
): Promise<SliceRecord> {
  documentStore.assertValidSliceId(sliceId);
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
  if (
    Array.isArray(nextFrontmatter.blocked_by) &&
    nextFrontmatter.blocked_by.length === 0
  ) {
    nextFrontmatter.blocked_by = undefined;
  }
  if (input.status && input.status !== "ready_to_merge") {
    nextFrontmatter.merger_conflict = undefined;
  }
  nextFrontmatter.repo = await assertValidSliceRepo(nextFrontmatter.repo);
  await assertSliceRepoInvariant(projectDir, nextFrontmatter, "update");

  const sliceDir = current.dirPath;
  await Promise.all([
    documentStore.writeFileAtomic(
      path.join(sliceDir, README_FILE),
      toMarkdown(nextFrontmatter, input.readme ?? current.docs.readme)
    ),
    input.specs !== undefined
      ? documentStore.writeFileAtomic(
          path.join(sliceDir, SPECS_FILE),
          input.specs
        )
      : Promise.resolve(),
    input.tasks !== undefined
      ? documentStore.writeFileAtomic(
          path.join(sliceDir, TASKS_FILE),
          input.tasks
        )
      : Promise.resolve(),
    input.validation !== undefined
      ? documentStore.writeFileAtomic(
          path.join(sliceDir, VALIDATION_FILE),
          input.validation
        )
      : Promise.resolve(),
    input.thread !== undefined
      ? documentStore.writeFileAtomic(
          path.join(sliceDir, THREAD_FILE),
          input.thread
        )
      : Promise.resolve(),
  ]);

  const updated = await getSlice(projectDir, sliceId);

  await regenerateScopeMap(projectDir, updated.frontmatter.project_id);

  if (
    updated.frontmatter.status === "done" ||
    updated.frontmatter.status === "cancelled"
  ) {
    const projectReadmePath = path.join(projectDir, README_FILE);
    try {
      const projectDoc = await parseMarkdownFile(projectReadmePath);
      const projectStatus = String(projectDoc.frontmatter.status ?? "").trim();
      if (projectStatus === "active") {
        const slices = await listSlices(projectDir);
        const hasDone = slices.some(
          (slice) => slice.frontmatter.status === "done"
        );
        const allTerminal =
          slices.length > 0 &&
          slices.every(
            (slice) =>
              slice.frontmatter.status === "done" ||
              slice.frontmatter.status === "cancelled"
          );
        if (hasDone && allTerminal) {
          const nextFrontmatter = {
            ...projectDoc.frontmatter,
            status: "done",
          };
          await documentStore.writeFileAtomic(
            projectReadmePath,
            toMarkdown(nextFrontmatter, projectDoc.content)
          );
        }
      }
    } catch {
      // best-effort only
    }
  }

  return updated;
}

export async function readSliceCounters(
  projectDir: string
): Promise<CountersState> {
  return readJsonFile(path.join(projectDir, META_DIR, COUNTERS_FILE), {
    lastSliceId: 0,
  });
}
