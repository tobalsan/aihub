import {
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
  untrack,
} from "solid-js";
import { useSearchParams } from "@solidjs/router";
import { marked } from "marked";
import DOMPurify from "dompurify";
import {
  fetchProjects,
  fetchArchivedProjects,
  fetchProject,
  updateProject,
  deleteProject,
  archiveProject,
  unarchiveProject,
  createProject,
  fetchAgents,
  fetchAllSubagents,
  fetchFullHistory,
  fetchSubagents,
  fetchSubagentLogs,
  fetchProjectBranches,
  killSubagent,
  archiveSubagent,
  unarchiveSubagent,
  interruptSubagent,
  uploadAttachments,
  addProjectComment,
  updateProjectComment,
  deleteProjectComment,
  startProjectRun,
  spawnRalphLoop,
} from "../api/client";
import type {
  ProjectListItem,
  ProjectDetail,
  FullHistoryMessage,
  ContentBlock,
  SubagentListItem,
  SubagentLogEvent,
  SubagentStatus,
} from "../api/types";
import { AgentSidebar } from "./AgentSidebar";
import { ContextPanel } from "./ContextPanel";
import { AgentChat } from "./AgentChat";
import { ActivityFeed } from "./ActivityFeed";

type ColumnDef = { id: string; title: string; color: string };

const COLUMNS: ColumnDef[] = [
  { id: "not_now", title: "Not now", color: "#6b6b6b" },
  { id: "maybe", title: "Maybe", color: "#d2b356" },
  { id: "shaping", title: "Shaping", color: "#4aa3a0" },
  { id: "todo", title: "Todo", color: "#3b6ecc" },
  { id: "in_progress", title: "In Progress", color: "#8a6fd1" },
  { id: "review", title: "Review", color: "#f08b57" },
  { id: "done", title: "Done", color: "#53b97c" },
];

const CLI_OPTIONS = [
  { id: "cli:claude", label: "Claude CLI", cli: "claude" },
  { id: "cli:codex", label: "Codex CLI", cli: "codex" },
  { id: "cli:droid", label: "Droid CLI", cli: "droid" },
  { id: "cli:gemini", label: "Gemini CLI", cli: "gemini" },
];

const COLUMN_STORAGE_KEY = "aihub:projects:expanded-columns";
const CREATE_FORM_STORAGE_KEY = "aihub:projects:create-form";
const DELETE_SUCCESS_KEY = "aihub:projects:delete-success";
const FILES_DB = "aihub";
const CREATE_FILES_STORE = "project-create-files";
const DETAIL_FILES_STORE = "project-detail-files";
const CREATE_FILES_KEY = "pending";
const COLUMN_IDS = new Set(COLUMNS.map((col) => col.id));

function normalizeExpanded(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const next: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    if (!COLUMN_IDS.has(entry) || seen.has(entry)) continue;
    seen.add(entry);
    next.push(entry);
    if (next.length >= 2) break;
  }
  return next;
}

function readExpandedFromStorage(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(COLUMN_STORAGE_KEY);
    if (!raw) return [];
    return normalizeExpanded(JSON.parse(raw));
  } catch {
    return [];
  }
}

type CreateFormState = {
  title: string;
  description: string;
};

type StoredFile = {
  name: string;
  type: string;
  lastModified: number;
  data: Blob;
};

function saveFormToStorage(state: CreateFormState): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CREATE_FORM_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

function loadFormFromStorage(): CreateFormState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CREATE_FORM_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed.title === "string" &&
      typeof parsed.description === "string"
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function clearFormFromStorage(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(CREATE_FORM_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function buildAttachmentSection(
  attachments: Array<{ savedName: string; path: string }>
): string {
  if (attachments.length === 0) return "";
  const links = attachments.map((att) => `[${att.savedName}](${att.path})`);
  if (attachments.length === 1) {
    return `## Attached files\n${links[0]}`;
  }
  const list = links.map((link) => `- ${link}`).join("\n");
  return `## Attached files\n${list}`;
}

function openFilesDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("indexedDB unavailable"));
      return;
    }
    const request = indexedDB.open(FILES_DB, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CREATE_FILES_STORE)) {
        db.createObjectStore(CREATE_FILES_STORE);
      }
      if (!db.objectStoreNames.contains(DETAIL_FILES_STORE)) {
        db.createObjectStore(DETAIL_FILES_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveFilesToStore(
  storeName: string,
  key: string,
  files: File[]
): Promise<void> {
  if (typeof window === "undefined") return;
  if (typeof indexedDB === "undefined") return;
  if (files.length === 0) {
    await clearFilesFromStore(storeName, key);
    return;
  }
  const db = await openFilesDb();
  const tx = db.transaction(storeName, "readwrite");
  const store = tx.objectStore(storeName);
  const payload = {
    files: files.map((file) => ({
      name: file.name,
      type: file.type,
      lastModified: file.lastModified,
      data: file,
    })),
  };
  store.put(payload, key);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function loadFilesFromStore(
  storeName: string,
  key: string
): Promise<File[]> {
  if (typeof window === "undefined") return [];
  try {
    const db = await openFilesDb();
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const request = store.get(key);
    const result = await new Promise<unknown>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const payload = result as { files?: StoredFile[] } | undefined;
    const files = payload?.files ?? [];
    return files.map(
      (file) =>
        new File([file.data], file.name, {
          type: file.type,
          lastModified: file.lastModified,
        })
    );
  } catch {
    return [];
  }
}

async function clearFilesFromStore(
  storeName: string,
  key: string
): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const db = await openFilesDb();
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    store.delete(key);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}

// Wrappers for create form files (backward compat)
async function saveFilesToStorage(files: File[]): Promise<void> {
  return saveFilesToStore(CREATE_FILES_STORE, CREATE_FILES_KEY, files);
}

async function loadFilesFromStorage(): Promise<File[]> {
  return loadFilesFromStore(CREATE_FILES_STORE, CREATE_FILES_KEY);
}

async function clearFilesFromStorage(): Promise<void> {
  return clearFilesFromStore(CREATE_FILES_STORE, CREATE_FILES_KEY);
}

function getFrontmatterString(
  frontmatter: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  const value = frontmatter?.[key];
  return typeof value === "string" ? value : undefined;
}

function getFrontmatterRecord(
  frontmatter: Record<string, unknown> | undefined,
  key: string
): Record<string, string> | undefined {
  const value = frontmatter?.[key];
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  return value as Record<string, string>;
}

function formatCreatedRelative(raw?: string): string {
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const created = new Date(date);
  created.setHours(0, 0, 0, 0);

  const days = Math.floor((today.getTime() - created.getTime()) / 86400000);
  if (days === 0) return "Created today";
  if (days === 1) return "Created yesterday";
  if (days === 7) return "Created last week";
  return `Created ${days} days ago`;
}

function formatRunRelative(raw?: string | number): string {
  if (!raw) return "";
  const ts = typeof raw === "number" ? raw : Date.parse(raw);
  if (Number.isNaN(ts)) return "";
  const diff = Date.now() - ts;
  if (diff < 60000) return "Just now";
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes} min${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  if (hours < 48) return "Yesterday";
  const days = Math.floor(diff / 86400000);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
function normalizeHref(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") return raw;
  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const candidates = ["href", "url", "src", "link", "raw"];
    for (const key of candidates) {
      const value = obj[key];
      if (typeof value === "string") return value;
    }
  }
  return String(raw);
}

function getFilenameFromHref(raw: string): string {
  const cleaned = raw.split(/[?#]/)[0] ?? "";
  const last = cleaned.split("/").filter(Boolean).pop() ?? cleaned;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

function rewriteAttachmentUrl(raw: unknown, projectId?: string): string | null {
  const href = normalizeHref(raw);
  if (!href) return null;
  if (!projectId) return href;
  const trimmed = href.trim();
  if (
    !trimmed.startsWith("attachments/") &&
    !trimmed.startsWith("./attachments/")
  ) {
    return href;
  }
  const cleaned = trimmed.replace(/^\.?\//, "").replace(/^attachments\//, "");
  return `/api/projects/${projectId}/attachments/${encodeURIComponent(cleaned)}`;
}

function renderMarkdown(content: string, projectId?: string): string {
  const stripped = content
    .replace(/^\s*---[\s\S]*?\n---\s*\n?/, "")
    .replace(/^\s*#\s+.+\n+/, "");
  const renderer = new marked.Renderer();
  renderer.link = (href, title, text) => {
    const rawHref = normalizeHref(href) ?? "";
    const next = rewriteAttachmentUrl(rawHref, projectId) ?? "";
    const safeTitle =
      typeof title === "string" && title ? ` title="${title}"` : "";
    const safeText =
      typeof text === "string" && text.trim().length > 0
        ? text
        : getFilenameFromHref(rawHref || next);
    return `<a href="${next}"${safeTitle} target="_blank" rel="noopener noreferrer">${safeText}</a>`;
  };
  renderer.image = (href, title, _text) => {
    const rawHref = normalizeHref(href) ?? "";
    const next = rewriteAttachmentUrl(rawHref, projectId) ?? "";
    const safeTitle =
      typeof title === "string" && title ? ` title="${title}"` : "";
    const label = getFilenameFromHref(rawHref || next);
    return `<a href="${next}"${safeTitle} target="_blank" rel="noopener noreferrer">${label}</a>`;
  };
  const html = marked.parse(stripped, {
    breaks: true,
    async: false,
    renderer,
  }) as string;
  return DOMPurify.sanitize(html, { ADD_ATTR: ["target", "rel"] });
}

function stripMarkdownMeta(content: string): string {
  return content
    .replace(/^\s*---[\s\S]*?\n---\s*\n?/, "")
    .replace(/^\s*#\s+.+\n+/, "");
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatJson(args: unknown): string {
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

function extractBlockText(text: unknown): string {
  if (typeof text === "string") return text;
  if (text && typeof text === "object") {
    const obj = text as Record<string, unknown>;
    if (Array.isArray(obj.content)) {
      return (obj.content as Array<Record<string, unknown>>)
        .filter((c) => c?.type === "text" && typeof c.text === "string")
        .map((c) => c.text as string)
        .join("\n");
    }
  }
  return "";
}

function getTextBlocks(blocks: ContentBlock[]): string {
  return blocks
    .filter((b) => b.type === "text")
    .map((b) => extractBlockText((b as { text: unknown }).text))
    .join("\n");
}

function buildAihubLogs(messages: FullHistoryMessage[]): LogItem[] {
  const entries: LogItem[] = [];
  const toolResults = new Map<string, FullToolResultMessage>();
  for (const msg of messages) {
    if (msg.role === "toolResult") {
      toolResults.set(msg.toolCallId, msg);
    }
  }
  const skipResults = new Set<string>();

  for (const msg of messages) {
    if (msg.role === "user") {
      const text = getTextBlocks(msg.content);
      if (text) entries.push({ tone: "user", body: text });
      continue;
    }
    if (msg.role === "assistant") {
      for (const block of msg.content) {
        if (block.type === "text" && block.text) {
          entries.push({ tone: "assistant", body: block.text });
        } else if (block.type === "toolCall") {
          const toolName = block.name ?? "";
          const toolKey = toolName.toLowerCase();
          const args = block.arguments as Record<string, unknown>;
          if (toolKey === "read") {
            const path =
              typeof args?.path === "string"
                ? args.path
                : typeof args?.file_path === "string"
                  ? args.file_path
                  : "";
            const output = toolResults.get(block.id);
            const body = output ? getTextBlocks(output.content) : "";
            entries.push({
              tone: "muted",
              icon: "read",
              title: `read ${path}`.trim(),
              body,
              collapsible: true,
            });
            skipResults.add(block.id);
            continue;
          }
          if (toolKey === "bash") {
            const command =
              typeof args?.command === "string" ? args.command : "";
            const params = typeof args?.args === "string" ? args.args : "";
            const description =
              typeof args?.description === "string" ? args.description : "";
            const output = toolResults.get(block.id);
            const body = output ? getTextBlocks(output.content) : "";
            const summary = ["Bash", command, params, description]
              .filter((part) => part.trim())
              .join(" ");
            entries.push({
              tone: "muted",
              icon: "bash",
              title: summary,
              body,
              collapsible: true,
            });
            skipResults.add(block.id);
            continue;
          }
          if (toolKey === "write") {
            const path =
              typeof args?.path === "string"
                ? args.path
                : typeof args?.file_path === "string"
                  ? args.file_path
                  : "";
            const content =
              typeof args?.content === "string" ? args.content : "";
            entries.push({
              tone: "muted",
              icon: "write",
              title: `write ${path}`.trim(),
              body: content,
              collapsible: true,
            });
            skipResults.add(block.id);
            continue;
          }
          const output = toolResults.get(block.id);
          const outputText = output ? getTextBlocks(output.content) : "";
          entries.push({
            tone: "muted",
            icon: "tool",
            title: `Tool: ${toolName}`,
            body: outputText || formatJson(block.arguments),
            collapsible: true,
          });
          if (output) skipResults.add(block.id);
        }
      }
      continue;
    }
    if (msg.role === "toolResult") {
      if (skipResults.has(msg.toolCallId)) continue;
      const text = getTextBlocks(msg.content);
      if (text) {
        entries.push({
          tone: "muted",
          icon: "output",
          title: "Tool output",
          body: text,
          collapsible: text.length > 80,
        });
      }
      if (msg.details?.diff) {
        entries.push({
          tone: "muted",
          icon: "diff",
          title: "Diff",
          body: msg.details.diff,
          collapsible: true,
        });
      }
    }
  }
  return entries;
}

function parseToolArgs(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function buildCliLogs(events: SubagentLogEvent[]): LogItem[] {
  const entries: LogItem[] = [];
  const toolOutputs = new Map<string, SubagentLogEvent>();
  for (const event of events) {
    if (event.type === "tool_output" && event.tool?.id) {
      toolOutputs.set(event.tool.id, event);
    }
  }
  const skipOutputs = new Set<string>();

  for (const event of events) {
    if (event.type === "skip") continue;
    if (event.type === "user") {
      if (event.text) {
        const last = entries[entries.length - 1];
        if (!last || last.tone !== "user" || last.body !== event.text) {
          entries.push({ tone: "user", body: event.text });
        }
      }
      continue;
    }
    if (event.type === "assistant") {
      if (event.text) {
        const last = entries[entries.length - 1];
        if (!last || last.tone !== "assistant" || last.body !== event.text) {
          entries.push({ tone: "assistant", body: event.text });
        }
      }
      continue;
    }
    if (event.type === "tool_call") {
      const toolId = event.tool?.id ?? "";
      const output = toolId ? toolOutputs.get(toolId) : undefined;
      const toolName = (event.tool?.name ?? "").trim();
      const toolKey = toolName.toLowerCase();
      const args = parseToolArgs(event.text ?? "");
      if (toolKey === "exec_command" || toolKey === "bash") {
        const command =
          typeof args?.cmd === "string"
            ? args.cmd
            : typeof args?.command === "string"
              ? args.command
              : "";
        const summary = ["Bash", command]
          .filter((part) => part.trim())
          .join(" ");
        const body = output?.text ?? "";
        entries.push({
          tone: "muted",
          icon: "bash",
          title: summary || "Bash",
          body: body || formatJson(args ?? {}),
          collapsible: true,
        });
        if (toolId) skipOutputs.add(toolId);
        continue;
      }
      if (toolKey === "read" || toolKey === "read_file") {
        const path =
          typeof args?.path === "string"
            ? args.path
            : typeof args?.file_path === "string"
              ? args.file_path
              : "";
        const body = output?.text ?? "";
        entries.push({
          tone: "muted",
          icon: "read",
          title: `read ${path}`.trim(),
          body: body || "",
          collapsible: true,
        });
        if (toolId) skipOutputs.add(toolId);
        continue;
      }
      if (toolKey === "write" || toolKey === "write_file") {
        const path =
          typeof args?.path === "string"
            ? args.path
            : typeof args?.file_path === "string"
              ? args.file_path
              : "";
        const content =
          typeof args?.content === "string" ? args.content : (event.text ?? "");
        entries.push({
          tone: "muted",
          icon: "write",
          title: `write ${path}`.trim(),
          body: content,
          collapsible: true,
        });
        if (toolId) skipOutputs.add(toolId);
        continue;
      }
      if (toolKey === "apply_patch") {
        const body = output?.text
          ? `${event.text ?? ""}\n\n${output.text}`.trim()
          : (event.text ?? "");
        entries.push({
          tone: "muted",
          icon: "write",
          title: "apply_patch",
          body,
          collapsible: true,
        });
        if (toolId) skipOutputs.add(toolId);
        continue;
      }
      if (toolKey === "edit" || toolKey === "notebookedit") {
        const body = output?.text ?? event.text ?? "";
        entries.push({
          tone: "muted",
          icon: "write",
          title: toolName || "edit",
          body: body || formatJson(args ?? {}),
          collapsible: true,
        });
        if (toolId) skipOutputs.add(toolId);
        continue;
      }
      entries.push({
        tone: "muted",
        icon: "tool",
        title: toolName ? `Tool: ${toolName}` : "Tool",
        body: output?.text || event.text || "",
        collapsible: true,
      });
      if (toolId) skipOutputs.add(toolId);
      continue;
    }
    if (event.type === "tool_output") {
      if (event.tool?.id && skipOutputs.has(event.tool.id)) continue;
      if (event.text) {
        entries.push({
          tone: "muted",
          icon: "output",
          title: "Tool output",
          body: event.text,
          collapsible: event.text.length > 80,
        });
      }
      continue;
    }
    if (event.type === "diff" && event.text) {
      entries.push({
        tone: "muted",
        icon: "diff",
        title: "Diff",
        body: event.text,
        collapsible: true,
      });
      continue;
    }
    if (event.text) {
      entries.push(toLogItem(event));
    }
  }

  return entries;
}

function toLogItem(entry: SubagentLogEvent): LogItem {
  const tone = logTone(entry.type);
  const body = entry.text ?? "";
  const title = logLabel(entry.type, body);
  const icon =
    entry.type === "tool_call"
      ? "tool"
      : entry.type === "tool_output"
        ? "output"
        : entry.type === "diff"
          ? "diff"
          : entry.type === "session" || entry.type === "message"
            ? "system"
            : entry.type === "error" || entry.type === "stderr"
              ? "error"
              : undefined;
  return {
    tone,
    icon,
    title: title || undefined,
    body,
    collapsible: tone === "muted" && body.length > 80,
  };
}

function renderLogItem(item: LogItem) {
  if (item.collapsible && item.body.length > 0) {
    const summaryText = item.title ?? item.body.split("\n")[0] ?? "Details";
    return (
      <details class={`log-line ${item.tone} collapsible`} open={false}>
        <summary class="log-summary">
          {logIcon(item.icon)}
          <span>{summaryText}</span>
        </summary>
        <pre class="log-text">{item.body}</pre>
      </details>
    );
  }
  return (
    <div class={`log-line ${item.tone}`}>
      {logIcon(item.icon)}
      <div class="log-stack">
        {item.title && <div class="log-title">{item.title}</div>}
        <pre class="log-text">{item.body}</pre>
      </div>
    </div>
  );
}

type LogItem = {
  tone: "assistant" | "user" | "muted" | "error";
  icon?:
    | "read"
    | "write"
    | "bash"
    | "tool"
    | "output"
    | "diff"
    | "system"
    | "error";
  title?: string;
  body: string;
  collapsible?: boolean;
};

type AgentRunItem = {
  key: string;
  type: "subagent" | "aihub";
  executionType?: "subagent" | "ralph_loop";
  role?: "supervisor" | "worker";
  parentSlug?: string;
  groupKey?: string;
  label: string;
  status: "running" | "replied" | "error" | "idle";
  time?: number;
  slug?: string;
  agentId?: string;
  sessionKey?: string;
  archived?: boolean;
  iterations?: number;
};

type AgentRunGroup = {
  key: string;
  primary: AgentRunItem;
  children: AgentRunItem[];
  displayStatus: AgentRunItem["status"];
};

function runStatusRank(status: AgentRunItem["status"]): number {
  if (status === "running") return 3;
  if (status === "error") return 2;
  if (status === "replied") return 1;
  return 0;
}

function logTone(type: string): "assistant" | "user" | "muted" | "error" {
  if (type === "user") return "user";
  if (type === "assistant") return "assistant";
  if (type === "error" || type === "stderr") return "error";
  if (
    type === "tool_call" ||
    type === "tool_output" ||
    type === "diff" ||
    type === "session" ||
    type === "message"
  ) {
    return "muted";
  }
  return "assistant";
}

function logIcon(icon?: LogItem["icon"]) {
  if (icon === "bash") {
    return (
      <svg
        class="log-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="M4 5h16v14H4z" />
        <path d="M7 9l3 3-3 3" />
        <path d="M12 15h4" />
      </svg>
    );
  }
  if (icon === "read") {
    return (
      <svg
        class="log-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="M4 19h12a4 4 0 0 0 0-8h-1" />
        <path d="M4 19V5h9a4 4 0 0 1 4 4v2" />
      </svg>
    );
  }
  if (icon === "write") {
    return (
      <svg
        class="log-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="M12 20h9" />
        <path d="M16.5 3.5l4 4L8 20l-4 1 1-4L16.5 3.5z" />
      </svg>
    );
  }
  if (icon === "tool") {
    return (
      <svg
        class="log-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="M14.7 6.3a5 5 0 0 0-6.4 6.4L3 18l3 3 5.3-5.3a5 5 0 0 0 6.4-6.4l-3 3-3-3 3-3z" />
      </svg>
    );
  }
  if (icon === "output") {
    return (
      <svg
        class="log-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="M20 6L9 17l-5-5" />
      </svg>
    );
  }
  if (icon === "diff") {
    return (
      <svg
        class="log-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="M8 7v10M16 7v10M3 12h5M16 12h5" />
      </svg>
    );
  }
  if (icon === "system") {
    return (
      <svg
        class="log-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="M4 5h16v10H7l-3 3V5z" />
      </svg>
    );
  }
  if (icon === "error") {
    return (
      <svg
        class="log-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="M12 8v5M12 16h.01" />
        <circle cx="12" cy="12" r="9" />
      </svg>
    );
  }
  return null;
}

function logLabel(type: string, text: string): string {
  if (type === "tool_call") {
    const name = text.split("\n")[0]?.trim();
    return name ? `Tool: ${name}` : "Tool call";
  }
  if (type === "tool_output") return "Tool output";
  if (type === "diff") return "Diff";
  if (type === "session") return "Session";
  if (type === "message") return "System";
  if (type === "error" || type === "stderr") return "Error";
  return "";
}

function getStatus(item: ProjectListItem): string {
  return getFrontmatterString(item.frontmatter, "status") ?? "maybe";
}

function normalizeStatus(raw?: string): string {
  if (!raw) return "maybe";
  return raw.trim().toLowerCase().replace(/\s+/g, "_");
}

function normalizeMode(raw?: string): string {
  if (!raw) return "";
  return raw.trim().toLowerCase().replace(/\s+/g, "_");
}

function getStatusLabel(status: string): string {
  if (status === "cancelled") return "Cancelled";
  if (status === "archived") return "Archived";
  if (status === "trashed") return "Trashed";
  const match = COLUMNS.find((col) => col.id === status);
  return match ? match.title : status;
}

function sortByCreatedAsc(a: ProjectListItem, b: ProjectListItem): number {
  const aRaw = getFrontmatterString(a.frontmatter, "created");
  const bRaw = getFrontmatterString(b.frontmatter, "created");
  const aTime = aRaw ? Date.parse(aRaw) : Number.POSITIVE_INFINITY;
  const bTime = bRaw ? Date.parse(bRaw) : Number.POSITIVE_INFINITY;
  return aTime - bTime;
}

export function ProjectsBoard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeProjectId = createMemo(() => {
    const value = searchParams.project;
    return typeof value === "string" && value.trim() ? value : undefined;
  });
  const [showArchived, setShowArchived] = createSignal(false);
  const [projects, { refetch }] = createResource(fetchProjects);
  const [archivedProjects] = createResource(showArchived, async (show) =>
    show ? fetchArchivedProjects() : []
  );
  const [agents] = createResource(fetchAgents);
  const [globalSubagents] = createResource(fetchAllSubagents);
  const [detail, { refetch: refetchDetail }] = createResource(
    () => activeProjectId(),
    async (id) => (id ? fetchProject(id) : null)
  );
  const [expanded, setExpanded] = createSignal<string[]>(
    readExpandedFromStorage()
  );
  const [detailStatus, setDetailStatus] = createSignal("maybe");
  const [detailDomain, setDetailDomain] = createSignal("");
  const [detailOwner, setDetailOwner] = createSignal("");
  const [detailMode, setDetailMode] = createSignal("");
  const [detailAppetite, setDetailAppetite] = createSignal("");
  const [detailRunAgent, setDetailRunAgent] = createSignal("");
  const [detailRalphCli, setDetailRalphCli] = createSignal<"codex" | "claude">(
    "codex"
  );
  const [detailRalphIterations, setDetailRalphIterations] = createSignal("20");
  const [detailRalphPromptFile, setDetailRalphPromptFile] = createSignal("");
  const [detailRunMode, setDetailRunMode] = createSignal("main-run");
  const [detailRepo, setDetailRepo] = createSignal("");
  const [repoStatus, setRepoStatus] = createSignal<
    "idle" | "checking" | "ok" | "error"
  >("idle");
  const [repoStatusMessage, setRepoStatusMessage] = createSignal("");
  const [repoStatusVisible, setRepoStatusVisible] = createSignal(false);
  const [detailTitle, setDetailTitle] = createSignal("");
  const [editingTitle, setEditingTitle] = createSignal(false);
  const [detailDocs, setDetailDocs] = createSignal<Record<string, string>>({});
  const [detailDocTab, setDetailDocTab] = createSignal<string>("README");
  const [editingDoc, setEditingDoc] = createSignal<string | null>(null);
  const [detailIsDragging, setDetailIsDragging] = createSignal(false);
  const [detailPendingFiles, setDetailPendingFiles] = createSignal<File[]>([]);
  const [detailSessionKeys, setDetailSessionKeys] = createSignal<
    Record<string, string>
  >({});
  const [newComment, setNewComment] = createSignal("");
  const [editingCommentIndex, setEditingCommentIndex] = createSignal<
    number | null
  >(null);
  const [editingCommentBody, setEditingCommentBody] = createSignal("");
  const [detailThread, setDetailThread] = createSignal<
    { author: string; date: string; body: string }[]
  >([]);
  const [detailSlug, setDetailSlug] = createSignal("");
  const [detailBranch, setDetailBranch] = createSignal("main");
  const [branches, setBranches] = createSignal<string[]>([]);
  const [customStartEnabled, setCustomStartEnabled] = createSignal(false);
  const [customStartPrompt, setCustomStartPrompt] = createSignal("");
  const [startError, setStartError] = createSignal("");
  const [subagents, setSubagents] = createSignal<SubagentListItem[]>([]);
  const [subagentError, setSubagentError] = createSignal<string | null>(null);
  const [showArchivedRuns, setShowArchivedRuns] = createSignal(true);
  const [subagentLogs, setSubagentLogs] = createSignal<SubagentLogEvent[]>([]);
  const [selectedRunKey, setSelectedRunKey] = createSignal<string | null>(null);
  const [aihubRunMeta, setAihubRunMeta] = createSignal<
    Record<string, { lastTs?: number }>
  >({});
  const [aihubRunLogs, setAihubRunLogs] = createSignal<
    Record<string, LogItem[]>
  >({});
  const [runLogAtBottom, setRunLogAtBottom] = createSignal(true);
  const [initialRunScroll, setInitialRunScroll] = createSignal(false);
  const [openMenu, setOpenMenu] = createSignal<
    "status" | "appetite" | "domain" | "owner" | "mode" | null
  >(null);
  const [createModalOpen, setCreateModalOpen] = createSignal(false);
  const [createTitle, setCreateTitle] = createSignal("");
  const [createDescription, setCreateDescription] = createSignal("");
  const [createError, setCreateError] = createSignal("");
  const [createToast, setCreateToast] = createSignal("");
  const [createSuccess, setCreateSuccess] = createSignal<string | null>(null);
  const [deleteSuccess, setDeleteSuccess] = createSignal<string | null>(null);
  const [pendingFiles, setPendingFiles] = createSignal<File[]>([]);
  const [isDragging, setIsDragging] = createSignal(false);
  const [filesLoaded, setFilesLoaded] = createSignal(false);
  const [draggingCardId, setDraggingCardId] = createSignal<string | null>(null);
  const [draggingFromStatus, setDraggingFromStatus] = createSignal<
    string | null
  >(null);
  const [dragOverColumn, setDragOverColumn] = createSignal<string | null>(null);
  const [filterText, setFilterText] = createSignal("");
  const [selectedAgent, setSelectedAgent] = createSignal<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = createSignal(false);
  const [isMobile, setIsMobile] = createSignal(false);
  const [mobileOverlay, setMobileOverlay] = createSignal<
    "chat" | "feed" | null
  >(null);
  const selectedAgentStorageKey = "aihub:context-panel:selected-agent";

  let subagentLogPaneRef: HTMLDivElement | undefined;
  let createNotesRef: HTMLTextAreaElement | undefined;
  let fileInputRef: HTMLInputElement | undefined;
  let savedRepo = "";
  let repoStatusTimer: number | undefined;

  onMount(() => {
    const saved = localStorage.getItem(selectedAgentStorageKey);
    if (saved) setSelectedAgent(saved);
  });

  onMount(() => {
    try {
      const pendingDelete = localStorage.getItem(DELETE_SUCCESS_KEY);
      if (pendingDelete) {
        localStorage.removeItem(DELETE_SUCCESS_KEY);
        showDeleteSuccess(pendingDelete);
      }
    } catch {
      // ignore
    }
  });

  onMount(() => {
    const isTestEnv =
      typeof process !== "undefined" && process.env?.NODE_ENV === "test";
    if (!isTestEnv) return;
    const testApi = { setCreateSuccess };
    (window as unknown as { __aihubTest?: typeof testApi }).__aihubTest =
      testApi;
    onCleanup(() => {
      const global = window as unknown as { __aihubTest?: typeof testApi };
      if (global.__aihubTest === testApi) delete global.__aihubTest;
    });
  });

  onMount(() => {
    const media = window.matchMedia("(max-width: 768px)");
    const update = (matches: boolean) => setIsMobile(matches);
    update(media.matches);
    const handler = (event: MediaQueryListEvent) => update(event.matches);
    if (media.addEventListener) {
      media.addEventListener("change", handler);
      onCleanup(() => media.removeEventListener("change", handler));
    } else {
      media.addListener(handler);
      onCleanup(() => media.removeListener(handler));
    }
  });

  createEffect(() => {
    const value = selectedAgent();
    if (value) {
      localStorage.setItem(selectedAgentStorageKey, value);
    } else {
      localStorage.removeItem(selectedAgentStorageKey);
    }
  });

  createEffect(() => {
    if (isMobile()) {
      setSidebarCollapsed(true);
      setRightPanelCollapsed(true);
      return;
    }
    if (mobileOverlay()) setMobileOverlay(null);
  });

  createEffect(() => {
    const value = selectedAgent();
    if (!value) return;
    if (value.startsWith("PRO-")) {
      const items = subagents()?.items ?? [];
      if (items.length === 0) return;
      const [projectId, token] = value.split("/");
      const exists = items.some(
        (item) =>
          item.projectId === projectId &&
          (item.slug === token || item.cli === token)
      );
      if (!exists) setSelectedAgent(null);
      return;
    }
    const list = agents() ?? [];
    if (list.length === 0) return;
    const exists = list.some((agent) => agent.id === value);
    if (!exists) setSelectedAgent(null);
  });

  const ownerOptions = createMemo(() => {
    const names = (agents() ?? []).map((agent) => agent.name);
    return ["Thinh", ...names.filter((name) => name !== "Thinh")];
  });

  const runAgentOptions = createMemo(() => {
    // Only show CLI agents (not lead agents) since UI v2
    return CLI_OPTIONS;
  });

  const selectedRunAgent = createMemo(() => {
    const value = detailRunAgent();
    if (!value) return null;
    if (value.startsWith("aihub:"))
      return { type: "aihub" as const, id: value.slice(6) };
    if (value.startsWith("cli:"))
      return { type: "cli" as const, id: value.slice(4) };
    return null;
  });

  const isRalphLoopMode = createMemo(() => detailMode() === "ralph_loop");

  const canStart = createMemo(() => {
    if (isRalphLoopMode()) {
      const iterations = Number(detailRalphIterations());
      return Number.isFinite(iterations) && iterations >= 1;
    }
    const agent = selectedRunAgent();
    if (!agent) return false;
    if (agent.type === "aihub") return true;
    if (!detailRepo()) return false;
    if (detailRunMode() === "worktree" && !detailSlug().trim()) return false;
    return true;
  });

  const agentType = createMemo(() => {
    const selected = selectedAgent();
    if (!selected) return null;
    if (selected.startsWith("PRO-")) return "subagent" as const;
    return "lead" as const;
  });

  const subagentInfo = createMemo(() => {
    const selected = selectedAgent();
    if (!selected || !selected.startsWith("PRO-")) return undefined;
    const [projectId, token] = selected.split("/");
    if (!projectId || !token) return undefined;
    const items = globalSubagents()?.items ?? [];
    const match = items.find(
      (item) =>
        item.projectId === projectId &&
        (item.slug === token || item.cli === token)
    );
    if (!match) {
      const projectItems = items.filter((item) => item.projectId === projectId);
      if (projectItems.length === 1) {
        return {
          projectId,
          slug: projectItems[0].slug,
          cli: projectItems[0].cli,
          status: projectItems[0].status as SubagentStatus,
        };
      }
    }
    return {
      projectId,
      slug: match?.slug ?? token,
      cli: match?.cli,
      status: (match?.status ?? "idle") as SubagentStatus,
    };
  });

  const agentName = createMemo(() => {
    const selected = selectedAgent();
    if (!selected) return null;
    if (selected.startsWith("PRO-")) {
      const [projectId, token] = selected.split("/");
      const match = globalSubagents()?.items.find(
        (item) =>
          item.projectId === projectId &&
          (item.slug === token || item.cli === token)
      );
      return `${projectId}/${match?.cli ?? token}`;
    }
    const match = agents()?.find((agent) => agent.id === selected);
    return match?.name ?? selected;
  });

  const isMonitoringHidden = createMemo(() => {
    const status = detailStatus();
    return status === "not_now" || status === "maybe";
  });

  const subagentLogItems = createMemo(() => buildCliLogs(subagentLogs()));
  const docKeys = createMemo(() => {
    const keys = Object.keys(detailDocs());
    return keys.sort((a, b) => {
      if (a === "README") return -1;
      if (b === "README") return 1;
      return a.localeCompare(b);
    });
  });
  const agentRuns = createMemo<AgentRunItem[]>(() => {
    const project = detail();
    if (!project) return [];
    const runs: AgentRunItem[] = [];
    const items = showArchivedRuns()
      ? subagents()
      : subagents().filter((item) => !item.archived);
    for (const item of items) {
      const time = item.lastActive ? Date.parse(item.lastActive) : Number.NaN;
      runs.push({
        key: `subagent:${item.slug}`,
        type: "subagent",
        executionType: item.type ?? "subagent",
        role: item.role,
        parentSlug: item.parentSlug,
        groupKey: item.groupKey,
        label:
          item.role === "worker"
            ? `${project.id}/${item.slug}`
            : `${project.id}/${item.cli ?? item.slug}`,
        status: item.status,
        time: Number.isNaN(time) ? undefined : time,
        slug: item.slug,
        archived: item.archived ?? false,
        iterations: item.iterations,
      });
    }
    const sessionKeys = detailSessionKeys();
    for (const agentId of Object.keys(sessionKeys)) {
      const sessionKey = sessionKeys[agentId];
      if (!sessionKey) continue;
      runs.push({
        key: `aihub:${agentId}`,
        type: "aihub",
        label: `aihub:${agentId}`,
        status: "idle",
        time: aihubRunMeta()[agentId]?.lastTs,
        agentId,
        sessionKey,
      });
    }
    runs.sort((a, b) => {
      if (a.status !== b.status) return a.status === "running" ? -1 : 1;
      const aTime = a.time ?? 0;
      const bTime = b.time ?? 0;
      return bTime - aTime;
    });
    return runs;
  });
  const hasArchivedRuns = createMemo(() =>
    subagents().some((item) => item.archived)
  );
  const groupedAgentRuns = createMemo<AgentRunGroup[]>(() => {
    const runs = agentRuns();
    const grouped = new Map<
      string,
      { primary?: AgentRunItem; children: AgentRunItem[] }
    >();
    const groupedRunKeys = new Set<string>();
    const result: AgentRunGroup[] = [];

    for (const run of runs) {
      if (run.type !== "subagent" || !run.groupKey) continue;
      const existing = grouped.get(run.groupKey) ?? { children: [] };
      if (run.role === "supervisor") existing.primary = run;
      if (run.role === "worker") existing.children.push(run);
      grouped.set(run.groupKey, existing);
      groupedRunKeys.add(run.key);
    }

    for (const [key, value] of grouped.entries()) {
      const primary = value.primary ?? value.children[0];
      const children = value.primary ? value.children : value.children.slice(1);
      if (!primary) continue;
      const statuses = [
        primary.status,
        ...children.map((child) => child.status),
      ];
      const displayStatus = statuses.reduce((best, status) =>
        runStatusRank(status) > runStatusRank(best) ? status : best
      );
      result.push({ key, primary, children, displayStatus });
    }

    for (const run of runs) {
      if (groupedRunKeys.has(run.key)) continue;
      result.push({
        key: run.key,
        primary: run,
        children: [],
        displayStatus: run.status,
      });
    }

    return result;
  });
  // Check if any agent run is currently running
  const runningAgent = createMemo(() => {
    return agentRuns().find((run) => run.status === "running") ?? null;
  });
  const selectedRun = createMemo(() => {
    const key = selectedRunKey();
    if (!key) return null;
    return agentRuns().find((run) => run.key === key) ?? null;
  });
  const selectedRunLogItems = createMemo(() => {
    const run = selectedRun();
    if (!run) return [];
    if (run.type === "aihub") {
      return aihubRunLogs()[run.agentId ?? ""] ?? [];
    }
    return subagentLogItems();
  });

  const grouped = createMemo(() => {
    const items = projects() ?? [];
    const filter = filterText().toLowerCase().trim();
    const byStatus = new Map<string, ProjectListItem[]>();
    for (const col of COLUMNS) byStatus.set(col.id, []);
    for (const item of items) {
      // Filter by title OR domain OR project ID
      if (filter) {
        const id = (item.id ?? "").toLowerCase();
        const title = (item.title ?? "").toLowerCase();
        const domain = (
          getFrontmatterString(item.frontmatter, "domain") ?? ""
        ).toLowerCase();
        if (
          !id.includes(filter) &&
          !title.includes(filter) &&
          !domain.includes(filter)
        ) {
          continue;
        }
      }
      const status = getStatus(item);
      if (!byStatus.has(status)) byStatus.set(status, []);
      byStatus.get(status)?.push(item);
    }
    for (const [, list] of byStatus) {
      list.sort(sortByCreatedAsc);
    }
    return byStatus;
  });

  createEffect(() => {
    const key = selectedRunKey();
    if (!key) return;
    if (!agentRuns().some((run) => run.key === key)) {
      setSelectedRunKey(null);
    }
  });

  createEffect(() => {
    if (expanded().length > 0) return;
    const items = projects() ?? [];
    if (items.length === 0) {
      setExpanded(COLUMNS.slice(0, 2).map((col) => col.id));
      return;
    }
    const withItems = COLUMNS.filter((col) =>
      items.some((item) => getStatus(item) === col.id)
    ).map((col) => col.id);
    setExpanded(
      withItems.slice(0, 2).length > 0
        ? withItems.slice(0, 2)
        : COLUMNS.slice(0, 2).map((col) => col.id)
    );
  });

  createEffect(() => {
    if (typeof window === "undefined") return;
    const value = expanded();
    if (value.length === 0) return;
    localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(value));
  });

  createEffect(() => {
    const current = detail();
    if (current) {
      setDetailStatus(
        normalizeStatus(getFrontmatterString(current.frontmatter, "status"))
      );
      setDetailDomain(
        getFrontmatterString(current.frontmatter, "domain") ?? ""
      );
      setDetailOwner(getFrontmatterString(current.frontmatter, "owner") ?? "");
      setDetailMode(
        normalizeMode(
          getFrontmatterString(current.frontmatter, "executionMode")
        )
      );
      setDetailAppetite(
        getFrontmatterString(current.frontmatter, "appetite") ?? ""
      );
      setDetailRunAgent("");
      setDetailRunMode("main-run");
      const repo = getFrontmatterString(current.frontmatter, "repo") ?? "";
      setDetailRepo(repo);
      savedRepo = repo;
      setDetailSessionKeys(
        getFrontmatterRecord(current.frontmatter, "sessionKeys") ?? {}
      );
      // Use untrack to avoid circular dependency when editing
      if (!untrack(editingTitle)) setDetailTitle(current.title);
      // Sync docs (only update keys not being edited)
      const currentEditing = untrack(editingDoc);
      const currentDocs = untrack(detailDocs);
      const nextDocs: Record<string, string> = {};
      for (const [key, content] of Object.entries(current.docs ?? {})) {
        nextDocs[key] =
          currentEditing === key
            ? (currentDocs[key] ?? stripMarkdownMeta(content))
            : stripMarkdownMeta(content);
      }
      setDetailDocs(nextDocs);
      // Sync thread
      setDetailThread(current.thread ?? []);
      // Ensure selected tab exists
      const docKeys = Object.keys(nextDocs);
      if (docKeys.length > 0 && !docKeys.includes(detailDocTab())) {
        setDetailDocTab(docKeys.includes("README") ? "README" : docKeys[0]);
      }
      if (!detailSlug()) {
        const nextSlug = slugify(current.title);
        if (nextSlug) setDetailSlug(nextSlug);
      }
      setOpenMenu(null);
    }
  });

  createEffect(() => {
    if (!activeProjectId()) return;
    setSubagents([]);
    setSubagentLogs([]);
    setShowArchivedRuns(false);
    setSelectedRunKey(null);
    setDetailRalphCli("codex");
    setDetailRalphIterations("20");
    setDetailRalphPromptFile("");
    setAihubRunMeta({});
    setAihubRunLogs({});
    setDetailSlug("");
    setDetailRepo("");
    setRepoStatus("idle");
    setRepoStatusMessage("");
    setRepoStatusVisible(false);
    if (repoStatusTimer) {
      window.clearTimeout(repoStatusTimer);
      repoStatusTimer = undefined;
    }
    savedRepo = "";
    setDetailDocs({});
    setDetailThread([]);
    setEditingDoc(null);
    setDetailDocTab("README");
    setDetailPendingFiles([]);
    setDetailIsDragging(false);
  });

  createEffect(() => {
    if (!detail() || detailRunAgent()) return;
    const options = runAgentOptions();
    if (options.length > 0) {
      // Default to first CLI option (Claude CLI)
      setDetailRunAgent(options[0].id);
    }
  });

  createEffect(() => {
    if (!activeProjectId()) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeDetail();
      }
    };
    window.addEventListener("keydown", handler);
    onCleanup(() => window.removeEventListener("keydown", handler));
  });

  createEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (!mobileOverlay()) return;
      e.preventDefault();
      setMobileOverlay(null);
    };
    window.addEventListener("keydown", handler);
    onCleanup(() => window.removeEventListener("keydown", handler));
  });

  createEffect(() => {
    if (!openMenu()) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest(".meta-field")) {
        setOpenMenu(null);
      }
    };
    window.addEventListener("mousedown", handler);
    onCleanup(() => window.removeEventListener("mousedown", handler));
  });

  createEffect(() => {
    const projectId = activeProjectId();
    const repo = detailRepo().trim();
    if (!projectId || !repo) {
      setBranches([]);
      setRepoStatus("idle");
      setRepoStatusMessage("");
      setRepoStatusVisible(false);
      if (repoStatusTimer) {
        window.clearTimeout(repoStatusTimer);
        repoStatusTimer = undefined;
      }
      return;
    }
    let active = true;
    setRepoStatus("checking");
    setRepoStatusMessage("");
    setRepoStatusVisible(true);
    if (repoStatusTimer) {
      window.clearTimeout(repoStatusTimer);
    }
    repoStatusTimer = window.setTimeout(() => {
      setRepoStatusVisible(false);
      repoStatusTimer = undefined;
    }, 2500);
    const timer = window.setTimeout(async () => {
      const shouldUpdate = repo !== savedRepo.trim();
      if (shouldUpdate) {
        try {
          await updateProject(projectId, { repo });
          savedRepo = repo;
        } catch {
          if (!active) return;
          setBranches([]);
          setRepoStatus("error");
          setRepoStatusMessage("Failed to save repo");
          return;
        }
      }
      const res = await fetchProjectBranches(projectId);
      if (!active) return;
      if (res.ok) {
        setBranches(res.data.branches);
        if (!res.data.branches.includes(detailBranch())) {
          setDetailBranch(
            res.data.branches.includes("main")
              ? "main"
              : (res.data.branches[0] ?? "main")
          );
        }
        if (res.data.branches.length > 0) {
          setRepoStatus("ok");
          setRepoStatusMessage("Repo looks good");
        } else {
          setRepoStatus("error");
          setRepoStatusMessage("No branches found");
        }
      } else {
        setBranches([]);
        setRepoStatus("error");
        setRepoStatusMessage(res.error || "Repo not found");
      }
    }, 400);
    onCleanup(() => {
      active = false;
      window.clearTimeout(timer);
    });
  });

  createEffect(() => {
    const projectId = activeProjectId();
    if (!projectId) return;
    let active = true;
    const load = async () => {
      const res = await fetchSubagents(projectId, true);
      if (!active) return;
      if (res.ok) {
        setSubagents(res.data.items);
        setSubagentError(null);
      } else {
        setSubagentError(res.error);
      }
    };
    load();
    const timer = setInterval(load, 2000);
    onCleanup(() => {
      active = false;
      clearInterval(timer);
    });
  });

  createEffect(() => {
    const project = detail();
    const sessionKeys = detailSessionKeys();
    if (!project) return;
    const agentIds = Object.keys(sessionKeys);
    if (agentIds.length === 0) {
      setAihubRunMeta({});
      setAihubRunLogs({});
      return;
    }
    let active = true;
    const load = async () => {
      const nextMeta: Record<string, { lastTs?: number }> = {};
      const nextLogs: Record<string, LogItem[]> = {};
      for (const agentId of agentIds) {
        const sessionKey = sessionKeys[agentId];
        if (!sessionKey) continue;
        const res = await fetchFullHistory(agentId, sessionKey);
        if (!active) return;
        nextLogs[agentId] = buildAihubLogs(res.messages);
        const last = res.messages[res.messages.length - 1];
        if (last?.timestamp) {
          nextMeta[agentId] = { lastTs: last.timestamp };
        }
      }
      if (!active) return;
      setAihubRunMeta(nextMeta);
      setAihubRunLogs(nextLogs);
    };
    load();
    onCleanup(() => {
      active = false;
    });
  });

  createEffect(() => {
    const projectId = activeProjectId();
    const key = selectedRunKey();
    if (!projectId || !key || !key.startsWith("subagent:")) {
      setSubagentLogs([]);
      return;
    }
    const slug = key.slice("subagent:".length);
    setSubagentLogs([]);
    let active = true;
    let cursor = 0;
    const poll = async () => {
      const res = await fetchSubagentLogs(projectId, slug, cursor);
      if (!active) return;
      if (res.ok) {
        if (res.data.events.length > 0) {
          setSubagentLogs((prev) => [...prev, ...res.data.events]);
          const isRunning = selectedRun()?.status === "running";
          if (isRunning && runLogAtBottom()) {
            scrollSubagentLogToBottom();
          }
        }
        cursor = res.data.cursor;
      }
    };
    poll();
    const timer = setInterval(poll, 2000);
    onCleanup(() => {
      active = false;
      clearInterval(timer);
    });
  });

  createEffect(() => {
    selectedRunKey();
    setRunLogAtBottom(true);
    setInitialRunScroll(true);
  });

  createEffect(() => {
    selectedRunLogItems();
    if (!initialRunScroll()) return;
    if (!selectedRun()) return;
    if (selectedRunLogItems().length === 0) return;
    requestAnimationFrame(() => {
      scrollSubagentLogToBottom();
      setInitialRunScroll(false);
    });
  });

  const toggleColumn = (id: string) => {
    setExpanded((prev) => {
      if (prev.includes(id)) return prev.filter((col) => col !== id);
      if (prev.length >= 2) return [...prev.slice(1), id];
      return [...prev, id];
    });
  };

  const handleStatusChange = async (id: string, status: string) => {
    setDetailStatus(status);
    await updateProject(id, { status });
    await refetch();
    await refetchDetail();
  };

  const handleDomainChange = async (id: string, domain: string) => {
    setDetailDomain(domain);
    await updateProject(id, { domain });
    await refetch();
    await refetchDetail();
  };

  const handleOwnerChange = async (id: string, owner: string) => {
    setDetailOwner(owner);
    await updateProject(id, { owner });
    await refetch();
    await refetchDetail();
  };

  const handleModeChange = async (id: string, mode: string) => {
    setDetailMode(mode);
    await updateProject(id, { executionMode: mode });
    await refetch();
    await refetchDetail();
  };

  const handleAppetiteChange = async (id: string, appetite: string) => {
    setDetailAppetite(appetite);
    await updateProject(id, { appetite });
    await refetch();
    await refetchDetail();
  };

  const handleRunAgentChange = (runAgent: string) => {
    setDetailRunAgent(runAgent);
  };

  const handleRunModeChange = (runMode: string) => {
    setDetailRunMode(runMode);
  };

  const handleStart = async (projectId: string) => {
    setStartError("");
    if (isRalphLoopMode()) {
      const iterations = Number(detailRalphIterations());
      if (!Number.isFinite(iterations) || iterations < 1) {
        setStartError("Iterations must be a number >= 1");
        return;
      }
      const result = await spawnRalphLoop(projectId, {
        cli: detailRalphCli(),
        iterations,
        promptFile: detailRalphPromptFile().trim() || undefined,
      });
      if (!result.ok) {
        setStartError(result.error);
        return;
      }
      if (detailStatus() === "todo") {
        setDetailStatus("in_progress");
        await updateProject(projectId, { status: "in_progress" });
      }
      await refetch();
      await refetchDetail();
      return;
    }

    const custom = customStartEnabled()
      ? customStartPrompt().trim()
      : undefined;
    const agent = selectedRunAgent();
    const result = await startProjectRun(projectId, {
      customPrompt: custom,
      runAgent: detailRunAgent().trim() || undefined,
      runMode: agent?.type === "cli" ? detailRunMode() : undefined,
      baseBranch: agent?.type === "cli" ? detailBranch() : undefined,
      slug:
        agent?.type === "cli" && detailRunMode() === "worktree"
          ? detailSlug().trim()
          : undefined,
    });
    if (!result.ok) {
      setStartError(result.error);
      return;
    }
    // Auto-advance to in_progress if currently todo
    if (detailStatus() === "todo") {
      setDetailStatus("in_progress");
      await updateProject(projectId, { status: "in_progress" });
    }
    setCustomStartPrompt("");
    setCustomStartEnabled(false);
    await refetch();
    await refetchDetail();
  };

  const handleStop = async (projectId: string) => {
    setStartError("");
    const running = runningAgent();
    if (!running || running.type !== "subagent" || !running.slug) {
      setStartError("No running agent to stop");
      return;
    }
    const result = await interruptSubagent(projectId, running.slug);
    if (!result.ok) {
      setStartError(result.error);
      return;
    }
    // Polling will refresh the status automatically
  };

  const handleArchiveToggle = async (
    projectId: string,
    slug: string,
    archived: boolean
  ) => {
    if (!archived && !window.confirm(`Archive run ${slug}?`)) return;
    if (archived) {
      await unarchiveSubagent(projectId, slug);
    } else {
      await archiveSubagent(projectId, slug);
    }
  };

  const handleRepoSave = async (id: string) => {
    await updateProject(id, { repo: detailRepo() });
    savedRepo = detailRepo().trim();
    await refetchDetail();
  };

  const handleTitleSave = async (id: string) => {
    const newTitle = detailTitle().trim();
    if (!newTitle) return;
    await updateProject(id, { title: newTitle });
    await refetch();
    await refetchDetail();
    setEditingTitle(false);
  };

  const handleDocSave = async (id: string, docKey: string) => {
    let content = detailDocs()[docKey] ?? "";
    const files = detailPendingFiles();

    if (files.length > 0) {
      const uploadResult = await uploadAttachments(id, files);
      if (uploadResult.ok) {
        const attachmentSection = buildAttachmentSection(uploadResult.data);
        content = content + (content ? "\n\n" : "") + attachmentSection;
        setDetailDocs((prev) => ({ ...prev, [docKey]: content }));
      }
      setDetailPendingFiles([]);
      void clearFilesFromStore(DETAIL_FILES_STORE, id);
    }

    await updateProject(id, { docs: { [docKey]: content } });
    await refetch();
    await refetchDetail();
    setEditingDoc(null);
  };

  const handleDetailDragOver = (e: DragEvent) => {
    e.preventDefault();
    setDetailIsDragging(true);
  };

  const handleDetailDragLeave = (e: DragEvent) => {
    e.preventDefault();
    if (e.currentTarget === e.target) {
      setDetailIsDragging(false);
    }
  };

  const handleDetailDrop = (projectId: string) => async (e: DragEvent) => {
    e.preventDefault();
    setDetailIsDragging(false);
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length === 0) return;

    if (editingDoc()) {
      // Edit mode: queue files for upload on save (shown in pending files list)
      setDetailPendingFiles((prev) => [...prev, ...files]);
    } else {
      // View mode: upload immediately and save
      const uploadResult = await uploadAttachments(projectId, files);
      if (!uploadResult.ok) return;

      const attachmentSection = buildAttachmentSection(uploadResult.data);
      const docKey = detailDocTab();
      const current = detailDocs()[docKey] ?? "";
      const updated = current + (current ? "\n\n" : "") + attachmentSection;
      setDetailDocs((prev) => ({ ...prev, [docKey]: updated }));
      await updateProject(projectId, { docs: { [docKey]: updated } });
      await refetch();
      await refetchDetail();
    }
  };

  const removeDetailFile = (index: number) => {
    setDetailPendingFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleAddComment = async (projectId: string) => {
    const body = newComment().trim();
    if (!body) return;
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const optimisticEntry = { author: "AIHub", date: dateStr, body };
    setDetailThread((prev) => [...prev, optimisticEntry]);
    setNewComment("");
    await addProjectComment(projectId, body);
    await refetchDetail();
  };

  const handleCommentUpdate = async (projectId: string, index: number) => {
    const body = editingCommentBody().trim();
    if (!body) return;
    setDetailThread((prev) =>
      prev.map((e, i) => (i === index ? { ...e, body } : e))
    );
    setEditingCommentIndex(null);
    await updateProjectComment(projectId, index, body);
    await refetchDetail();
  };

  const handleCommentDelete = async (projectId: string, index: number) => {
    if (!window.confirm("Delete this comment?")) return;
    setDetailThread((prev) => prev.filter((_, i) => i !== index));
    await deleteProjectComment(projectId, index);
    await refetchDetail();
  };

  const clearDeleteSuccess = () => {
    setDeleteSuccess(null);
    try {
      localStorage.removeItem(DELETE_SUCCESS_KEY);
    } catch {
      // ignore
    }
  };

  const showDeleteSuccess = (message: string) => {
    setDeleteSuccess(message);
    setTimeout(() => clearDeleteSuccess(), 2200);
  };

  const handleDeleteProject = async (id: string, title: string) => {
    if (!window.confirm("Move this project to trash?")) return;
    const result = await deleteProject(id);
    if (!result.ok) {
      console.error(result.error);
      return;
    }
    const message = title || "Project moved to trash";
    try {
      localStorage.setItem(DELETE_SUCCESS_KEY, message);
      setTimeout(() => {
        try {
          localStorage.removeItem(DELETE_SUCCESS_KEY);
        } catch {
          // ignore
        }
      }, 2200);
    } catch {
      // ignore
    }
    showDeleteSuccess(message);
    await refetch();
    closeDetail();
  };

  const handleArchiveProject = async (id: string) => {
    if (!window.confirm("Archive this project?")) return;
    const result = await archiveProject(id);
    if (!result.ok) {
      console.error(result.error);
      return;
    }
    await refetch();
    closeDetail();
  };

  const handleUnarchiveProject = async (id: string) => {
    if (!window.confirm("Unarchive this project?")) return;
    const result = await unarchiveProject(id);
    if (!result.ok) {
      console.error(result.error);
      return;
    }
    await refetch();
    await refetchDetail();
  };

  const handleSelectAgent = (id: string) => {
    setSelectedAgent(id);
    if (isMobile()) {
      setMobileOverlay("chat");
    }
  };

  const openDetail = (id: string) => {
    setSearchParams({ project: id });
  };

  const scrollSubagentLogToBottom = () => {
    if (!subagentLogPaneRef) return;
    requestAnimationFrame(() => {
      if (!subagentLogPaneRef) return;
      subagentLogPaneRef.scrollTop = subagentLogPaneRef.scrollHeight;
    });
  };

  const closeDetail = () => {
    setSearchParams({ project: undefined });
  };

  const closeMobileOverlay = () => {
    setMobileOverlay(null);
  };

  const openCreateModal = () => {
    const saved = loadFormFromStorage();
    setCreateModalOpen(true);
    setCreateTitle(saved?.title ?? "");
    setCreateDescription(saved?.description ?? "");
    setCreateError("");
    setCreateToast("");
    setFilesLoaded(false);
    setPendingFiles([]);
    void loadFilesFromStorage().then((files) => {
      setPendingFiles(files);
      setFilesLoaded(true);
    });
    setIsDragging(false);
  };

  const closeCreateModal = () => {
    setCreateModalOpen(false);
    setIsDragging(false);
    setFilesLoaded(false);
  };

  const validateTitle = (title: string): string | null => {
    const trimmed = title.trim();
    if (!trimmed) return "Title is required";
    const words = trimmed.split(/\s+/).filter(Boolean);
    if (words.length < 2) return "Title must contain at least two words";
    return null;
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    if (e.currentTarget === e.target) {
      setIsDragging(false);
    }
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length > 0) {
      setPendingFiles((prev) => [...prev, ...files]);
    }
  };

  const handleFileSelect = (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (files.length > 0) {
      setPendingFiles((prev) => [...prev, ...files]);
    }
    input.value = "";
  };

  const removeFile = (index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleCardDragStart =
    (id: string, status: string) => (e: DragEvent) => {
      setDraggingCardId(id);
      setDraggingFromStatus(status);
      setDragOverColumn(null);
      if (e.dataTransfer) {
        e.dataTransfer.setData("text/plain", id);
        e.dataTransfer.effectAllowed = "move";
      }
    };

  const handleCardDragEnd = () => {
    setDraggingCardId(null);
    setDraggingFromStatus(null);
    setDragOverColumn(null);
  };

  const handleColumnDragOver = (status: string) => (e: DragEvent) => {
    if (!draggingCardId()) return;
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "move";
    }
    setDragOverColumn(status);
  };

  const handleColumnDragLeave = (status: string) => (e: DragEvent) => {
    if (e.currentTarget === e.target && dragOverColumn() === status) {
      setDragOverColumn(null);
    }
  };

  const handleColumnDrop = (status: string) => async (e: DragEvent) => {
    if (!draggingCardId()) return;
    e.preventDefault();
    const id = e.dataTransfer?.getData("text/plain") || draggingCardId();
    if (!id) return;
    if (draggingFromStatus() === status) {
      setDragOverColumn(null);
      return;
    }
    await handleStatusChange(id, status);
    setDragOverColumn(null);
    setDraggingCardId(null);
    setDraggingFromStatus(null);
  };

  const handleCreateSubmit = async () => {
    let title = createTitle().trim();
    const description = createDescription().trim();
    if (!title && description) {
      const firstLine = description.split(/\r?\n/)[0]?.trim() ?? "";
      const cleaned = firstLine.replace(/^[#>*\s-]+/, "").trim();
      if (cleaned) {
        title = cleaned;
        setCreateTitle(cleaned);
      }
    }

    const error = validateTitle(title);
    if (error) {
      setCreateError(error);
      return;
    }

    setCreateError("");
    const result = await createProject({
      title,
      description: description || undefined,
    });

    if (!result.ok) {
      setCreateError(result.error);
      setCreateToast(result.error);
      setTimeout(() => setCreateToast(""), 3000);
      return;
    }

    const projectId = result.data.id;
    const files = pendingFiles();
    let attachmentSection = "";

    if (files.length > 0) {
      const uploadResult = await uploadAttachments(projectId, files);
      if (!uploadResult.ok) {
        setCreateToast(uploadResult.error);
        setTimeout(() => setCreateToast(""), 3000);
        closeCreateModal();
        await refetch();
        return;
      }

      attachmentSection = buildAttachmentSection(uploadResult.data);
    }

    if (attachmentSection) {
      const currentReadme = result.data.docs?.README || "";
      const updatedReadme =
        currentReadme + (currentReadme ? "\n\n" : "") + attachmentSection;
      await updateProject(projectId, { docs: { README: updatedReadme } });
    }

    clearFormFromStorage();
    void clearFilesFromStorage();
    setCreateTitle("");
    setCreateDescription("");
    setCreateError("");
    setCreateToast("");
    setPendingFiles([]);
    setIsDragging(false);
    setFilesLoaded(false);
    setCreateModalOpen(false);
    setCreateSuccess(result.data.title);
    setTimeout(() => setCreateSuccess(null), 2200);
    await refetch();
  };

  createEffect(() => {
    if (!createModalOpen()) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeCreateModal();
      }
    };
    window.addEventListener("keydown", handler);
    onCleanup(() => window.removeEventListener("keydown", handler));
  });

  createEffect(() => {
    if (!createSuccess() && !deleteSuccess()) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setCreateSuccess(null);
        clearDeleteSuccess();
      }
    };
    window.addEventListener("keydown", handler);
    onCleanup(() => window.removeEventListener("keydown", handler));
  });

  createEffect(() => {
    if (!createModalOpen()) return;
    saveFormToStorage({
      title: createTitle(),
      description: createDescription(),
    });
  });

  createEffect(() => {
    if (!createModalOpen() || !filesLoaded()) return;
    void saveFilesToStorage(pendingFiles());
  });

  createEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "c" && !createModalOpen() && !activeProjectId()) {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
        if (target.isContentEditable) return;
        if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
        if (window.getSelection()?.toString()) return;
        e.preventDefault();
        openCreateModal();
      }
    };
    window.addEventListener("keydown", handler);
    onCleanup(() => window.removeEventListener("keydown", handler));
  });

  return (
    <div
      class="app-layout"
      classList={{ "left-collapsed": sidebarCollapsed() }}
      onClick={(e) => {
        if (!isMobile() || sidebarCollapsed()) return;
        const target = e.target as HTMLElement;
        if (
          target.closest(".agent-sidebar") ||
          target.closest(".mobile-sidebar-toggle")
        )
          return;
        setSidebarCollapsed(true);
      }}
    >
      <Show when={createSuccess()}>
        <div class="create-success" onClick={() => setCreateSuccess(null)}>
          <div class="create-success-card">
            <div class="create-success-title">Project created</div>
            <div class="create-success-subtitle">{createSuccess()}</div>
          </div>
        </div>
      </Show>
      <Show when={deleteSuccess()}>
        <div class="create-success" onClick={clearDeleteSuccess}>
          <div class="create-success-card">
            <div class="create-success-title">Moved to trash</div>
            <div class="create-success-subtitle">{deleteSuccess()}</div>
          </div>
        </div>
      </Show>
      <AgentSidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
        selectedAgent={selectedAgent}
        onSelectAgent={handleSelectAgent}
      />
      <Show when={isMobile()}>
        <button
          class="mobile-sidebar-toggle"
          type="button"
          onClick={() => setSidebarCollapsed((prev) => !prev)}
          aria-label="Toggle sidebar"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M3 12h18M3 6h18M3 18h18" />
          </svg>
        </button>
      </Show>
      <main class="kanban-main">
        <div class="projects-page">
          <header class="projects-header">
            <h1 class="header-title">AIHub</h1>
            <input
              class="filter-input"
              type="text"
              placeholder="Filter by title or domain..."
              value={filterText()}
              onInput={(e) => setFilterText(e.currentTarget.value)}
            />
            <button
              class="archive-link"
              type="button"
              onClick={() => setShowArchived((prev) => !prev)}
            >
              {showArchived() ? "Hide archive" : "Archived"}
            </button>
          </header>

          <Show when={projects.loading}>
            <div class="projects-loading">Loading projects...</div>
          </Show>
          <Show when={projects.error}>
            <div class="projects-error">Failed to load projects</div>
          </Show>

          <Show when={showArchived()}>
            <div class="archive-panel">
              <div class="archive-panel-header">
                <div class="archive-panel-title">Archived</div>
                <button
                  class="archive-panel-close"
                  type="button"
                  onClick={() => setShowArchived(false)}
                >
                  Close
                </button>
              </div>
              <Show when={archivedProjects.loading}>
                <div class="archive-panel-loading">
                  Loading archived projects...
                </div>
              </Show>
              <Show when={archivedProjects.error}>
                <div class="archive-panel-error">
                  Failed to load archived projects
                </div>
              </Show>
              <Show
                when={
                  !archivedProjects.loading &&
                  (archivedProjects() ?? []).length === 0
                }
              >
                <div class="archive-panel-empty">No archived projects</div>
              </Show>
              <div class="archive-panel-list">
                <For each={archivedProjects() ?? []}>
                  {(item) => (
                    <button
                      class="archive-item"
                      type="button"
                      onClick={() => openDetail(item.id)}
                    >
                      <div class="archive-item-title">{item.title}</div>
                      <div class="archive-item-id">{item.id}</div>
                    </button>
                  )}
                </For>
              </div>
            </div>
          </Show>

          <div class="board">
            <For each={COLUMNS}>
              {(column) => {
                const items = () => grouped().get(column.id) ?? [];
                const isExpanded = () => expanded().includes(column.id);
                return (
                  <section
                    class={`column ${isExpanded() ? "expanded" : "collapsed"}`}
                    classList={{
                      "drop-target": dragOverColumn() === column.id,
                    }}
                    style={{ "--col": column.color }}
                    onDragOver={handleColumnDragOver(column.id)}
                    onDragLeave={handleColumnDragLeave(column.id)}
                    onDrop={handleColumnDrop(column.id)}
                  >
                    <div class="column-header-wrapper">
                      <button
                        class="column-header"
                        onClick={() => toggleColumn(column.id)}
                      >
                        <div class="column-title">{column.title}</div>
                        <div class="column-count">{items().length}</div>
                      </button>
                      <Show when={column.id === "maybe" && isExpanded()}>
                        <button
                          class="create-btn"
                          onClick={openCreateModal}
                          title="Create project (c)"
                        >
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                          >
                            <path d="M12 5v14M5 12h14" />
                          </svg>
                        </button>
                      </Show>
                    </div>
                    <Show when={isExpanded()}>
                      <div class="column-body">
                        <Show when={items().length === 0}>
                          <div class="empty-state">No projects</div>
                        </Show>
                        <For each={items()}>
                          {(item) => {
                            const fm = item.frontmatter ?? {};
                            const owner = getFrontmatterString(fm, "owner");
                            const domain = getFrontmatterString(fm, "domain");
                            const mode = getFrontmatterString(
                              fm,
                              "executionMode"
                            );
                            const appetite = getFrontmatterString(
                              fm,
                              "appetite"
                            );
                            const created = getFrontmatterString(fm, "created");
                            return (
                              <div
                                class="card"
                                role="button"
                                tabIndex={0}
                                draggable={true}
                                onDragStart={handleCardDragStart(
                                  item.id,
                                  column.id
                                )}
                                onDragEnd={handleCardDragEnd}
                                onClick={() => {
                                  if (draggingCardId()) return;
                                  openDetail(item.id);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    openDetail(item.id);
                                  }
                                }}
                              >
                                <div class="card-id">{item.id}</div>
                                <div class="card-title">{item.title}</div>
                                <div class="card-meta">
                                  <Show when={owner}>
                                    <span>{owner}</span>
                                  </Show>
                                  <Show when={domain}>
                                    <span>{domain}</span>
                                  </Show>
                                  <Show when={mode}>
                                    <span>{mode}</span>
                                  </Show>
                                  <Show when={appetite}>
                                    <span>{appetite}</span>
                                  </Show>
                                </div>
                                <div class="card-footer">
                                  <span>
                                    {created
                                      ? formatCreatedRelative(created)
                                      : ""}
                                  </span>
                                </div>
                              </div>
                            );
                          }}
                        </For>
                      </div>
                    </Show>
                  </section>
                );
              }}
            </For>
          </div>

          <Show when={activeProjectId()}>
            <div class="overlay" role="dialog" aria-modal="true">
              <div class="overlay-backdrop" onClick={closeDetail} />
              <div class="overlay-panel">
                <button
                  class="overlay-close"
                  onClick={closeDetail}
                  aria-label="Close"
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M18 6L6 18" />
                    <path d="M6 6l12 12" />
                  </svg>
                </button>
                <div class="overlay-header">
                  <Show when={detail()}>
                    {(data) => {
                      const project = data() as ProjectDetail;
                      const [copied, setCopied] = createSignal(false);
                      const isArchived =
                        normalizeStatus(
                          getFrontmatterString(project.frontmatter, "status")
                        ) === "archived";
                      return (
                        <>
                          <div class="title-block">
                            <span
                              class="id-pill"
                              classList={{ copied: copied() }}
                              onClick={() => {
                                navigator.clipboard.writeText(
                                  project.absolutePath
                                );
                                setCopied(true);
                                setTimeout(() => setCopied(false), 600);
                              }}
                              title="Click to copy project path"
                            >
                              {project.id}
                            </span>
                            <Show
                              when={editingTitle()}
                              fallback={
                                <h2
                                  class="editable-title"
                                  onDblClick={() => setEditingTitle(true)}
                                  title="Double-click to edit"
                                >
                                  {detailTitle() || project.title}
                                </h2>
                              }
                            >
                              <input
                                class="title-input"
                                value={detailTitle()}
                                onInput={(e) =>
                                  setDetailTitle(e.currentTarget.value)
                                }
                                onBlur={() => handleTitleSave(project.id)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter")
                                    handleTitleSave(project.id);
                                  if (e.key === "Escape") {
                                    e.stopPropagation();
                                    setDetailTitle(project.title);
                                    setEditingTitle(false);
                                  }
                                }}
                                autofocus
                              />
                            </Show>
                          </div>
                          <button
                            type="button"
                            class="archive-button"
                            onClick={() =>
                              isArchived
                                ? handleUnarchiveProject(project.id)
                                : handleArchiveProject(project.id)
                            }
                            title={
                              isArchived
                                ? "Unarchive project"
                                : "Archive project"
                            }
                            aria-label={
                              isArchived
                                ? "Unarchive project"
                                : "Archive project"
                            }
                          >
                            <Show
                              when={isArchived}
                              fallback={
                                <svg
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  stroke-width="2"
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                >
                                  <path d="M4 7h16" />
                                  <path d="M5 7v12h14V7" />
                                  <path d="M9 12l3 3 3-3" />
                                </svg>
                              }
                            >
                              <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                              >
                                <path d="M4 7h16" />
                                <path d="M5 7v12h14V7" />
                                <path d="M9 15l3-3 3 3" />
                              </svg>
                            </Show>
                          </button>
                          <button
                            type="button"
                            class="trash-button"
                            onClick={() =>
                              handleDeleteProject(
                                project.id,
                                detailTitle() || project.title
                              )
                            }
                            title="Move to trash"
                            aria-label="Move to trash"
                          >
                            <svg
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                            >
                              <path d="M3 6h18" />
                              <path d="M8 6V4h8v2" />
                              <path d="M19 6l-1 14H6L5 6" />
                              <path d="M10 11v6" />
                              <path d="M14 11v6" />
                            </svg>
                          </button>
                        </>
                      );
                    }}
                  </Show>
                  <Show when={detail.loading}>
                    <h2>Loading...</h2>
                  </Show>
                </div>
                <div class="overlay-content">
                  <div
                    class="detail"
                    classList={{ "drag-over": detailIsDragging() }}
                    onDragOver={handleDetailDragOver}
                    onDragLeave={handleDetailDragLeave}
                  >
                    <Show when={detail.loading}>
                      <div class="projects-loading">Loading...</div>
                    </Show>
                    <Show when={detail.error}>
                      <div class="projects-error">Failed to load project</div>
                    </Show>
                    <Show when={detail()}>
                      {(data) => {
                        const project = data() as ProjectDetail;
                        const fm = project.frontmatter ?? {};
                        return (
                          <>
                            <div
                              class="detail-drop-zone"
                              onDrop={handleDetailDrop(project.id)}
                            />
                            <div class="detail-meta">
                              <div class="meta-field">
                                <button
                                  class="meta-button"
                                  onClick={() =>
                                    setOpenMenu(
                                      openMenu() === "status" ? null : "status"
                                    )
                                  }
                                >
                                  <svg
                                    class="meta-icon"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2"
                                  >
                                    <path d="M5 12l4 4L19 6" />
                                  </svg>
                                  {detailStatus()
                                    ? getStatusLabel(detailStatus())
                                    : "status"}
                                </button>
                                <Show when={openMenu() === "status"}>
                                  <div class="meta-menu">
                                    <For each={COLUMNS}>
                                      {(col) => (
                                        <button
                                          class="meta-item"
                                          onClick={() =>
                                            handleStatusChange(
                                              project.id,
                                              col.id
                                            )
                                          }
                                        >
                                          {col.title}
                                        </button>
                                      )}
                                    </For>
                                    <button
                                      class="meta-item"
                                      onClick={() =>
                                        handleStatusChange(
                                          project.id,
                                          "cancelled"
                                        )
                                      }
                                    >
                                      Cancelled
                                    </button>
                                  </div>
                                </Show>
                              </div>
                              <span class="meta-chip">
                                <svg
                                  class="meta-icon"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  stroke-width="2"
                                >
                                  <circle cx="12" cy="12" r="9" />
                                  <path d="M12 7v5l3 3" />
                                </svg>
                                {formatCreatedRelative(
                                  getFrontmatterString(fm, "created")
                                )}
                              </span>
                              <div class="meta-field">
                                <button
                                  class="meta-button"
                                  onClick={() =>
                                    setOpenMenu(
                                      openMenu() === "appetite"
                                        ? null
                                        : "appetite"
                                    )
                                  }
                                >
                                  <svg
                                    class="meta-icon"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2"
                                  >
                                    <path d="M12 3v18" />
                                    <path d="M7 8h10" />
                                    <path d="M6 13h12" />
                                    <path d="M5 18h14" />
                                  </svg>
                                  {detailAppetite() || "appetite"}
                                </button>
                                <Show when={openMenu() === "appetite"}>
                                  <div class="meta-menu">
                                    <button
                                      class="meta-item"
                                      onClick={() =>
                                        handleAppetiteChange(project.id, "")
                                      }
                                    >
                                      unset
                                    </button>
                                    <button
                                      class="meta-item"
                                      onClick={() =>
                                        handleAppetiteChange(
                                          project.id,
                                          "small"
                                        )
                                      }
                                    >
                                      small
                                    </button>
                                    <button
                                      class="meta-item"
                                      onClick={() =>
                                        handleAppetiteChange(project.id, "big")
                                      }
                                    >
                                      big
                                    </button>
                                  </div>
                                </Show>
                              </div>
                              <div class="meta-field">
                                <button
                                  class="meta-button"
                                  onClick={() =>
                                    setOpenMenu(
                                      openMenu() === "domain" ? null : "domain"
                                    )
                                  }
                                >
                                  <svg
                                    class="meta-icon"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="2"
                                  >
                                    <path d="M20 7H10l-6 5 6 5h10l-4-5z" />
                                  </svg>
                                  {detailDomain() || "domain"}
                                </button>
                                <Show when={openMenu() === "domain"}>
                                  <div class="meta-menu">
                                    <button
                                      class="meta-item"
                                      onClick={() =>
                                        handleDomainChange(project.id, "")
                                      }
                                    >
                                      unset
                                    </button>
                                    <button
                                      class="meta-item"
                                      onClick={() =>
                                        handleDomainChange(project.id, "life")
                                      }
                                    >
                                      life
                                    </button>
                                    <button
                                      class="meta-item"
                                      onClick={() =>
                                        handleDomainChange(project.id, "admin")
                                      }
                                    >
                                      admin
                                    </button>
                                    <button
                                      class="meta-item"
                                      onClick={() =>
                                        handleDomainChange(project.id, "coding")
                                      }
                                    >
                                      coding
                                    </button>
                                  </div>
                                </Show>
                              </div>
                            </div>
                            <div class="detail-docs">
                              <Show when={docKeys().length > 1}>
                                <div class="detail-tabs">
                                  <For each={docKeys()}>
                                    {(key) => (
                                      <button
                                        type="button"
                                        classList={{
                                          active: detailDocTab() === key,
                                        }}
                                        onClick={() => setDetailDocTab(key)}
                                      >
                                        {key}
                                      </button>
                                    )}
                                  </For>
                                </div>
                              </Show>
                              <div class="detail-doc-body">
                                <For each={docKeys()}>
                                  {(key) => (
                                    <Show when={detailDocTab() === key}>
                                      <Show
                                        when={editingDoc() === key}
                                        fallback={
                                          <div
                                            class="detail-body"
                                            innerHTML={renderMarkdown(
                                              detailDocs()[key] ?? "",
                                              project.id
                                            )}
                                            onDblClick={() =>
                                              setEditingDoc(key)
                                            }
                                            title="Double-click to edit"
                                          />
                                        }
                                      >
                                        <textarea
                                          class="content-textarea"
                                          value={detailDocs()[key] ?? ""}
                                          onInput={(e) =>
                                            setDetailDocs((prev) => ({
                                              ...prev,
                                              [key]: e.currentTarget.value,
                                            }))
                                          }
                                          onBlur={() =>
                                            handleDocSave(project.id, key)
                                          }
                                          onKeyDown={(e) => {
                                            if (e.key === "Escape") {
                                              e.stopPropagation();
                                              setDetailDocs((prev) => ({
                                                ...prev,
                                                [key]: stripMarkdownMeta(
                                                  project.docs?.[key] ?? ""
                                                ),
                                              }));
                                              setDetailPendingFiles([]);
                                              setEditingDoc(null);
                                            } else if (
                                              e.key === "Enter" &&
                                              e.metaKey
                                            ) {
                                              e.preventDefault();
                                              handleDocSave(project.id, key);
                                            }
                                          }}
                                          autofocus
                                        />
                                        <Show
                                          when={detailPendingFiles().length > 0}
                                        >
                                          <div class="detail-pending-files">
                                            <label class="detail-pending-label">
                                              Files to upload on save
                                            </label>
                                            <div class="file-list">
                                              <For each={detailPendingFiles()}>
                                                {(file, index) => (
                                                  <div class="file-item">
                                                    <span class="file-name">
                                                      {file.name}
                                                    </span>
                                                    <button
                                                      class="file-remove"
                                                      onClick={() =>
                                                        removeDetailFile(
                                                          index()
                                                        )
                                                      }
                                                      type="button"
                                                      aria-label={`Remove ${file.name}`}
                                                    >
                                                      <svg
                                                        width="14"
                                                        height="14"
                                                        viewBox="0 0 24 24"
                                                        fill="none"
                                                        stroke="currentColor"
                                                        stroke-width="2"
                                                      >
                                                        <path d="M18 6L6 18M6 6l12 12" />
                                                      </svg>
                                                    </button>
                                                  </div>
                                                )}
                                              </For>
                                            </div>
                                          </div>
                                        </Show>
                                      </Show>
                                    </Show>
                                  )}
                                </For>
                              </div>
                            </div>
                            <div class="detail-thread">
                              <div class="thread-header">Thread</div>
                              <Show
                                when={detailThread().length > 0}
                                fallback={
                                  <div class="thread-empty">
                                    No comments yet.
                                  </div>
                                }
                              >
                                <div class="thread-list">
                                  <For each={detailThread()}>
                                    {(entry, index) => (
                                      <div class="thread-item">
                                        <div class="thread-meta">
                                          <span class="thread-author">
                                            {entry.author || "unknown"}
                                          </span>
                                          <span class="thread-date">
                                            {entry.date}
                                          </span>
                                          <button
                                            type="button"
                                            class="thread-delete-btn"
                                            onClick={() =>
                                              handleCommentDelete(
                                                project.id,
                                                index()
                                              )
                                            }
                                            aria-label="Delete comment"
                                          >
                                            <svg
                                              width="12"
                                              height="12"
                                              viewBox="0 0 24 24"
                                              fill="none"
                                              stroke="currentColor"
                                              stroke-width="2"
                                            >
                                              <path d="M18 6L6 18M6 6l12 12" />
                                            </svg>
                                          </button>
                                        </div>
                                        <Show
                                          when={
                                            editingCommentIndex() === index()
                                          }
                                          fallback={
                                            <div
                                              class="thread-body"
                                              innerHTML={renderMarkdown(
                                                entry.body,
                                                project.id
                                              )}
                                              onDblClick={() => {
                                                setEditingCommentIndex(index());
                                                setEditingCommentBody(
                                                  entry.body
                                                );
                                              }}
                                              title="Double-click to edit"
                                            />
                                          }
                                        >
                                          <textarea
                                            class="thread-edit-textarea"
                                            value={editingCommentBody()}
                                            onInput={(e) =>
                                              setEditingCommentBody(
                                                e.currentTarget.value
                                              )
                                            }
                                            onBlur={() =>
                                              handleCommentUpdate(
                                                project.id,
                                                index()
                                              )
                                            }
                                            onKeyDown={(e) => {
                                              if (e.key === "Escape") {
                                                e.stopPropagation();
                                                setEditingCommentIndex(null);
                                              } else if (
                                                e.key === "Enter" &&
                                                e.metaKey
                                              ) {
                                                e.preventDefault();
                                                handleCommentUpdate(
                                                  project.id,
                                                  index()
                                                );
                                              }
                                            }}
                                            ref={(el) =>
                                              setTimeout(() => el.focus(), 0)
                                            }
                                          />
                                        </Show>
                                      </div>
                                    )}
                                  </For>
                                </div>
                              </Show>
                              <div class="thread-add">
                                <textarea
                                  class="thread-add-textarea"
                                  placeholder="Add a comment..."
                                  value={newComment()}
                                  onInput={(e) =>
                                    setNewComment(e.currentTarget.value)
                                  }
                                  onKeyDown={(e) => {
                                    if (
                                      e.key === "Enter" &&
                                      e.metaKey &&
                                      newComment().trim()
                                    ) {
                                      e.preventDefault();
                                      handleAddComment(project.id);
                                    }
                                  }}
                                />
                                <button
                                  type="button"
                                  class="thread-add-btn"
                                  disabled={!newComment().trim()}
                                  onClick={() => handleAddComment(project.id)}
                                >
                                  Add
                                </button>
                              </div>
                            </div>
                            <Show when={detailIsDragging()}>
                              <div class="detail-drop-overlay">
                                <div class="drop-message">
                                  Drop files to attach
                                </div>
                              </div>
                            </Show>
                          </>
                        );
                      }}
                    </Show>
                  </div>
                  <div class="monitoring">
                    <div class="monitoring-meta">
                      <div class="meta-field">
                        <button
                          class="meta-button"
                          onClick={() =>
                            setOpenMenu(openMenu() === "owner" ? null : "owner")
                          }
                        >
                          <svg
                            class="meta-icon"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                          >
                            <circle cx="12" cy="8" r="4" />
                            <path d="M4 20c2.5-4 13.5-4 16 0" />
                          </svg>
                          {detailOwner() || "owner"}
                        </button>
                        <Show when={openMenu() === "owner"}>
                          <div class="meta-menu">
                            <button
                              class="meta-item"
                              onClick={() =>
                                handleOwnerChange(activeProjectId() ?? "", "")
                              }
                            >
                              unset
                            </button>
                            <For each={ownerOptions()}>
                              {(owner) => (
                                <button
                                  class="meta-item"
                                  onClick={() =>
                                    handleOwnerChange(
                                      activeProjectId() ?? "",
                                      owner
                                    )
                                  }
                                >
                                  {owner}
                                </button>
                              )}
                            </For>
                          </div>
                        </Show>
                      </div>
                      <Show when={!isMonitoringHidden()}>
                        <div class="meta-field">
                          <button
                            class="meta-button"
                            onClick={() =>
                              setOpenMenu(openMenu() === "mode" ? null : "mode")
                            }
                          >
                            <svg
                              class="meta-icon"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2"
                            >
                              <path d="M4 6h16M8 6v12M16 12v6" />
                            </svg>
                            {detailMode()
                              ? detailMode().replace(/_/g, " ")
                              : "execution mode"}
                          </button>
                          <Show when={openMenu() === "mode"}>
                            <div class="meta-menu">
                              <button
                                class="meta-item"
                                onClick={() =>
                                  handleModeChange(activeProjectId() ?? "", "")
                                }
                              >
                                unset
                              </button>
                              <button
                                class="meta-item"
                                onClick={() =>
                                  handleModeChange(
                                    activeProjectId() ?? "",
                                    "subagent"
                                  )
                                }
                              >
                                subagent
                              </button>
                              <button
                                class="meta-item"
                                onClick={() =>
                                  handleModeChange(
                                    activeProjectId() ?? "",
                                    "ralph_loop"
                                  )
                                }
                              >
                                ralph loop
                              </button>
                            </div>
                          </Show>
                        </div>
                        <Show when={detailDomain() === "coding"}>
                          <div class="meta-field meta-field-wide meta-field-stack">
                            <label class="meta-label">Repo</label>
                            <input
                              class="meta-input"
                              value={detailRepo()}
                              onInput={(e) =>
                                setDetailRepo(e.currentTarget.value)
                              }
                              onBlur={() =>
                                handleRepoSave(activeProjectId() ?? "")
                              }
                              placeholder="/abs/path/to/repo"
                            />
                            <Show
                              when={
                                repoStatusVisible() &&
                                repoStatus() !== "idle" &&
                                detailRepo().trim()
                              }
                            >
                              <div class={`repo-status ${repoStatus()}`}>
                                {repoStatus() === "checking"
                                  ? "Checking repo..."
                                  : repoStatusMessage()}
                              </div>
                            </Show>
                          </div>
                        </Show>
                      </Show>
                    </div>
                    <div class="runs-panel">
                      <div class="runs-header">
                        <h3 class="runs-title">
                          {isRalphLoopMode() ? "Ralph Loops" : "Agent Runs"}
                        </h3>
                        <div class="runs-header-actions">
                          <Show when={hasArchivedRuns()}>
                            <button
                              class="runs-archive-toggle"
                              type="button"
                              onClick={() =>
                                setShowArchivedRuns((prev) => !prev)
                              }
                            >
                              {showArchivedRuns()
                                ? "Hide archived"
                                : "Show archived"}
                            </button>
                          </Show>
                          <Show when={!isMonitoringHidden()}>
                            <div class="runs-actions">
                              <Show when={!runningAgent()}>
                                <Show when={!isRalphLoopMode()}>
                                  <label class="start-custom-toggle">
                                    <input
                                      type="checkbox"
                                      checked={customStartEnabled()}
                                      onChange={(e) =>
                                        setCustomStartEnabled(
                                          e.currentTarget.checked
                                        )
                                      }
                                    />
                                    <span>custom</span>
                                  </label>
                                </Show>
                              </Show>
                              <Show
                                when={runningAgent()}
                                fallback={
                                  <button
                                    class="start-btn"
                                    onClick={() =>
                                      handleStart(activeProjectId() ?? "")
                                    }
                                    disabled={!canStart()}
                                  >
                                    Start
                                  </button>
                                }
                              >
                                <button
                                  class="start-btn stop"
                                  onClick={() =>
                                    handleStop(activeProjectId() ?? "")
                                  }
                                >
                                  Stop
                                </button>
                              </Show>
                            </div>
                          </Show>
                        </div>
                      </div>
                      <Show when={!isMonitoringHidden() && !isRalphLoopMode()}>
                        <div class="runs-config">
                          <div class="runs-config-field">
                            <label class="meta-label">Agent</label>
                            <select
                              class="meta-select"
                              value={detailRunAgent()}
                              onChange={(e) =>
                                handleRunAgentChange(e.currentTarget.value)
                              }
                            >
                              <For each={runAgentOptions()}>
                                {(opt) => (
                                  <option value={opt.id}>{opt.label}</option>
                                )}
                              </For>
                            </select>
                          </div>
                          <Show when={selectedRunAgent()?.type === "cli"}>
                            <div class="runs-config-field">
                              <label class="meta-label">Run mode</label>
                              <select
                                class="meta-select"
                                value={detailRunMode()}
                                onChange={(e) =>
                                  handleRunModeChange(e.currentTarget.value)
                                }
                              >
                                <option value="main-run">main-run</option>
                                <option value="worktree">worktree</option>
                              </select>
                            </div>
                          </Show>
                          <Show when={selectedRunAgent()?.type === "cli"}>
                            <div class="runs-config-field">
                              <label class="meta-label">Base branch</label>
                              <select
                                class="meta-select"
                                value={detailBranch()}
                                onChange={(e) =>
                                  setDetailBranch(e.currentTarget.value)
                                }
                                disabled={branches().length === 0}
                              >
                                <For
                                  each={
                                    branches().length > 0
                                      ? branches()
                                      : ["main"]
                                  }
                                >
                                  {(branch) => (
                                    <option value={branch}>{branch}</option>
                                  )}
                                </For>
                              </select>
                            </div>
                          </Show>
                          <div class="runs-config-field">
                            <label class="meta-label">Slug</label>
                            <input
                              class="meta-input"
                              value={detailSlug()}
                              onInput={(e) =>
                                setDetailSlug(e.currentTarget.value)
                              }
                              placeholder="short-slug"
                              disabled={
                                selectedRunAgent()?.type !== "cli" ||
                                detailRunMode() !== "worktree"
                              }
                            />
                          </div>
                        </div>
                      </Show>
                      <Show when={!isMonitoringHidden() && isRalphLoopMode()}>
                        <div class="runs-config">
                          <div class="runs-config-field">
                            <label class="meta-label">CLI</label>
                            <select
                              class="meta-select"
                              value={detailRalphCli()}
                              onChange={(e) =>
                                setDetailRalphCli(
                                  e.currentTarget.value === "claude"
                                    ? "claude"
                                    : "codex"
                                )
                              }
                            >
                              <option value="codex">codex</option>
                              <option value="claude">claude</option>
                            </select>
                          </div>
                          <div class="runs-config-field">
                            <label class="meta-label">Iterations</label>
                            <input
                              class="meta-input"
                              type="number"
                              min="1"
                              value={detailRalphIterations()}
                              onInput={(e) =>
                                setDetailRalphIterations(e.currentTarget.value)
                              }
                              placeholder="20"
                            />
                          </div>
                          <div class="runs-config-field">
                            <label class="meta-label">Prompt file</label>
                            <input
                              class="meta-input"
                              value={detailRalphPromptFile()}
                              onInput={(e) =>
                                setDetailRalphPromptFile(e.currentTarget.value)
                              }
                              placeholder="(default) <project>/prompt.md"
                            />
                          </div>
                        </div>
                      </Show>
                      <Show when={customStartEnabled() && !isRalphLoopMode()}>
                        <textarea
                          class="custom-start-textarea"
                          rows={2}
                          value={customStartPrompt()}
                          placeholder="Add a one-off custom prompt..."
                          onInput={(e) =>
                            setCustomStartPrompt(e.currentTarget.value)
                          }
                        />
                      </Show>
                      <Show when={startError()}>
                        <div class="monitoring-error">{startError()}</div>
                      </Show>
                      <Show when={subagentError()}>
                        <div class="monitoring-error">{subagentError()}</div>
                      </Show>
                      <div class="runs-list">
                        <Show
                          when={agentRuns().length > 0}
                          fallback={<div class="log-empty">No runs yet.</div>}
                        >
                          <For each={groupedAgentRuns()}>
                            {(group) => {
                              const run = group.primary;
                              const relative = formatRunRelative(run.time);
                              const statusLabel =
                                group.displayStatus === "running"
                                  ? "WORKING"
                                  : group.displayStatus === "replied"
                                    ? "COMPLETED"
                                    : group.displayStatus === "error"
                                      ? "FAILED"
                                      : "IDLE";
                              const timeLabel = relative
                                ? group.displayStatus === "running"
                                  ? `Started ${relative}`
                                  : relative
                                : "No activity yet";
                              const loopMeta =
                                run.executionType === "ralph_loop" &&
                                run.iterations
                                  ? `${run.iterations} iterations`
                                  : "";
                              return (
                                <>
                                  <button
                                    class={`run-row ${selectedRunKey() === run.key ? "active" : ""} ${run.archived ? "archived" : ""}`}
                                    onClick={() =>
                                      setSelectedRunKey((prev) =>
                                        prev === run.key ? null : run.key
                                      )
                                    }
                                  >
                                    <span
                                      class={`status-dot ${group.displayStatus}`}
                                    />
                                    <div class="run-content">
                                      <div class="run-title">{run.label}</div>
                                      <div class="run-time">
                                        {statusLabel} • {timeLabel}
                                        <Show when={loopMeta}>
                                          <span> • {loopMeta}</span>
                                        </Show>
                                      </div>
                                    </div>
                                    <Show
                                      when={run.type === "subagent" && run.slug}
                                    >
                                      <div class="run-actions">
                                        <button
                                          class="archive-btn"
                                          type="button"
                                          title={
                                            run.archived
                                              ? "Unarchive run"
                                              : "Archive run"
                                          }
                                          aria-label={
                                            run.archived
                                              ? "Unarchive run"
                                              : "Archive run"
                                          }
                                          onClick={async (e) => {
                                            e.stopPropagation();
                                            const projectId = detail()?.id;
                                            if (!projectId || !run.slug) return;
                                            await handleArchiveToggle(
                                              projectId,
                                              run.slug,
                                              run.archived ?? false
                                            );
                                          }}
                                        >
                                          <svg
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            stroke-width="2"
                                          >
                                            <path d="M3 7h18v13H3z" />
                                            <path d="M7 7V4h10v3" />
                                            <path d="M7 12h10" />
                                          </svg>
                                        </button>
                                        <button
                                          class="kill-btn"
                                          type="button"
                                          title={
                                            run.executionType === "ralph_loop"
                                              ? "Kill loop"
                                              : "Kill subagent"
                                          }
                                          onClick={async (e) => {
                                            e.stopPropagation();
                                            const projectId = detail()?.id;
                                            if (!projectId || !run.slug) return;
                                            const label =
                                              run.executionType === "ralph_loop"
                                                ? "loop"
                                                : "subagent";
                                            if (
                                              !window.confirm(
                                                `Kill ${label} ${run.slug}? This removes all workspace data.`
                                              )
                                            )
                                              return;
                                            await killSubagent(
                                              projectId,
                                              run.slug
                                            );
                                            // Polling handles refresh; run will disappear within 2s
                                          }}
                                        >
                                          <svg
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            stroke-width="2"
                                          >
                                            <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14" />
                                          </svg>
                                        </button>
                                      </div>
                                    </Show>
                                  </button>
                                  <For each={group.children}>
                                    {(child) => (
                                      <button
                                        class={`run-row nested ${selectedRunKey() === child.key ? "active" : ""} ${child.archived ? "archived" : ""}`}
                                        onClick={() =>
                                          setSelectedRunKey((prev) =>
                                            prev === child.key
                                              ? null
                                              : child.key
                                          )
                                        }
                                      >
                                        <span
                                          class={`status-dot ${child.status}`}
                                        />
                                        <div class="run-content">
                                          <div class="run-title">
                                            {child.label}
                                          </div>
                                          <div class="run-time">
                                            WORKER •{" "}
                                            {formatRunRelative(child.time) ??
                                              "No activity yet"}
                                          </div>
                                        </div>
                                      </button>
                                    )}
                                  </For>
                                </>
                              );
                            }}
                          </For>
                        </Show>
                      </div>
                      <div class="runs-logs">
                        <Show
                          when={selectedRun()}
                          fallback={
                            <div class="log-empty">
                              Select a run to view logs.
                            </div>
                          }
                        >
                          <div
                            class="log-pane"
                            ref={subagentLogPaneRef}
                            onScroll={(e) => {
                              const target = e.currentTarget as HTMLDivElement;
                              const threshold = 120;
                              const atBottom =
                                target.scrollHeight -
                                  target.scrollTop -
                                  target.clientHeight <=
                                threshold;
                              setRunLogAtBottom(atBottom);
                            }}
                          >
                            <For each={selectedRunLogItems()}>
                              {(entry) => renderLogItem(entry)}
                            </For>
                            <Show when={selectedRunLogItems().length === 0}>
                              <div class="log-empty">No logs yet.</div>
                            </Show>
                          </div>
                        </Show>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Show>

          <Show when={createModalOpen()}>
            <div class="overlay" role="dialog" aria-modal="true">
              <div class="overlay-backdrop" onClick={closeCreateModal} />
              <div class="create-modal">
                <div class="create-modal-header">
                  <div class="create-title-block">
                    <h2>New project</h2>
                    <p class="create-subtitle">
                      Quick create with notes. Title defaults to the first note
                      line.
                    </p>
                  </div>
                  <button
                    class="overlay-close"
                    onClick={closeCreateModal}
                    aria-label="Close"
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div
                  class="create-modal-body"
                  classList={{ "drag-over": isDragging() }}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  <Show when={createToast()}>
                    <div class="create-toast" role="status">
                      {createToast()}
                    </div>
                  </Show>
                  <div class="create-field">
                    <label class="create-label" for="create-title">
                      Title <span class="create-required">*</span>
                    </label>
                    <input
                      id="create-title"
                      class="create-input"
                      type="text"
                      value={createTitle()}
                      onInput={(e) => {
                        setCreateTitle(e.currentTarget.value);
                        setCreateError("");
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          createNotesRef?.focus();
                        }
                      }}
                      placeholder="Short, descriptive title"
                      autofocus
                      classList={{ error: Boolean(createError()) }}
                    />
                    <div class="create-helper">
                      Required - 2+ words - Leave blank to use the first note
                      line
                    </div>
                    <Show when={createError()}>
                      <div class="create-error" role="alert">
                        {createError()}
                      </div>
                    </Show>
                  </div>
                  <div class="create-field create-notes">
                    <div class="create-notes-header">
                      <label class="create-label" for="create-notes">
                        Notes
                      </label>
                      <span class="create-optional">Optional</span>
                    </div>
                    <textarea
                      id="create-notes"
                      class="create-textarea"
                      value={createDescription()}
                      onInput={(e) =>
                        setCreateDescription(e.currentTarget.value)
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          void handleCreateSubmit();
                        }
                      }}
                      placeholder="Notes, context, links, or next steps..."
                      rows={10}
                      ref={createNotesRef}
                    />
                    <div class="create-helper">
                      Paste notes now so your agent has context later.
                    </div>
                  </div>
                  <div class="create-field">
                    <div class="create-label-row">
                      <label class="create-label">Attachments</label>
                      <button
                        class="file-button"
                        type="button"
                        onClick={() => fileInputRef?.click()}
                      >
                        Add files
                      </button>
                    </div>
                    <input
                      ref={fileInputRef}
                      class="file-input"
                      type="file"
                      multiple
                      onChange={handleFileSelect}
                    />
                  </div>
                  <Show when={pendingFiles().length > 0}>
                    <div class="create-field">
                      <label class="create-label">Selected files</label>
                      <div class="file-list">
                        <For each={pendingFiles()}>
                          {(file, index) => (
                            <div class="file-item">
                              <span class="file-name">{file.name}</span>
                              <button
                                class="file-remove"
                                onClick={() => removeFile(index())}
                                type="button"
                                aria-label={`Remove ${file.name}`}
                              >
                                <svg
                                  width="14"
                                  height="14"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  stroke-width="2"
                                >
                                  <path d="M18 6L6 18M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>
                  <Show when={isDragging()}>
                    <div class="drop-overlay">
                      <div class="drop-message">Drop files here</div>
                    </div>
                  </Show>
                </div>
                <div class="create-modal-footer">
                  <div class="create-footer-hints">
                    Esc to close | Cmd/Ctrl+Enter to create
                  </div>
                  <div class="create-footer-actions">
                    <button class="create-cancel" onClick={closeCreateModal}>
                      Cancel
                    </button>
                    <button class="create-submit" onClick={handleCreateSubmit}>
                      Create
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </Show>

          <style>{`
        .app-layout {
          display: flex;
          height: 100vh;
          overflow: hidden;
        }

        .mobile-sidebar-toggle {
          display: none;
        }

        .kanban-main {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
        }

        .projects-page {
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          font-family: "Adwaita Sans", "SF Pro Text", "Segoe UI", system-ui, sans-serif;
          color: #f2f2f2;
          background: #0c0e12;
        }

        .projects-header {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 16px 20px;
          border-bottom: 1px solid #1f242c;
          position: sticky;
          top: 0;
          background: #0c0e12;
          z-index: 5;
        }

        .header-title {
          font-size: 20px;
          font-weight: 700;
          letter-spacing: 0.02em;
        }

        .filter-input {
          margin-left: auto;
          padding: 8px 12px;
          font-size: 14px;
          border-radius: 8px;
          border: 1px solid #232a35;
          background: #131821;
          color: #e5e7eb;
          width: 220px;
          outline: none;
          transition: border-color 0.15s;
        }

        .filter-input::placeholder {
          color: #6b7280;
        }

        .filter-input:focus {
          border-color: #3b6ecc;
        }

        .archive-link {
          border: 1px solid #1f242c;
          background: transparent;
          color: #98a3b2;
          padding: 6px 10px;
          font-size: 12px;
          border-radius: 999px;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .archive-link:hover {
          border-color: #2a3240;
          color: #c4cbd6;
          background: rgba(255, 255, 255, 0.03);
        }

        .archive-panel {
          margin: 16px 18px 0;
          border: 1px solid #1f242c;
          border-radius: 14px;
          background: #0f131a;
          padding: 16px;
        }

        .archive-panel-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 12px;
        }

        .archive-panel-title {
          font-size: 14px;
          font-weight: 700;
          color: #d4d7dd;
          letter-spacing: 0.02em;
        }

        .archive-panel-close {
          border: 1px solid #1f242c;
          background: transparent;
          color: #98a3b2;
          padding: 4px 10px;
          font-size: 12px;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .archive-panel-close:hover {
          border-color: #2a3240;
          color: #c4cbd6;
          background: rgba(255, 255, 255, 0.03);
        }

        .archive-panel-loading,
        .archive-panel-error,
        .archive-panel-empty {
          color: #7f8896;
          font-size: 13px;
          padding: 6px 2px 0;
        }

        .archive-panel-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-top: 10px;
        }

        .archive-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 10px 12px;
          border-radius: 10px;
          border: 1px solid #1f242c;
          background: #0b0f14;
          color: #cfd6e3;
          cursor: pointer;
          text-align: left;
          transition: all 0.15s ease;
        }

        .archive-item:hover {
          border-color: #2a3240;
          background: #111822;
        }

        .archive-item-title {
          font-size: 13px;
          font-weight: 600;
        }

        .archive-item-id {
          font-size: 11px;
          color: #7f8896;
        }

        .projects-loading,
        .projects-error {
          padding: 24px;
          text-align: center;
          color: #8d97a6;
        }

        .board {
          display: flex;
          gap: 12px;
          padding: 18px 18px 36px;
          overflow-x: auto;
          overflow-y: hidden;
          scroll-behavior: smooth;
        }

        .board::-webkit-scrollbar {
          height: 6px;
        }

        .board::-webkit-scrollbar-thumb {
          background: #1d2430;
          border-radius: 999px;
        }

        .column {
          min-width: 240px;
          max-width: 320px;
          background: color-mix(in oklch, var(--col) 6%, #0c0e12 94%);
          border: 1px solid color-mix(in oklch, var(--col) 35%, #1d2430 65%);
          border-radius: 16px;
          display: flex;
          flex-direction: column;
          transition: all 0.2s ease;
        }

        .column.collapsed {
          min-width: 70px;
          max-width: 70px;
          padding-bottom: 12px;
        }

        .column-header-wrapper {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 0 4px;
        }

        .column-header {
          border: none;
          background: transparent;
          color: inherit;
          display: flex;
          flex: 1;
          align-items: center;
          justify-content: space-between;
          padding: 14px 12px;
          cursor: pointer;
        }

        .create-btn {
          background: color-mix(in oklch, var(--col) 25%, #1d2430 75%);
          border: 1px solid color-mix(in oklch, var(--col) 45%, #2a3240 55%);
          color: color-mix(in oklch, var(--col) 90%, #e7edf5 10%);
          border-radius: 8px;
          padding: 8px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s ease;
        }

        .create-btn:hover {
          background: color-mix(in oklch, var(--col) 35%, #1d2430 65%);
          border-color: color-mix(in oklch, var(--col) 55%, #2a3240 45%);
        }

        .column-title {
          font-size: 14px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: color-mix(in oklch, var(--col) 80%, #f1f4f8 20%);
        }

        .column-count {
          background: color-mix(in oklch, var(--col) 35%, #141a22 65%);
          color: #e7edf5;
          border-radius: 999px;
          padding: 2px 8px;
          font-size: 12px;
          font-weight: 700;
        }

        .column.collapsed .column-header {
          flex-direction: column;
          gap: 8px;
        }

        .column.collapsed .column-title {
          writing-mode: vertical-rl;
          text-orientation: sideways-left;
          font-size: 12px;
        }

        .column-body {
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding: 0 12px 16px;
          overflow-y: auto;
          max-height: calc(100vh - 180px);
        }

        .column.drop-target {
          background: color-mix(in oklch, var(--col) 10%, #0f141c 90%);
          box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--col) 55%, #1f2631 45%);
        }

        .empty-state {
          padding: 16px;
          text-align: center;
          color: #788391;
          border: 1px dashed color-mix(in oklch, var(--col) 40%, #232a35 60%);
          border-radius: 12px;
          font-size: 13px;
        }

        .card {
          background: color-mix(in oklch, var(--col) 8%, #0f141c 92%);
          border: 1px solid color-mix(in oklch, var(--col) 30%, #1f2631 70%);
          border-radius: 14px;
          padding: 12px;
          text-align: left;
          color: inherit;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .card-id {
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.2em;
          color: color-mix(in oklch, var(--col) 70%, #aeb6c2 30%);
        }

        .card-title {
          font-size: 16px;
          font-weight: 700;
          line-height: 1.2;
        }

        .card-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 6px 10px;
          font-size: 12px;
          color: color-mix(in oklch, var(--col) 55%, #c1c8d2 45%);
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }

        .card-footer {
          font-size: 12px;
          color: #9aa3b2;
        }

        .overlay {
          position: fixed;
          inset: 0;
          z-index: 50;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }

        .overlay-backdrop {
          position: absolute;
          inset: 0;
          background: rgba(4, 8, 14, 0.5);
          backdrop-filter: blur(4px);
          animation: overlay-fade 0.2s ease;
        }

        .overlay-panel {
          position: relative;
          width: min(1920px, 96vw);
          height: min(90vh, 900px);
          background: #0f141c;
          border: 1px solid #273042;
          border-radius: 20px;
          z-index: 1;
          display: flex;
          flex-direction: column;
          padding: 20px;
          gap: 16px;
          animation: overlay-in 0.2s ease;
        }

        .overlay-close {
          position: absolute;
          top: 16px;
          right: 16px;
          width: 36px;
          height: 36px;
          border-radius: 10px;
          border: 1px solid #2a3240;
          background: #151c26;
          color: #c6ceda;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .overlay-close:hover {
          background: #1a2330;
          border-color: #3a4250;
        }

        .create-modal {
          position: relative;
          width: min(700px, 92vw);
          max-height: 90vh;
          background: #0f141c;
          border: 1px solid #273042;
          border-radius: 4px;
          z-index: 1;
          display: flex;
          flex-direction: column;
          box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55);
          animation: overlay-in 0.24s ease;
        }

        .create-modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 22px 26px;
          border-bottom: 1px solid #1d2430;
        }

        .create-modal-header h2 {
          font-size: 20px;
          font-weight: 700;
          color: #e7edf5;
          margin: 0;
        }

        .create-title-block {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .create-subtitle {
          margin: 0;
          color: #9aa3b2;
          font-size: 13px;
          line-height: 1.4;
        }

        .create-modal-body {
          padding: 24px 26px 28px;
          display: flex;
          flex-direction: column;
          gap: 24px;
          overflow-y: auto;
          position: relative;
        }

        .create-modal-body.drag-over {
          background: rgba(58, 134, 255, 0.05);
        }

        .create-label-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .file-input {
          display: none;
        }

        .file-button {
          background: transparent;
          border: 1px solid #2a3240;
          color: #98a2b3;
          padding: 6px 10px;
          border-radius: 4px;
          font-size: 12px;
          cursor: pointer;
          transition: border-color 0.15s, color 0.15s;
        }

        .file-button:hover {
          border-color: #3a86ff;
          color: #c6d0db;
        }

        .file-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .file-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 12px;
          background: #141b26;
          border: 1px solid #2a3240;
          border-radius: 4px;
          gap: 12px;
        }

        .file-name {
          font-size: 13px;
          color: #c6d0db;
          flex: 1;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .file-remove {
          background: transparent;
          border: none;
          padding: 4px;
          cursor: pointer;
          color: #7d8796;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: color 0.15s;
          flex-shrink: 0;
        }

        .file-remove:hover {
          color: #f08b57;
        }

        .drop-overlay {
          position: absolute;
          inset: 0;
          background: rgba(58, 134, 255, 0.1);
          border: 2px dashed #3a86ff;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: none;
          z-index: 10;
        }

        .drop-message {
          font-size: 16px;
          font-weight: 600;
          color: #3a86ff;
          background: #0f141c;
          padding: 16px 32px;
          border-radius: 4px;
        }

        .create-success {
          position: fixed;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(4, 8, 14, 0.35);
          backdrop-filter: blur(3px);
          z-index: 60;
          animation: overlay-fade 0.2s ease;
        }

        .create-success-card {
          background: #0f141c;
          border: 1px solid #273042;
          border-radius: 8px;
          padding: 24px 32px;
          text-align: center;
          min-width: min(320px, 80vw);
          box-shadow: 0 14px 40px rgba(0, 0, 0, 0.45);
        }

        .create-success-title {
          font-size: 16px;
          font-weight: 700;
          color: #d2f8e5;
          margin-bottom: 6px;
        }

        .create-success-subtitle {
          font-size: 13px;
          color: #a6b0c3;
        }

        .create-toast {
          color: #f1b7b7;
          background: #2a1b1b;
          border: 1px solid #3c2525;
          border-radius: 10px;
          padding: 10px 14px;
          font-size: 13px;
        }

        .create-field {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .create-label {
          font-size: 13px;
          font-weight: 600;
          color: #c6d0db;
          letter-spacing: 0.02em;
        }

        .create-required {
          color: #f08b57;
        }

        .create-notes-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .create-optional {
          font-size: 12px;
          color: #7d8796;
          letter-spacing: 0.03em;
        }

        .create-input {
          background: #141b26;
          border: 1px solid #2a3240;
          color: #e7edf5;
          border-radius: 10px;
          padding: 10px 14px;
          font-size: 14px;
          font-family: inherit;
          transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
        }

        .create-input:focus {
          outline: none;
          border-color: #3b6ecc;
          background: #1a2330;
          box-shadow: 0 0 0 3px rgba(59, 110, 204, 0.2);
        }

        .create-input.error {
          border-color: #cc5b5b;
        }

        .create-textarea {
          background: #141b26;
          border: 1px solid #2a3240;
          color: #e7edf5;
          border-radius: 10px;
          padding: 10px 14px;
          font-size: 14px;
          font-family: inherit;
          resize: vertical;
          min-height: 160px;
          transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
        }

        .create-textarea:focus {
          outline: none;
          border-color: #3b6ecc;
          background: #1a2330;
          box-shadow: 0 0 0 3px rgba(59, 110, 204, 0.2);
        }

        .create-helper {
          font-size: 12px;
          color: #7d8796;
          line-height: 1.4;
        }

        .create-notes .create-label {
          font-size: 14px;
          color: #e7edf5;
        }

        .create-error {
          color: #f1b7b7;
          font-size: 13px;
          margin-top: -4px;
        }

        .create-modal-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 16px 26px 22px;
          border-top: 1px solid #1d2430;
        }

        .create-footer-hints {
          font-size: 12px;
          color: #7d8796;
        }

        .create-footer-actions {
          display: flex;
          gap: 12px;
        }

        .create-cancel {
          background: #141b26;
          border: 1px solid #2a3240;
          color: #98a3b2;
          border-radius: 10px;
          padding: 10px 20px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .create-cancel:hover {
          background: #1a2330;
          border-color: #3a4250;
          color: #b0b8c6;
        }

        .create-submit {
          background: #3b6ecc;
          border: 1px solid #5080d6;
          color: #ffffff;
          border-radius: 10px;
          padding: 10px 20px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .create-submit:hover {
          background: #4a7cd6;
          border-color: #6090e0;
        }

        .overlay-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding-right: 52px;
        }

        .trash-button {
          width: 34px;
          height: 34px;
          border-radius: 10px;
          border: 1px solid transparent;
          background: transparent;
          color: #7f8aa1;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.15s ease;
          margin-left: 6px;
        }

        .trash-button svg {
          width: 16px;
          height: 16px;
        }

        .trash-button:hover {
          background: #151b24;
          border-color: #2a3240;
          color: #d48c8c;
        }

        .archive-button {
          width: 34px;
          height: 34px;
          border-radius: 10px;
          border: 1px solid transparent;
          background: transparent;
          color: #7f8aa1;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .archive-button svg {
          width: 16px;
          height: 16px;
        }

        .archive-button:hover {
          background: #151b24;
          border-color: #2a3240;
          color: #d2b356;
        }

        .title-block {
          display: flex;
          align-items: center;
          gap: 12px;
          flex: 1;
          min-width: 0;
        }

        .overlay-header h2 {
          font-size: 20px;
          font-weight: 700;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .editable-title {
          cursor: text;
          border-radius: 4px;
          padding: 2px 6px;
          margin: -2px -6px;
          transition: background 0.15s ease;
        }

        .editable-title:hover {
          background: rgba(255, 255, 255, 0.05);
        }

        .title-input {
          font-size: 20px;
          font-weight: 700;
          background: #151c26;
          color: #e0e6ef;
          border: 1px solid #3b6ecc;
          border-radius: 6px;
          padding: 4px 8px;
          outline: none;
          flex: 1;
          min-width: 0;
          margin-right: 52px;
        }

        .id-pill {
          background: #141a23;
          border: 1px solid #2a3240;
          color: #9aa3b2;
          font-size: 11px;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          padding: 6px 10px;
          border-radius: 999px;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .id-pill:hover {
          background: #1a2330;
          border-color: #3a4250;
          color: #b0b8c6;
        }

        .id-pill.copied {
          background: #2a4a3a;
          border-color: #4a7a5a;
          color: #a0e0b0;
        }

        .overlay-content {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          gap: 16px;
          flex: 1;
          min-height: 0;
        }

        .detail,
        .monitoring {
          background: #111722;
          border: 1px solid #273042;
          border-radius: 16px;
          padding: 16px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 12px;
          min-height: 0;
          position: relative;
        }

        .detail-actions {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .status-select {
          background: #151c26;
          color: #e0e6ef;
          border: 1px solid #2a3240;
          border-radius: 999px;
          padding: 6px 12px;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.1em;
        }

        .detail-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 8px 16px;
          font-size: 12px;
          color: #9aa3b2;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          align-items: center;
        }

        .meta-chip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }

        .meta-field {
          position: relative;
          display: inline-flex;
          align-items: center;
        }

        .meta-button {
          background: transparent;
          color: inherit;
          border: none;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          cursor: pointer;
          padding: 0;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }

        .meta-button:focus {
          outline: none;
          color: #e4e9f1;
        }

        .meta-icon {
          width: 12px;
          height: 12px;
          opacity: 0.55;
        }

        .meta-menu {
          position: absolute;
          top: calc(100% + 6px);
          left: 0;
          background: #151c26;
          border: 1px solid #2a3240;
          border-radius: 10px;
          padding: 6px;
          display: flex;
          flex-direction: column;
          gap: 4px;
          min-width: 140px;
          z-index: 5;
        }

        .meta-item {
          background: transparent;
          border: none;
          color: #e0e6ef;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-size: 11px;
          text-align: left;
          padding: 6px 8px;
          border-radius: 8px;
          cursor: pointer;
        }

        .meta-item:hover {
          background: #232c3a;
        }

        .monitoring-meta {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
          gap: 12px;
          align-items: end;
        }

        .meta-label {
          display: block;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          color: #7f8a9a;
          margin-bottom: 6px;
        }

        .meta-select,
        .meta-input {
          width: 100%;
          background: #151c26;
          color: #e0e6ef;
          border: 1px solid #2a3240;
          border-radius: 10px;
          padding: 8px 10px;
          font-size: 12px;
        }

        .meta-input::placeholder {
          color: #7f8a9a;
        }

        .meta-field-wide {
          grid-column: span 2;
        }

        .meta-field-stack {
          display: flex;
          flex-direction: column;
          align-items: stretch;
        }

        .detail-docs {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .detail-tabs {
          display: flex;
          gap: 8px;
        }

        .detail-tabs button {
          flex: 1;
          padding: 8px 12px;
          border-radius: 10px;
          border: 1px solid #2a3240;
          background: #151c26;
          color: #8b96a5;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          cursor: pointer;
          transition: background 0.15s, color 0.15s, border-color 0.15s;
        }

        .detail-tabs button.active {
          background: #1c2634;
          border-color: #3b82f6;
          color: #e0e6ef;
        }

        .detail-doc-body {
          display: flex;
          flex-direction: column;
          gap: 8px;
          min-height: 120px;
        }

        .detail-thread {
          border-top: 1px solid #223042;
          padding-top: 12px;
          display: flex;
          flex-direction: column;
          gap: 10px;
          background: #0d1117;
          margin: 12px -16px -16px -16px;
          padding: 12px 16px 16px 16px;
          border-radius: 0 0 12px 12px;
        }

        .thread-header {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          color: #7f8a9a;
        }

        .thread-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .thread-item {
          background: #141b26;
          border: 1px solid #263142;
          border-radius: 12px;
          padding: 10px 12px;
        }

        .thread-meta {
          display: flex;
          justify-content: space-between;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #8b96a5;
          margin-bottom: 6px;
          align-items: center;
          gap: 8px;
        }

        .thread-delete-btn {
          opacity: 0;
          background: none;
          border: none;
          color: #8b96a5;
          cursor: pointer;
          padding: 2px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 4px;
          transition: opacity 0.15s ease, color 0.15s ease;
        }

        .thread-item:hover .thread-delete-btn {
          opacity: 1;
        }

        .thread-delete-btn:hover {
          color: #e74c3c;
        }

        .thread-body {
          white-space: pre-wrap;
          color: #d4dbe5;
          font-size: 13px;
          line-height: 1.2;
          cursor: pointer;
          border-radius: 6px;
          padding: 2px 4px;
          margin: -2px -4px;
        }

        .thread-body:hover {
          background: rgba(255, 255, 255, 0.02);
        }

        .thread-body ul,
        .thread-body ol {
          padding-left: 20px;
          margin: 0;
        }

        .thread-body li {
          margin: 0;
          padding: 0;
        }

        .thread-body p {
          margin: 0;
        }

        .thread-edit-textarea,
        .thread-add-textarea {
          width: 100%;
          min-height: 100px;
          background: #151c26;
          border: 1px solid #3b4859;
          border-radius: 8px;
          color: #d4dbe5;
          padding: 8px 10px;
          font-size: 13px;
          font-family: inherit;
          resize: vertical;
          outline: none;
        }

        .thread-edit-textarea:focus,
        .thread-add-textarea:focus {
          border-color: #3b6ecc;
        }

        .thread-add {
          display: flex;
          gap: 8px;
          margin-top: 4px;
        }

        .thread-add-textarea {
          flex: 1;
        }

        .thread-add-btn {
          padding: 8px 16px;
          background: #3b6ecc;
          border: none;
          border-radius: 8px;
          color: white;
          cursor: pointer;
          align-self: flex-end;
          font-size: 13px;
        }

        .thread-add-btn:hover:not(:disabled) {
          background: #4a7dd8;
        }

        .thread-add-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .thread-empty {
          color: #7f8a9a;
          font-size: 12px;
        }

        .detail-body {
          flex: 1;
          overflow: auto;
          background: transparent;
          border: none;
          padding: 0;
          color: #d4dbe5;
          font-size: 14px;
          line-height: 1.5;
          cursor: text;
          border-radius: 8px;
          transition: background 0.15s ease;
        }

        .detail-body:hover {
          background: rgba(255, 255, 255, 0.02);
        }

        .content-textarea {
          flex: 1;
          width: 100%;
          min-height: 420px;
          background: #151c26;
          color: #d4dbe5;
          border: 1px solid #3b6ecc;
          border-radius: 8px;
          padding: 12px;
          font-size: 14px;
          line-height: 1.5;
          font-family: inherit;
          resize: vertical;
          outline: none;
        }

        .content-textarea::placeholder {
          color: #7f8a9a;
        }

        .detail.drag-over {
          background: rgba(58, 134, 255, 0.03);
        }

        .detail-drop-zone {
          position: absolute;
          inset: 0;
          pointer-events: none;
        }

        .detail.drag-over .detail-drop-zone {
          pointer-events: auto;
        }

        .detail-drop-overlay {
          position: absolute;
          inset: 0;
          background: rgba(58, 134, 255, 0.1);
          border: 2px dashed #3a86ff;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: none;
          z-index: 10;
        }

        .detail-pending-files {
          margin-top: 12px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .detail-pending-label {
          font-size: 12px;
          color: #7d8796;
        }

        .detail-body :is(h1, h2, h3) {
          margin: 1em 0 0.5em;
        }

        .detail-body p {
          margin: 0 0 0.8em;
        }

        .detail-body hr {
          border: none;
          border-top: 1px solid #2a3240;
          margin: 1.2em 0;
        }

        .detail-body ul,
        .detail-body ol {
          margin: 0 0 1em 1.2em;
          padding: 0;
        }

        .detail-body li {
          margin: 0.35em 0;
        }

        .detail-body a {
          color: #9db7ff;
          text-decoration: none;
        }

        .detail-body a:hover {
          color: #c7d6ff;
        }

        .monitoring-main {
          display: flex;
          flex-direction: column;
          gap: 12px;
          border: 1px solid #233041;
          border-radius: 14px;
          padding: 12px;
          background: #0f1520;
          flex: 1;
          min-height: 0;
        }

        .monitoring-columns {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 12px;
          flex: 1;
          min-height: 0;
        }

        .monitoring-columns.main-only {
          grid-template-columns: minmax(0, 1fr);
        }

        .monitoring-columns.subagents-only {
          grid-template-columns: 58px minmax(0, 1fr);
        }

        .monitoring-columns.split {
          grid-template-columns: minmax(0, 1fr) auto;
        }

        .main-toggle-rail {
          width: 58px;
          padding: 8px 6px;
          border: 1px solid #233041;
          border-radius: 14px;
          background: #0f1520;
          color: #98a3b2;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          writing-mode: vertical-rl;
          text-orientation: mixed;
        }


        .monitoring-header-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .monitoring-actions {
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }

        .collapse-btn {
          background: #141b26;
          border: 1px solid #2a3240;
          color: #98a3b2;
          border-radius: 999px;
          padding: 6px 10px;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          cursor: pointer;
        }

        .collapse-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .start-custom-toggle {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          color: #8b96a5;
        }

        .start-custom-toggle input {
          accent-color: #3b6ecc;
        }

        .status-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          color: #9aa3b2;
        }

        .status-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #5b6470;
        }

        .status-dot.running {
          background: #53b97c;
          box-shadow: 0 0 8px rgba(83, 185, 124, 0.6);
        }

        .status-dot.replied {
          background: #53b97c;
        }

        .status-dot.error {
          background: #e36d6d;
          box-shadow: 0 0 8px rgba(227, 109, 109, 0.55);
        }

        .status-pill.running .status-dot {
          background: #53b97c;
          box-shadow: 0 0 8px rgba(83, 185, 124, 0.6);
        }

        .start-btn,
        .stop-btn {
          background: #1b2431;
          border: 1px solid #2b3648;
          color: #e0e6ef;
          border-radius: 10px;
          padding: 8px 14px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
        }

        .start-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .start-btn.stop {
          background: #2a1b1b;
          border-color: #3c2525;
          color: #f1b7b7;
        }

        .stop-btn {
          background: #2a1b1b;
          border-color: #3c2525;
          color: #f1b7b7;
        }

        .stop-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          background: #1b2431;
          border-color: #2b3648;
          color: #8b96a5;
        }

        .monitoring-tabs {
          display: flex;
          gap: 8px;
        }

        .tab-btn {
          background: #141b26;
          border: 1px solid #2a3240;
          color: #98a3b2;
          border-radius: 999px;
          padding: 6px 12px;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          cursor: pointer;
        }

        .tab-btn.active {
          background: #2b3648;
          color: #e0e6ef;
        }

        .log-pane {
          background: #0d121a;
          border: 1px solid #1f2631;
          border-radius: 12px;
          padding: 10px;
          overflow: auto;
          display: flex;
          flex-direction: column;
          gap: 8px;
          font-family: "SF Mono", "Menlo", monospace;
          font-size: 12px;
          color: #cfd6e2;
          flex: 1;
          min-height: 0;
        }

        .log-line {
          display: flex;
          gap: 10px;
          align-items: flex-start;
          padding: 6px 8px;
          border-radius: 10px;
          background: rgba(17, 23, 34, 0.6);
        }

        .log-line.collapsible {
          padding: 0;
          display: block;
        }

        .log-summary {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 6px 8px;
          cursor: pointer;
          list-style: none;
          width: 100%;
        }

        .log-summary::-webkit-details-marker {
          display: none;
        }

        .log-line.collapsible .log-text {
          background: rgba(8, 11, 16, 0.6);
          border-radius: 10px;
          padding: 8px;
        }

        .log-stack {
          display: flex;
          flex-direction: column;
          gap: 4px;
          min-width: 0;
          flex: 1;
        }

        .log-title {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          color: inherit;
        }

        .log-line.assistant {
          color: #d6e4ff;
        }

        .log-line.user {
          color: #c8f2e6;
          background: rgba(17, 34, 28, 0.5);
        }

        .log-line.muted {
          color: #8b96a5;
          background: rgba(20, 25, 34, 0.6);
        }

        .log-line.error {
          color: #f5b0b0;
          background: rgba(42, 27, 27, 0.6);
        }

        .log-line.live {
          color: #e8f6ff;
        }

        .log-icon {
          width: 14px;
          height: 14px;
          opacity: 0.8;
          margin-top: 2px;
          flex: 0 0 auto;
        }

        .log-text {
          margin: 0;
          white-space: pre-wrap;
          word-break: break-word;
        }

        .log-empty {
          color: #7f8a9a;
          font-size: 12px;
        }

        .monitoring-input {
          display: flex;
          gap: 8px;
          align-items: flex-end;
          margin-top: auto;
        }

        .monitoring-textarea {
          flex: 1;
          background: #111722;
          border: 1px solid #273042;
          border-radius: 10px;
          padding: 8px 10px;
          color: #e0e6ef;
          font-size: 12px;
          resize: none;
        }

        .custom-start-textarea {
          background: #111722;
          border: 1px solid #273042;
          border-radius: 10px;
          padding: 8px 10px;
          color: #e0e6ef;
          font-size: 12px;
          resize: vertical;
        }

        .monitoring-send {
          background: #1b2431;
          border: 1px solid #2b3648;
          color: #e0e6ef;
          border-radius: 10px;
          padding: 8px 12px;
          font-size: 12px;
          cursor: pointer;
        }

        .monitoring-send:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .monitoring-empty p {
          margin: 0;
          color: #8d97a6;
          font-size: 12px;
        }

        .monitoring-error {
          color: #f1b7b7;
          background: #2a1b1b;
          border: 1px solid #3c2525;
          border-radius: 10px;
          padding: 8px 10px;
          font-size: 12px;
        }

        .runs-panel {
          display: flex;
          flex-direction: column;
          gap: 12px;
          min-height: 0;
          flex: 1;
        }

        .runs-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 8px;
        }

        .runs-header-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .runs-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .runs-archive-toggle {
          border: 1px solid #2b3442;
          background: #101621;
          color: #9aa6b4;
          font-size: 11px;
          padding: 4px 8px;
          border-radius: 999px;
          cursor: pointer;
        }

        .runs-archive-toggle:hover {
          color: #d2d9e3;
          border-color: #3b485c;
        }

        .custom-start-textarea {
          width: 100%;
          min-height: 50px;
          max-height: 100px;
          resize: vertical;
          background: #141b26;
          border: 1px solid #1f2631;
          border-radius: 6px;
          padding: 8px;
          color: #b8c4d0;
          font-size: 12px;
          font-family: inherit;
          margin-bottom: 8px;
        }

        .custom-start-textarea:focus {
          outline: none;
          border-color: #3e7bfa;
        }

        .runs-title {
          font-size: 13px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #e7edf5;
          margin: 0;
        }

        .runs-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
          overflow: auto;
          max-height: 220px;
        }

        .run-row {
          background: #141b26;
          border: 1px solid #1f2631;
          border-radius: 10px;
          padding: 10px 12px;
          text-align: left;
          color: inherit;
          cursor: pointer;
          display: flex;
          gap: 10px;
          align-items: flex-start;
        }

        .run-row.active {
          border-color: #3b6ecc;
          background: #1a2230;
        }

        .run-row.archived {
          opacity: 0.6;
        }

        .run-row.nested {
          margin-left: 18px;
          border-style: dashed;
          padding: 8px 10px;
        }

        .run-row .status-dot {
          width: 8px;
          height: 8px;
          margin-top: 4px;
          flex: 0 0 auto;
        }

        .run-actions {
          margin-left: auto;
          display: flex;
          align-items: center;
          gap: 6px;
          flex-shrink: 0;
        }

        .run-content {
          display: flex;
          flex-direction: column;
          gap: 4px;
          min-width: 0;
        }

        .run-title {
          font-size: 12px;
          font-weight: 600;
        }

        .run-time {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #8b96a5;
        }

        .run-row .kill-btn {
          background: none;
          border: none;
          padding: 4px;
          cursor: pointer;
          color: #666;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .run-row .archive-btn {
          background: none;
          border: none;
          padding: 4px;
          cursor: pointer;
          color: #6b7280;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .run-row .archive-btn svg {
          width: 14px;
          height: 14px;
        }

        .run-row .archive-btn:hover {
          color: #f6c454;
        }

        .run-row .kill-btn svg {
          width: 14px;
          height: 14px;
        }

        .run-row .kill-btn:hover {
          color: #e53935;
        }

        .runs-logs {
          display: flex;
          flex-direction: column;
          gap: 8px;
          flex: 1;
          min-height: 0;
        }

        .repo-status {
          font-size: 11px;
          margin-top: 4px;
          color: #9aa6b4;
        }

        .repo-status.ok {
          color: #7fcf9a;
        }

        .repo-status.error {
          color: #f199a2;
        }

        .subagents-panel {
          display: flex;
          flex-direction: column;
          gap: 10px;
          border: 1px solid #233041;
          border-radius: 14px;
          padding: 12px;
          background: #0f1520;
          min-height: 0;
        }

        .subagents-panel.collapsed {
          width: 58px;
          padding: 8px 6px;
          align-items: center;
        }

        .subagents-panel.expanded {
          width: 320px;
        }

        .monitoring-columns.subagents-only .subagents-panel.expanded {
          width: 100%;
        }

        .subagents-toggle {
          width: 100%;
          background: #141b26;
          border: 1px solid #1f2631;
          color: #98a3b2;
          border-radius: 10px;
          padding: 8px 10px;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
        }

        .subagents-panel.collapsed .subagents-toggle {
          writing-mode: vertical-rl;
          text-orientation: mixed;
          height: 100%;
          justify-content: center;
        }

        .subagents-count {
          background: #1b2431;
          border-radius: 999px;
          padding: 2px 6px;
          font-size: 10px;
        }

        .subagents-body {
          display: flex;
          flex-direction: column;
          gap: 10px;
          min-height: 0;
          flex: 1;
        }

        .subagents-list {
          display: flex;
          flex-direction: column;
          gap: 6px;
          overflow: auto;
          min-height: 0;
        }

        .subagent-row {
          background: #141b26;
          border: 1px solid #1f2631;
          border-radius: 10px;
          padding: 8px 10px;
          text-align: left;
          color: inherit;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .subagent-row.active {
          border-color: #3b6ecc;
          background: #1a2230;
        }

        .subagent-title {
          font-size: 12px;
          font-weight: 600;
        }

        .subagent-meta {
          display: flex;
          gap: 10px;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          color: #8b96a5;
        }

        .subagent-status.running {
          color: #53b97c;
        }

        .subagent-status.error {
          color: #f08b57;
        }

        .subagent-status.replied {
          color: #9db7ff;
        }

        .subagent-logs {
          display: flex;
          flex-direction: column;
          gap: 8px;
          flex: 1;
          min-height: 0;
        }

        .subagent-stop {
          align-self: flex-end;
        }

        .mobile-detail-tabs {
          display: none;
        }

        @media (max-width: 768px) {
          .mobile-hidden {
            display: none !important;
          }

          .overlay-panel {
            height: auto;
            max-height: 92vh;
            padding: 16px;
            overflow-y: auto;
          }

          .overlay-content {
            display: flex;
            flex-direction: column;
            gap: 16px;
          }

          .overlay-content .detail,
          .overlay-content .monitoring {
            flex: none;
          }

          .mobile-detail-tabs {
            display: flex;
            gap: 8px;
            padding-bottom: 8px;
          }

          .mobile-detail-tabs button {
            flex: 1;
            padding: 10px 16px;
            border-radius: 8px;
            border: 1px solid #2a3240;
            background: transparent;
            color: #8b96a5;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            transition: background 0.15s, color 0.15s, border-color 0.15s;
          }

          .mobile-detail-tabs button.active {
            background: #1a2330;
            border-color: #3b82f6;
            color: #e0e6ef;
          }

          .mobile-detail-tabs button:focus-visible {
            outline: 2px solid rgba(59, 130, 246, 0.6);
            outline-offset: 2px;
          }

          .board {
            padding: 12px;
          }
        }

        .mobile-activity-btn {
          position: fixed;
          right: 20px;
          bottom: 20px;
          width: 56px;
          height: 56px;
          border-radius: 999px;
          border: none;
          background: #3b82f6;
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 12px 24px rgba(15, 23, 42, 0.4);
          cursor: pointer;
          z-index: 900;
          transition: transform 0.15s ease, box-shadow 0.15s ease;
        }

        .mobile-activity-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 16px 30px rgba(15, 23, 42, 0.5);
        }

        .mobile-activity-btn:focus-visible {
          outline: 2px solid rgba(255, 255, 255, 0.7);
          outline-offset: 3px;
        }

        .mobile-activity-btn svg {
          width: 22px;
          height: 22px;
        }

        .mobile-overlay {
          position: fixed;
          inset: 0;
          z-index: 900;
          background: #0c0e12;
          display: flex;
          flex-direction: column;
        }

        .mobile-overlay-panel {
          flex: 1;
          display: flex;
          flex-direction: column;
          background: #0f141c;
          animation: overlay-in 0.2s ease;
          min-height: 0;
        }

        @media (max-width: 768px) {
          .app-layout {
            display: block;
            padding-left: 0;
          }

          .kanban-main {
            width: 100%;
          }

          .projects-header {
            padding: 16px;
            padding-left: 56px;
          }

          .mobile-sidebar-toggle {
            position: fixed;
            top: 12px;
            left: 12px;
            z-index: 840;
            width: 32px;
            height: 32px;
            border-radius: 8px;
            border: 1px solid #2a2a2a;
            background: #1a1a1a;
            color: #e6e6e6;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
          }

          .mobile-sidebar-toggle:focus-visible {
            outline: 2px solid rgba(59, 130, 246, 0.6);
            outline-offset: 2px;
          }

          .mobile-sidebar-toggle svg {
            width: 16px;
            height: 16px;
          }
        }

        @keyframes overlay-in {
          from {
            opacity: 0;
            transform: translateY(8px) scale(0.985);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }

        @keyframes overlay-fade {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
      `}</style>
        </div>
      </main>
      <ContextPanel
        collapsed={rightPanelCollapsed}
        onToggleCollapse={() => setRightPanelCollapsed((prev) => !prev)}
        selectedAgent={selectedAgent}
        onSelectAgent={handleSelectAgent}
        onClearSelection={() => {
          setSelectedAgent(null);
          if (isMobile()) setMobileOverlay(null);
        }}
        onOpenProject={openDetail}
      />
      <Show when={isMobile() && !mobileOverlay()}>
        <button
          class="mobile-activity-btn"
          type="button"
          onClick={() => setMobileOverlay("feed")}
          aria-label="Open activity feed"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M8 6h12M8 12h12M8 18h12" />
            <path d="M4 6h.01M4 12h.01M4 18h.01" />
          </svg>
        </button>
      </Show>
      <Show when={isMobile() && mobileOverlay() === "chat"}>
        <div class="mobile-overlay" role="dialog" aria-modal="true">
          <div class="mobile-overlay-panel">
            <AgentChat
              agentId={agentType() === "lead" ? selectedAgent() : null}
              agentName={agentName()}
              agentType={agentType()}
              subagentInfo={subagentInfo()}
              onBack={closeMobileOverlay}
              onOpenProject={openDetail}
              fullscreen
            />
          </div>
        </div>
      </Show>
      <Show when={isMobile() && mobileOverlay() === "feed"}>
        <div class="mobile-overlay" role="dialog" aria-modal="true">
          <div class="mobile-overlay-panel">
            <ActivityFeed
              onSelectAgent={handleSelectAgent}
              onOpenProject={openDetail}
              onBack={closeMobileOverlay}
              fullscreen
            />
          </div>
        </div>
      </Show>
    </div>
  );
}
