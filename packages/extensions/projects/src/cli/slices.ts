import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Command } from "commander";
import type { GatewayConfig } from "@aihub/shared";
import { resolveHomeDir } from "@aihub/shared";
import {
  createSlice,
  getSlice,
  updateSlice,
  type SliceRecord,
  type SliceStatus,
} from "../projects/slices.js";
import { parseMarkdownFile } from "../taskboard/parser.js";
import { getProjectsRoot } from "../util/paths.js";

const PROJECT_ID_PATTERN = /^PRO-\d+$/;
const ARCHIVE_DIR = ".archive";
const DONE_DIR = ".done";

type ProjectLocation = { id: string; dirPath: string };
type SliceListItem = {
  id: string;
  projectId: string;
  title: string;
  status: string;
  hillPosition: string;
  updatedAt: string;
};

function fail(err: unknown): never {
  if (err instanceof Error) console.error(err.message);
  else console.error("Request failed");
  process.exit(1);
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

function getProjectsConfigPath(): string {
  return path.join(resolveHomeDir(), "aihub.json");
}

async function loadGatewayConfig(): Promise<GatewayConfig> {
  try {
    const raw = await fs.readFile(getProjectsConfigPath(), "utf8");
    return JSON.parse(raw) as GatewayConfig;
  } catch {
    return { agents: [], extensions: {}, sessions: {} } as GatewayConfig;
  }
}

async function getProjectsRootDir(): Promise<string> {
  const config = await loadGatewayConfig();
  return getProjectsRoot(config);
}

async function listProjectLocations(): Promise<ProjectLocation[]> {
  const root = await getProjectsRootDir();
  const roots = [root, path.join(root, ARCHIVE_DIR), path.join(root, DONE_DIR)];
  const found = new Map<string, ProjectLocation>();

  for (const base of roots) {
    if (!(await pathExists(base))) continue;
    const entries = await fs.readdir(base, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const match = entry.name.match(/^(PRO-\d+)/);
      if (!match) continue;
      const id = match[1];
      if (!PROJECT_ID_PATTERN.test(id)) continue;
      if (!found.has(id)) {
        found.set(id, { id, dirPath: path.join(base, entry.name) });
      }
    }
  }

  return [...found.values()].sort((a, b) => a.id.localeCompare(b.id));
}

async function findProjectLocation(projectId: string): Promise<ProjectLocation | null> {
  const normalized = projectId.trim().toUpperCase();
  if (!PROJECT_ID_PATTERN.test(normalized)) {
    throw new Error(`Invalid projectId: ${projectId}`);
  }
  const projects = await listProjectLocations();
  return projects.find((project) => project.id === normalized) ?? null;
}

async function listSlicesForProject(project: ProjectLocation): Promise<SliceListItem[]> {
  const slicesDir = path.join(project.dirPath, "slices");
  if (!(await pathExists(slicesDir))) return [];
  const entries = await fs.readdir(slicesDir, { withFileTypes: true });
  const out: SliceListItem[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const readmePath = path.join(slicesDir, entry.name, "README.md");
    if (!(await pathExists(readmePath))) continue;
    const parsed = await parseMarkdownFile(readmePath);
    const fm = parsed.frontmatter ?? {};
    out.push({
      id: String(fm.id ?? entry.name),
      projectId: String(fm.project_id ?? project.id),
      title: String(fm.title ?? ""),
      status: String(fm.status ?? ""),
      hillPosition: String(fm.hill_position ?? ""),
      updatedAt: String(fm.updated_at ?? ""),
    });
  }

  return out;
}

async function findSliceAcrossProjects(sliceId: string): Promise<{ project: ProjectLocation; slice: SliceRecord } | null> {
  const projects = await listProjectLocations();
  for (const project of projects) {
    try {
      const slice = await getSlice(project.dirPath, sliceId);
      return { project, slice };
    } catch {
      // ignore
    }
  }
  return null;
}

function renderSliceTable(items: SliceListItem[]): string {
  const headers = ["id", "project", "title", "status", "hill", "updated"];
  const rows = items.map((item) =>
    [item.id, item.projectId, item.title, item.status, item.hillPosition, item.updatedAt].map((value) =>
      value.replace(/\r?\n/g, "<br>").replace(/\|/g, "\\|")
    )
  );
  const headerRow = `| ${headers.join(" | ")} |`;
  const separator = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.join(" | ")} |`).join("\n");
  return [headerRow, separator, body].filter(Boolean).join("\n");
}

function renderSliceDetails(record: SliceRecord): string {
  const fm = record.frontmatter;
  const lines = [
    `id: ${fm.id}`,
    `project_id: ${fm.project_id}`,
    `title: ${fm.title}`,
    `status: ${fm.status}`,
    `hill_position: ${fm.hill_position}`,
    `created_at: ${fm.created_at}`,
    `updated_at: ${fm.updated_at}`,
    "",
    "## README",
    record.docs.readme.trim(),
    "",
    "## SPECS",
    record.docs.specs.trim(),
    "",
    "## TASKS",
    record.docs.tasks.trim(),
    "",
    "## VALIDATION",
    record.docs.validation.trim(),
    "",
    "## THREAD",
    record.docs.thread.trim(),
  ];
  return lines.join("\n");
}

export function registerSlicesCommands(program: Command): Command {
  program
    .command("add")
    .description("Create slice")
    .requiredOption("--project <id>", "Project ID")
    .argument("<title>", "Slice title")
    .action(async (title, opts) => {
      try {
        const project = await findProjectLocation(String(opts.project));
        if (!project) throw new Error(`Project not found: ${String(opts.project).trim().toUpperCase()}`);
        const created = await createSlice(project.dirPath, {
          projectId: project.id,
          title: String(title),
          status: "todo",
        });
        console.log(created.id);
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("list")
    .description("List slices")
    .option("--project <id>", "Project ID filter")
    .option("--status <status>", "Status filter")
    .option("-j, --json", "JSON output")
    .action(async (opts) => {
      try {
        const statusFilter =
          typeof opts.status === "string" && opts.status.trim().length > 0
            ? opts.status.trim()
            : undefined;
        const projectFilter =
          typeof opts.project === "string" && opts.project.trim().length > 0
            ? opts.project.trim().toUpperCase()
            : undefined;

        const projects = await listProjectLocations();
        const filteredProjects = projectFilter
          ? projects.filter((project) => project.id === projectFilter)
          : projects;
        if (projectFilter && filteredProjects.length === 0) {
          throw new Error(`Project not found: ${projectFilter}`);
        }

        const all = (
          await Promise.all(filteredProjects.map((project) => listSlicesForProject(project)))
        )
          .flat()
          .filter((slice) => (statusFilter ? slice.status === statusFilter : true))
          .sort((a, b) => a.id.localeCompare(b.id));

        if (opts.json) {
          console.log(JSON.stringify(all, null, 2));
          return;
        }
        console.log(renderSliceTable(all));
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("get")
    .description("Get slice details")
    .argument("<sliceId>", "Slice ID")
    .option("-j, --json", "JSON output")
    .action(async (sliceId, opts) => {
      try {
        const found = await findSliceAcrossProjects(String(sliceId));
        if (!found) throw new Error(`Slice not found: ${String(sliceId)}`);
        if (opts.json) {
          console.log(JSON.stringify(found.slice, null, 2));
          return;
        }
        console.log(renderSliceDetails(found.slice));
      } catch (err) {
        fail(err);
      }
    });

  const VALID_STATUSES: SliceStatus[] = [
    "todo",
    "in_progress",
    "review",
    "ready_to_merge",
    "done",
    "cancelled",
  ];

  program
    .command("move")
    .description("Change slice status")
    .argument("<sliceId>", "Slice ID")
    .argument("<status>", "Target status")
    .action(async (sliceId, status) => {
      try {
        const normalizedStatus = String(status).trim() as SliceStatus;
        if (!(VALID_STATUSES as string[]).includes(normalizedStatus)) {
          throw new Error(
            `Invalid status "${normalizedStatus}". Must be one of: ${VALID_STATUSES.join(", ")}`
          );
        }
        const found = await findSliceAcrossProjects(String(sliceId));
        if (!found) throw new Error(`Slice not found: ${String(sliceId)}`);
        await updateSlice(found.project.dirPath, found.slice.id, { status: normalizedStatus });
        console.log(`${found.slice.id} → ${normalizedStatus}`);
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("rename")
    .description("Rename slice")
    .argument("<sliceId>", "Slice ID")
    .argument("<title>", "New title")
    .action(async (sliceId, title) => {
      try {
        const found = await findSliceAcrossProjects(String(sliceId));
        if (!found) throw new Error(`Slice not found: ${String(sliceId)}`);
        await updateSlice(found.project.dirPath, found.slice.id, { title: String(title) });
        console.log(`${found.slice.id} renamed to ${JSON.stringify(String(title))}`);
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("comment")
    .description("Append timestamped comment to slice THREAD.md")
    .argument("<sliceId>", "Slice ID")
    .argument("<body>", "Comment body")
    .action(async (sliceId, body) => {
      try {
        const found = await findSliceAcrossProjects(String(sliceId));
        if (!found) throw new Error(`Slice not found: ${String(sliceId)}`);
        const now = new Date().toISOString();
        const existing = found.slice.docs.thread;
        const separator = existing.trim().length > 0 ? "\n\n" : "";
        const entry = `## ${now}\n\n${String(body).trim()}`;
        const newThread = `${existing.trimEnd()}${separator}${entry}\n`;
        await updateSlice(found.project.dirPath, found.slice.id, { thread: newThread });
        console.log(`Comment added to ${found.slice.id}`);
      } catch (err) {
        fail(err);
      }
    });

  program
    .command("cancel")
    .description("Cancel slice (sugar for move <id> cancelled)")
    .argument("<sliceId>", "Slice ID")
    .action(async (sliceId) => {
      try {
        const found = await findSliceAcrossProjects(String(sliceId));
        if (!found) throw new Error(`Slice not found: ${String(sliceId)}`);
        await updateSlice(found.project.dirPath, found.slice.id, { status: "cancelled" });
        console.log(`${found.slice.id} → cancelled`);
      } catch (err) {
        fail(err);
      }
    });

  return program;
}
