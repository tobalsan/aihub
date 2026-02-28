import * as fs from "node:fs/promises";
import * as path from "node:path";
import { homedir } from "node:os";
import type { GatewayConfig, Task } from "@aihub/shared";
import { TaskSchema } from "@aihub/shared";

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

async function findProjectDir(
  root: string,
  id: string
): Promise<string | null> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === id || entry.name.startsWith(`${id}_`)) {
        return entry.name;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function parseMetadata(raw: string): {
  status?: Task["status"];
  agentId?: string;
} {
  const metadataMatches = raw.matchAll(/`([^:`]+):([^`]+)`/g);
  let status: Task["status"] | undefined;
  let agentId: string | undefined;
  for (const match of metadataMatches) {
    const key = (match[1] ?? "").trim();
    const value = (match[2] ?? "").trim();
    if (key === "status" && ["todo", "in_progress", "done"].includes(value)) {
      status = value as Task["status"];
    }
    if (key === "agent" && value) {
      agentId = value;
    }
  }
  return { status, agentId };
}

function extractSectionLines(content: string, heading: string): string[] {
  const lines = content.split(/\r?\n/);
  const sectionStart = lines.findIndex(
    (line) => line.trim().toLowerCase() === `## ${heading}`.toLowerCase()
  );
  if (sectionStart < 0) return [];

  let sectionEnd = lines.length;
  for (let i = sectionStart + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) {
      sectionEnd = i;
      break;
    }
  }
  return lines.slice(sectionStart + 1, sectionEnd);
}

function parseTasksFromSection(content: string, heading: string): Task[] {
  const lines = extractSectionLines(content, heading);
  const tasks: Task[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const taskMatch = line.match(/^- \[( |x)\] \*\*(.+?)\*\*(.*)$/);
    if (!taskMatch) continue;

    const checked = taskMatch[1] === "x";
    const title = taskMatch[2]?.trim() ?? "";
    const metadataText = taskMatch[3] ?? "";
    const metadata = parseMetadata(metadataText);

    const descriptionLines: string[] = [];
    let cursor = i + 1;
    while (cursor < lines.length) {
      const next = lines[cursor] ?? "";
      if (/^\s{2,}.*$/.test(next) || /^\t.*$/.test(next)) {
        descriptionLines.push(next.replace(/^\s{2}|\t/, ""));
        cursor += 1;
        continue;
      }
      break;
    }
    i = cursor - 1;

    const derivedStatus: Task["status"] = checked ? "done" : "todo";
    tasks.push(
      TaskSchema.parse({
        title,
        description:
          descriptionLines.length > 0 ? descriptionLines.join("\n") : undefined,
        status: metadata.status ?? derivedStatus,
        checked,
        agentId: metadata.agentId,
        order: tasks.length,
      })
    );
  }

  return tasks;
}

export function parseTasks(specsContent: string): Task[] {
  return parseTasksFromSection(specsContent, "Tasks");
}

export function parseAcceptanceCriteria(specsContent: string): Task[] {
  return parseTasksFromSection(specsContent, "Acceptance Criteria");
}

function renderTasks(tasks: Task[]): string {
  return tasks
    .map((task, idx) => {
      const checked = task.checked ? "x" : " ";
      const metadata = [`status:${task.status}`];
      if (task.agentId) {
        metadata.push(`agent:${task.agentId}`);
      }
      const header =
        `- [${checked}] **${task.title}** ${metadata.map((item) => `\`${item}\``).join(" ")}`.trim();
      const description = task.description
        ? `\n${task.description
            .split("\n")
            .map((line) => `  ${line}`)
            .join("\n")}`
        : "";
      const nextTaskGap = idx < tasks.length - 1 ? "\n" : "";
      return `${header}${description}${nextTaskGap}`;
    })
    .join("\n");
}

function upsertSection(
  specsContent: string,
  heading: string,
  body: string
): string {
  const lines = specsContent.split(/\r?\n/);
  const sectionStart = lines.findIndex(
    (line) => line.trim().toLowerCase() === `## ${heading}`.toLowerCase()
  );

  if (sectionStart < 0) {
    const trimmed = specsContent.trimEnd();
    if (!trimmed) {
      return `## ${heading}\n\n${body}\n`;
    }
    return `${trimmed}\n\n## ${heading}\n\n${body}\n`;
  }

  let sectionEnd = lines.length;
  for (let i = sectionStart + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) {
      sectionEnd = i;
      break;
    }
  }

  const next = [
    ...lines.slice(0, sectionStart + 1),
    "",
    ...body.split("\n"),
    ...lines.slice(sectionEnd),
  ];

  return `${next.join("\n").trimEnd()}\n`;
}

export function serializeTasks(tasks: Task[], specsContent: string): string {
  const normalized = tasks.map((task, order) => ({ ...task, order }));
  return upsertSection(specsContent, "Tasks", renderTasks(normalized));
}

export async function readSpec(
  config: GatewayConfig,
  projectId: string
): Promise<string> {
  const root = getProjectsRoot(config);
  const projectDir = await findProjectDir(root, projectId);
  if (!projectDir) return "";
  const filePath = path.join(root, projectDir, "SPECS.md");
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

export async function writeSpec(
  config: GatewayConfig,
  projectId: string,
  content: string
): Promise<void> {
  const root = getProjectsRoot(config);
  const projectDir = await findProjectDir(root, projectId);
  if (!projectDir) {
    throw new Error(`Project not found: ${projectId}`);
  }
  const filePath = path.join(root, projectDir, "SPECS.md");
  await fs.writeFile(filePath, content, "utf8");
}
