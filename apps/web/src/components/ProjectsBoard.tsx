import { For, Show, createEffect, createMemo, createResource, createSignal, onCleanup } from "solid-js";
import { A, useNavigate, useParams } from "@solidjs/router";
import { marked } from "marked";
import DOMPurify from "dompurify";
import {
  fetchProjects,
  fetchProject,
  updateProject,
  fetchAgents,
  fetchFullHistory,
  subscribeToSession,
  streamMessage,
  fetchSubagents,
  fetchSubagentLogs,
  fetchProjectBranches,
  spawnSubagent,
  interruptSubagent,
} from "../api/client";
import type { ProjectListItem, ProjectDetail, FullHistoryMessage, ContentBlock, SubagentListItem, SubagentLogEvent } from "../api/types";
import { buildProjectSummary, buildStartPrompt } from "./projectMonitoring";

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
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, string>;
}

const timestampFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function formatTimestamp(ts: string | number | undefined): string {
  if (!ts) return "";
  const date = typeof ts === "number" ? new Date(ts) : new Date(ts);
  if (Number.isNaN(date.getTime())) return "";
  return timestampFormatter.format(date);
}

function formatCreated(raw?: string): string {
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString();
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
function renderMarkdown(content: string): string {
  const stripped = content
    .replace(/^\s*---[\s\S]*?\n---\s*\n?/, "")
    .replace(/^\s*#\s+.+\n+/, "");
  const html = marked.parse(stripped, { breaks: true, async: false }) as string;
  return DOMPurify.sanitize(html);
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
            const command = typeof args?.command === "string" ? args.command : "";
            const params = typeof args?.args === "string" ? args.args : "";
            const description = typeof args?.description === "string" ? args.description : "";
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
            const content = typeof args?.content === "string" ? args.content : "";
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
      if (event.text) entries.push({ tone: "user", body: event.text });
      continue;
    }
    if (event.type === "assistant") {
      if (event.text) entries.push({ tone: "assistant", body: event.text });
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
        const summary = ["Bash", command].filter((part) => part.trim()).join(" ");
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
        const content = typeof args?.content === "string" ? args.content : event.text ?? "";
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
        const body = output?.text ? `${event.text ?? ""}\n\n${output.text}`.trim() : event.text ?? "";
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

function extractUserTexts(messages: FullHistoryMessage[]): string[] {
  const texts: string[] = [];
  for (const msg of messages) {
    if (msg.role !== "user") continue;
    const text = getTextBlocks(msg.content);
    if (text) texts.push(text);
  }
  return texts;
}

function resizeTextarea(el: HTMLTextAreaElement | undefined) {
  if (!el) return;
  el.style.height = "auto";
  const lineHeight = 20;
  const maxHeight = lineHeight * 10;
  el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
}

function mergePendingAihubMessages(
  messages: FullHistoryMessage[],
  pending: string[]
): { merged: LogItem[]; remaining: string[] } {
  if (pending.length === 0) return { merged: buildAihubLogs(messages), remaining: [] };
  const historyUsers = extractUserTexts(messages);
  let cursor = 0;
  const remaining: string[] = [];
  for (const text of pending) {
    const idx = historyUsers.indexOf(text, cursor);
    if (idx === -1) {
      remaining.push(text);
    } else {
      cursor = idx + 1;
    }
  }
  const base = buildAihubLogs(messages);
  const merged =
    remaining.length > 0 ? [...base, ...remaining.map((text) => ({ tone: "user", body: text }))] : base;
  return { merged, remaining };
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
  icon?: "read" | "write" | "bash" | "tool" | "output" | "diff" | "system" | "error";
  title?: string;
  body: string;
  collapsible?: boolean;
};

function logTone(type: string): "assistant" | "user" | "muted" | "error" {
  if (type === "user") return "user";
  if (type === "assistant") return "assistant";
  if (type === "error" || type === "stderr") return "error";
  if (type === "tool_call" || type === "tool_output" || type === "diff" || type === "session" || type === "message") {
    return "muted";
  }
  return "assistant";
}

function logIcon(icon?: LogItem["icon"]) {
  if (icon === "bash") {
    return (
      <svg class="log-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M4 5h16v14H4z" />
        <path d="M7 9l3 3-3 3" />
        <path d="M12 15h4" />
      </svg>
    );
  }
  if (icon === "read") {
    return (
      <svg class="log-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M4 19h12a4 4 0 0 0 0-8h-1" />
        <path d="M4 19V5h9a4 4 0 0 1 4 4v2" />
      </svg>
    );
  }
  if (icon === "write") {
    return (
      <svg class="log-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 20h9" />
        <path d="M16.5 3.5l4 4L8 20l-4 1 1-4L16.5 3.5z" />
      </svg>
    );
  }
  if (icon === "tool") {
    return (
      <svg class="log-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14.7 6.3a5 5 0 0 0-6.4 6.4L3 18l3 3 5.3-5.3a5 5 0 0 0 6.4-6.4l-3 3-3-3 3-3z" />
      </svg>
    );
  }
  if (icon === "output") {
    return (
      <svg class="log-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M20 6L9 17l-5-5" />
      </svg>
    );
  }
  if (icon === "diff") {
    return (
      <svg class="log-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M8 7v10M16 7v10M3 12h5M16 12h5" />
      </svg>
    );
  }
  if (icon === "system") {
    return (
      <svg class="log-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M4 5h16v10H7l-3 3V5z" />
      </svg>
    );
  }
  if (icon === "error") {
    return (
      <svg class="log-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
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
  const params = useParams();
  const navigate = useNavigate();
  const [projects, { refetch }] = createResource(fetchProjects);
  const [agents] = createResource(fetchAgents);
  const [detail, { refetch: refetchDetail }] = createResource(
    () => params.id,
    async (id) => (id ? fetchProject(id) : null)
  );
  const [expanded, setExpanded] = createSignal<string[]>([]);
  const [detailStatus, setDetailStatus] = createSignal("maybe");
  const [detailDomain, setDetailDomain] = createSignal("");
  const [detailOwner, setDetailOwner] = createSignal("");
  const [detailMode, setDetailMode] = createSignal("");
  const [detailAppetite, setDetailAppetite] = createSignal("");
  const [detailRunAgent, setDetailRunAgent] = createSignal("");
  const [detailRunMode, setDetailRunMode] = createSignal("main-run");
  const [detailRepo, setDetailRepo] = createSignal("");
  const [detailSessionKeys, setDetailSessionKeys] = createSignal<Record<string, string>>({});
  const [detailSlug, setDetailSlug] = createSignal("");
  const [detailBranch, setDetailBranch] = createSignal("main");
  const [branches, setBranches] = createSignal<string[]>([]);
  const [branchesError, setBranchesError] = createSignal<string | null>(null);
  const [mainTab, setMainTab] = createSignal<"logs" | "diffs">("logs");
  const [subTab, setSubTab] = createSignal<"logs" | "diffs">("logs");
  const [mainInput, setMainInput] = createSignal("");
  const [customStartEnabled, setCustomStartEnabled] = createSignal(false);
  const [customStartPrompt, setCustomStartPrompt] = createSignal("");
  const [subagentsExpanded, setSubagentsExpanded] = createSignal(false);
  const [mainLogs, setMainLogs] = createSignal<SubagentLogEvent[]>([]);
  const [mainCursor, setMainCursor] = createSignal(0);
  const [aihubLogs, setAihubLogs] = createSignal<LogItem[]>([]);
  const [aihubLive, setAihubLive] = createSignal("");
  const [aihubStreaming, setAihubStreaming] = createSignal(false);
  const [aihubLocalNotes, setAihubLocalNotes] = createSignal<LogItem[]>([]);
  const [pendingAihubUserMessages, setPendingAihubUserMessages] = createSignal<string[]>([]);
  const [pendingAihubHistoryRefresh, setPendingAihubHistoryRefresh] = createSignal(false);
  const [mainError, setMainError] = createSignal("");
  const [subagents, setSubagents] = createSignal<SubagentListItem[]>([]);
  const [subagentError, setSubagentError] = createSignal<string | null>(null);
  const [selectedSubagent, setSelectedSubagent] = createSignal<string | null>(null);
  const [subagentLogs, setSubagentLogs] = createSignal<SubagentLogEvent[]>([]);
  const [subagentCursor, setSubagentCursor] = createSignal(0);
  const [openMenu, setOpenMenu] = createSignal<"status" | "appetite" | "domain" | "owner" | "mode" | null>(null);

  let mainStreamCleanup: (() => void) | null = null;
  let monitoringTextareaRef: HTMLTextAreaElement | undefined;
  let mainLogPaneRef: HTMLDivElement | undefined;
  let aihubSubscriptionCleanup: (() => void) | null = null;

  const ownerOptions = createMemo(() => {
    const names = (agents() ?? []).map((agent) => agent.name);
    return ["Thinh", ...names.filter((name) => name !== "Thinh")];
  });

  const runAgentOptions = createMemo(() => {
    const aihub = (agents() ?? []).map((agent) => ({
      id: `aihub:${agent.id}`,
      label: agent.name,
    }));
    return [...aihub, ...CLI_OPTIONS];
  });

  const selectedRunAgent = createMemo(() => {
    const value = detailRunAgent();
    if (!value) return null;
    if (value.startsWith("aihub:")) return { type: "aihub" as const, id: value.slice(6) };
    if (value.startsWith("cli:")) return { type: "cli" as const, id: value.slice(4) };
    return null;
  });

  const mainSlug = createMemo(() => {
    if (selectedRunAgent()?.type !== "cli") return "";
    if (detailRunMode() === "worktree") return detailSlug().trim();
    return "main";
  });

  const mainSubagent = createMemo(() => {
    const slug = mainSlug();
    if (!slug) return null;
    return subagents().find((item) => item.slug === slug) ?? null;
  });

  const selectedSubagentError = createMemo(() => {
    const slug = selectedSubagent();
    if (!slug) return "";
    return subagents().find((item) => item.slug === slug)?.lastError ?? "";
  });

  const selectedSubagentStatus = createMemo(() => {
    const slug = selectedSubagent();
    if (!slug) return "idle";
    return subagents().find((item) => item.slug === slug)?.status ?? "idle";
  });

  const resolvedSessionKey = createMemo(() => {
    const project = detail();
    const agent = selectedRunAgent();
    if (!project || !agent || agent.type !== "aihub") return "";
    return detailSessionKeys()[agent.id] ?? `project:${project.id}:${agent.id}`;
  });

  const hasMainRun = createMemo(() => {
    const agent = selectedRunAgent();
    if (!agent) return false;
    if (agent.type === "aihub") {
      return aihubStreaming() || aihubLogs().length > 0;
    }
    return Boolean(mainSubagent());
  });

  const canStart = createMemo(() => {
    const agent = selectedRunAgent();
    if (!agent) return false;
    if (agent.type === "aihub") return true;
    if (!detailRepo()) return false;
    if (detailRunMode() === "worktree" && !detailSlug().trim()) return false;
    return true;
  });

  const mainStatus = createMemo(() => {
    const agent = selectedRunAgent();
    if (!agent) return "idle";
    if (agent.type === "aihub") {
      return aihubStreaming() ? "running" : hasMainRun() ? "idle" : "idle";
    }
    return mainSubagent()?.status ?? "idle";
  });

  const cliLogItems = createMemo(() => buildCliLogs(mainLogs()));
  const cliDiffItems = createMemo(() => buildCliLogs(mainLogs().filter((ev) => ev.type === "diff")));
  const subagentLogItems = createMemo(() => buildCliLogs(subagentLogs()));
  const subagentDiffItems = createMemo(() => buildCliLogs(subagentLogs().filter((ev) => ev.type === "diff")));

  const grouped = createMemo(() => {
    const items = projects() ?? [];
    const byStatus = new Map<string, ProjectListItem[]>();
    for (const col of COLUMNS) byStatus.set(col.id, []);
    for (const item of items) {
      const status = getStatus(item);
      if (!byStatus.has(status)) byStatus.set(status, []);
      byStatus.get(status)?.push(item);
    }
    for (const [status, list] of byStatus) {
      list.sort(sortByCreatedAsc);
    }
    return byStatus;
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
    setExpanded(withItems.slice(0, 2).length > 0 ? withItems.slice(0, 2) : COLUMNS.slice(0, 2).map((col) => col.id));
  });

  createEffect(() => {
    const current = detail();
    if (current) {
      setDetailStatus(normalizeStatus(getFrontmatterString(current.frontmatter, "status")));
      setDetailDomain(getFrontmatterString(current.frontmatter, "domain") ?? "");
      setDetailOwner(getFrontmatterString(current.frontmatter, "owner") ?? "");
      setDetailMode(normalizeMode(getFrontmatterString(current.frontmatter, "executionMode")));
      setDetailAppetite(getFrontmatterString(current.frontmatter, "appetite") ?? "");
      setDetailRunAgent(getFrontmatterString(current.frontmatter, "runAgent") ?? "");
      setDetailRunMode(getFrontmatterString(current.frontmatter, "runMode") ?? "main-run");
      setDetailRepo(getFrontmatterString(current.frontmatter, "repo") ?? "");
      setDetailSessionKeys(getFrontmatterRecord(current.frontmatter, "sessionKeys") ?? {});
      if (!detailSlug()) {
        const nextSlug = slugify(current.title);
        if (nextSlug) setDetailSlug(nextSlug);
      }
      setOpenMenu(null);
    }
  });

  createEffect(() => {
    if (!params.id) return;
    setMainLogs([]);
    setMainCursor(0);
    setAihubLogs([]);
    setAihubLive("");
    setAihubStreaming(false);
    setAihubLocalNotes([]);
    setPendingAihubUserMessages([]);
    setPendingAihubHistoryRefresh(false);
    setMainError("");
    setSubagents([]);
    setSelectedSubagent(null);
    setSubagentLogs([]);
    setSubagentCursor(0);
    setDetailSlug("");
  });

  createEffect(() => {
    if (!detail() || detailRunAgent()) return;
    const options = runAgentOptions();
    if (options.length > 0) {
      const isShaping = detailStatus() === "shaping";
      const projectManager = options.find((opt) => opt.label === "Project Manager");
      const aihub = options.find((opt) => opt.id.startsWith("aihub:"));
      const defaultOption = isShaping && projectManager ? projectManager : aihub ?? options[0];
      setDetailRunAgent(defaultOption.id);
    }
  });

  createEffect(() => {
    if (!subagentsExpanded()) {
      scrollMainLogToBottom();
    }
  });

  createEffect(() => {
    if (!params.id) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeDetail();
      }
    };
    window.addEventListener("keydown", handler);
    onCleanup(() => window.removeEventListener("keydown", handler));
  });

  onCleanup(() => {
    if (mainStreamCleanup) {
      mainStreamCleanup();
      mainStreamCleanup = null;
    }
    if (aihubSubscriptionCleanup) {
      aihubSubscriptionCleanup();
      aihubSubscriptionCleanup = null;
    }
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
    const projectId = params.id;
    const repo = detailRepo();
    if (!projectId || !repo) {
      setBranches([]);
      setBranchesError(null);
      return;
    }
    let active = true;
    const load = async () => {
      const res = await fetchProjectBranches(projectId);
      if (!active) return;
      if (res.ok) {
        setBranches(res.data.branches);
        setBranchesError(null);
        if (!res.data.branches.includes(detailBranch())) {
          setDetailBranch(res.data.branches.includes("main") ? "main" : res.data.branches[0] ?? "main");
        }
      } else {
        setBranches([]);
        setBranchesError(res.error);
      }
    };
    load();
  });

  const refreshAihubHistory = async (agentId: string, sessionKey: string) => {
    const res = await fetchFullHistory(agentId, sessionKey);
    const pending = pendingAihubUserMessages();
    const { merged, remaining } = mergePendingAihubMessages(res.messages, pending);
    if (remaining.length !== pending.length) {
      setPendingAihubUserMessages(remaining);
    }
    const notes = aihubLocalNotes();
    setAihubLogs(notes.length > 0 ? [...merged, ...notes] : merged);
    scrollMainLogToBottom();
  };

  createEffect(() => {
    const projectId = params.id;
    if (!projectId) return;
    let active = true;
    const load = async () => {
      const res = await fetchSubagents(projectId);
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
    const agent = selectedRunAgent();
    if (!project || !agent || agent.type !== "aihub") return;
    if (aihubStreaming()) return;
    const sessionKey = resolvedSessionKey();
    if (!sessionKey) return;
    const load = async () => {
      await refreshAihubHistory(agent.id, sessionKey);
    };
    load();
  });

  createEffect(() => {
    const agent = selectedRunAgent();
    const sessionKey = resolvedSessionKey();
    if (!params.id || !agent || agent.type !== "aihub" || !sessionKey) {
      if (aihubSubscriptionCleanup) {
        aihubSubscriptionCleanup();
        aihubSubscriptionCleanup = null;
      }
      return;
    }
    if (aihubSubscriptionCleanup) {
      aihubSubscriptionCleanup();
      aihubSubscriptionCleanup = null;
    }
    aihubSubscriptionCleanup = subscribeToSession(agent.id, sessionKey, {
      onText: (text) => {
        if (mainStreamCleanup) return;
        setAihubStreaming(true);
        setAihubLive((prev) => prev + text);
      },
      onToolCall: (_id, name, args) => {
        if (mainStreamCleanup) return;
        setAihubStreaming(true);
        setAihubLogs((prev) => [
          ...prev,
          { tone: "muted", icon: "tool", title: `Tool: ${name}`, body: formatJson(args), collapsible: true },
        ]);
      },
      onToolStart: () => {
        if (mainStreamCleanup) return;
        setAihubStreaming(true);
      },
      onToolEnd: () => {
        if (mainStreamCleanup) return;
        setAihubStreaming(true);
      },
      onDone: () => {
        if (mainStreamCleanup) return;
        setAihubStreaming(false);
        setAihubLive("");
        refreshAihubHistory(agent.id, sessionKey);
        setPendingAihubHistoryRefresh(false);
      },
      onHistoryUpdated: () => {
        if (aihubStreaming()) {
          setPendingAihubHistoryRefresh(true);
          return;
        }
        refreshAihubHistory(agent.id, sessionKey);
        setPendingAihubHistoryRefresh(false);
      },
      onError: (error) => {
        setMainError(error);
      },
    });
  });

  createEffect(() => {
    const agent = selectedRunAgent();
    const sessionKey = resolvedSessionKey();
    if (!agent || agent.type !== "aihub" || !sessionKey) return;
    if (aihubStreaming()) return;
    if (!pendingAihubHistoryRefresh()) return;
    refreshAihubHistory(agent.id, sessionKey);
    setPendingAihubHistoryRefresh(false);
  });

  createEffect(() => {
    const agent = selectedRunAgent();
    if (!agent || agent.type !== "cli") return;
    const err = mainSubagent()?.lastError;
    if (err) setMainError(err);
  });

  createEffect(() => {
    const projectId = params.id;
    const agent = selectedRunAgent();
    const slug = mainSlug();
    if (!projectId || !agent || agent.type !== "cli" || !slug) return;
    setMainLogs([]);
    setMainCursor(0);
    let active = true;
    let cursor = 0;
    const poll = async () => {
      const res = await fetchSubagentLogs(projectId, slug, cursor);
      if (!active) return;
      if (res.ok) {
        if (res.data.events.length > 0) {
          setMainLogs((prev) => [...prev, ...res.data.events]);
        }
        cursor = res.data.cursor;
        setMainCursor(cursor);
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
    const projectId = params.id;
    const slug = selectedSubagent();
    if (!projectId || !slug) return;
    setSubagentLogs([]);
    setSubagentCursor(0);
    let active = true;
    let cursor = 0;
    const poll = async () => {
      const res = await fetchSubagentLogs(projectId, slug, cursor);
      if (!active) return;
      if (res.ok) {
        if (res.data.events.length > 0) {
          setSubagentLogs((prev) => [...prev, ...res.data.events]);
        }
        cursor = res.data.cursor;
        setSubagentCursor(cursor);
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
    if (selectedRunAgent()?.type === "aihub" && mainTab() !== "logs") {
      setMainTab("logs");
    }
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

  const handleRunAgentChange = async (id: string, runAgent: string) => {
    setDetailRunAgent(runAgent);
    await updateProject(id, { runAgent });
    await refetchDetail();
  };

  const handleRunModeChange = async (id: string, runMode: string) => {
    setDetailRunMode(runMode);
    await updateProject(id, { runMode });
    await refetchDetail();
  };

  const handleRepoSave = async (id: string) => {
    await updateProject(id, { repo: detailRepo() });
    await refetchDetail();
  };

  const openDetail = (id: string) => {
    navigate(`/projects/${id}`);
  };

  const scrollMainLogToBottom = () => {
    if (!mainLogPaneRef) return;
    requestAnimationFrame(() => {
      if (!mainLogPaneRef) return;
      mainLogPaneRef.scrollTop = mainLogPaneRef.scrollHeight;
    });
  };

  const closeDetail = () => {
    navigate("/projects");
  };

  const startAihubRun = async (project: ProjectDetail, customPrompt: string) => {
    const agent = selectedRunAgent();
    if (!agent || agent.type !== "aihub") return;
    const sessionKeys = detailSessionKeys();
    let sessionKey = sessionKeys[agent.id] ?? `project:${project.id}:${agent.id}`;
    if (!sessionKeys[agent.id]) {
      const nextKeys = { ...sessionKeys, [agent.id]: sessionKey };
      setDetailSessionKeys(nextKeys);
      await updateProject(project.id, { sessionKeys: nextKeys, runAgent: detailRunAgent() });
      await refetchDetail();
    }
    const status = normalizeStatus(getFrontmatterString(project.frontmatter, "status"));
    const basePath = (project.absolutePath || project.path).replace(/\/$/, "");
    const readmePath = basePath.endsWith("README.md") ? basePath : `${basePath}/README.md`;
    let prompt = `/drill-specs ${readmePath}`;
    if (status !== "shaping") {
      const summary = buildProjectSummary(
        project.title,
        getFrontmatterString(project.frontmatter, "status") ?? "",
        project.path,
        project.content
      );
      const basePrompt = buildStartPrompt(summary);
      prompt = customPrompt ? `${basePrompt}\n\n${customPrompt}` : basePrompt;
    }
    setMainError("");
    setAihubLogs([]);
    setAihubLive("");
    if (mainStreamCleanup) {
      mainStreamCleanup();
      mainStreamCleanup = null;
    }
    setAihubStreaming(true);
    setPendingAihubUserMessages((prev) => [...prev, prompt]);
    setAihubLogs((prev) => [
      ...prev,
      { tone: "user", body: prompt },
    ]);
    scrollMainLogToBottom();
    mainStreamCleanup = streamMessage(
      agent.id,
      prompt,
      sessionKey,
      (text) => {
        setAihubLive((prev) => prev + text);
      },
      async (meta) => {
        if (meta?.queued) return;
        setAihubStreaming(false);
        setAihubLive("");
        await refreshAihubHistory(agent.id, sessionKey);
        mainStreamCleanup = null;
      },
      (error) => {
        setMainError(error);
        setAihubStreaming(false);
        setAihubLive("");
        mainStreamCleanup = null;
      },
      {
        onToolCall: (_id, name, args) => {
          setAihubLogs((prev) => [
            ...prev,
            {
              tone: "muted",
              icon: "tool",
              title: name ? `Tool: ${name}` : "Tool",
              body: formatJson(args),
              collapsible: true,
            },
          ]);
        },
      }
    );
  };

  const sendAihubMessage = async (project: ProjectDetail, message: string) => {
    const agent = selectedRunAgent();
    if (!agent || agent.type !== "aihub") return;
    const sessionKey = resolvedSessionKey();
    if (!sessionKey) return;
    setMainError("");
    setAihubLive("");
    if (mainStreamCleanup) {
      mainStreamCleanup();
      mainStreamCleanup = null;
    }
    setAihubStreaming(true);
    setPendingAihubUserMessages((prev) => [...prev, message]);
    setAihubLogs((prev) => [
      ...prev,
      { tone: "user", body: message },
    ]);
    scrollMainLogToBottom();
    mainStreamCleanup = streamMessage(
      agent.id,
      message,
      sessionKey,
      (text) => {
        setAihubLive((prev) => prev + text);
      },
      async (meta) => {
        if (meta?.queued) return;
        setAihubStreaming(false);
        setAihubLive("");
        await refreshAihubHistory(agent.id, sessionKey);
        mainStreamCleanup = null;
      },
      (error) => {
        setMainError(error);
        setAihubStreaming(false);
        setAihubLive("");
        mainStreamCleanup = null;
      }
    );
  };

  const runCli = async (project: ProjectDetail, message: string, resume: boolean) => {
    const agent = selectedRunAgent();
    if (!agent || agent.type !== "cli") return;
    const slug = mainSlug();
    if (!slug) {
      setMainError("Slug required");
      return;
    }
    setMainError("");
    const res = await spawnSubagent(project.id, {
      slug,
      cli: agent.id,
      prompt: message,
      mode: detailRunMode() === "worktree" ? "worktree" : "main-run",
      baseBranch: detailBranch(),
      resume,
    });
    if (!res.ok) {
      setMainError(res.error);
    }
  };

  const handleStart = async (project: ProjectDetail) => {
    const agent = selectedRunAgent();
    if (!agent) return;
    const custom = customStartEnabled() ? customStartPrompt().trim() : "";
    if (agent.type === "aihub") {
      await startAihubRun(project, custom);
      return;
    }
    if (detailRunAgent()) {
      await updateProject(project.id, { runAgent: detailRunAgent(), runMode: detailRunMode() });
    }
    const status = normalizeStatus(getFrontmatterString(project.frontmatter, "status"));
    if (status === "shaping") {
      const basePath = project.path.replace(/\/$/, "");
      const readmePath = basePath.endsWith("README.md") ? basePath : `${basePath}/README.md`;
      await runCli(project, `/drill-specs ${readmePath}`, false);
      return;
    }
    const summary = buildProjectSummary(
      project.title,
      getFrontmatterString(project.frontmatter, "status") ?? "",
      project.path,
      project.content
    );
    const basePrompt = buildStartPrompt(summary);
    const prompt = custom ? `${basePrompt}\n\n${custom}` : basePrompt;
    await runCli(project, prompt, false);
  };

  const handleNew = async (project: ProjectDetail) => {
    const agent = selectedRunAgent();
    if (!agent || agent.type !== "aihub") return;
    if (mainStreamCleanup) {
      mainStreamCleanup();
      mainStreamCleanup = null;
    }
    const nextKey = `project:${project.id}:${agent.id}:${Date.now()}`;
    const nextKeys = { ...detailSessionKeys(), [agent.id]: nextKey };
    setDetailSessionKeys(nextKeys);
    setAihubLogs([]);
    setAihubLive("");
    setAihubStreaming(false);
    setAihubLocalNotes([]);
    setPendingAihubUserMessages([]);
    setPendingAihubHistoryRefresh(false);
    setMainError("");
    setMainInput("");
    await updateProject(project.id, { sessionKeys: nextKeys, runAgent: detailRunAgent() });
    await refetchDetail();
  };

  const handleSend = async (project: ProjectDetail) => {
    const message = mainInput().trim();
    if (!message) return;
    setMainInput("");
    resizeTextarea(monitoringTextareaRef);
    const agent = selectedRunAgent();
    if (!agent) return;
    if (agent.type === "aihub") {
      await sendAihubMessage(project, message);
      return;
    }
    await runCli(project, message, true);
  };

  const handleStop = async (project: ProjectDetail) => {
    const agent = selectedRunAgent();
    if (!agent) return;
    if (agent.type === "cli") {
      const slug = mainSlug();
      if (!slug) return;
      setMainLogs((prev) => [
        ...prev,
        { type: "message", text: "Stop requested." },
      ]);
      await interruptSubagent(project.id, slug);
      return;
    }
    const sessionKey = resolvedSessionKey();
    if (!sessionKey) return;
    const note: LogItem = { tone: "muted", icon: "system", title: "System", body: "Stop requested." };
    setAihubLocalNotes((prev) => [...prev, note]);
    setAihubLogs((prev) => [...prev, note]);
    streamMessage(
      agent.id,
      "/abort",
      sessionKey,
      () => {},
      () => {},
      () => {}
    );
  };

  return (
    <div class="projects-page">
      <header class="projects-header">
        <A href="/" class="back-btn" aria-label="Go back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </A>
        <div class="header-title">
          <h1>Projects</h1>
          <span class="header-subtitle">Kanban</span>
        </div>
      </header>

      <Show when={projects.loading}>
        <div class="projects-loading">Loading projects...</div>
      </Show>
      <Show when={projects.error}>
        <div class="projects-error">Failed to load projects</div>
      </Show>

      <div class="board">
        <For each={COLUMNS}>
          {(column) => {
            const items = () => grouped().get(column.id) ?? [];
            const isExpanded = () => expanded().includes(column.id);
            return (
              <section
                class={`column ${isExpanded() ? "expanded" : "collapsed"}`}
                style={{ "--col": column.color }}
              >
                <button class="column-header" onClick={() => toggleColumn(column.id)}>
                  <div class="column-title">{column.title}</div>
                  <div class="column-count">{items().length}</div>
                </button>
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
                        const mode = getFrontmatterString(fm, "executionMode");
                        const appetite = getFrontmatterString(fm, "appetite");
                        const created = getFrontmatterString(fm, "created");
                        return (
                          <button class="card" onClick={() => openDetail(item.id)}>
                            <div class="card-id">{item.id}</div>
                            <div class="card-title">{item.title}</div>
                            <div class="card-meta">
                              <Show when={owner}><span>{owner}</span></Show>
                              <Show when={domain}><span>{domain}</span></Show>
                              <Show when={mode}><span>{mode}</span></Show>
                              <Show when={appetite}><span>{appetite}</span></Show>
                            </div>
                            <div class="card-footer">
                              <span>{created ? formatCreatedRelative(created) : ""}</span>
                            </div>
                          </button>
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

      <Show when={params.id}>
        <div class="overlay" role="dialog" aria-modal="true">
          <div class="overlay-backdrop" onClick={closeDetail} />
          <div class="overlay-panel">
            <button class="overlay-close" onClick={closeDetail} aria-label="Close">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 6L6 18" />
                <path d="M6 6l12 12" />
              </svg>
            </button>
            <div class="overlay-header">
              <Show when={detail()}>
                {(data) => {
                  const project = data() as ProjectDetail;
                  const [copied, setCopied] = createSignal(false);
                  return (
                    <>
                      <div class="title-block">
                        <span
                          class="id-pill"
                          classList={{ copied: copied() }}
                          onClick={() => {
                            navigator.clipboard.writeText(project.absolutePath);
                            setCopied(true);
                            setTimeout(() => setCopied(false), 600);
                          }}
                          title="Click to copy project path"
                        >
                          {project.id}
                        </span>
                        <h2>{project.title}</h2>
                      </div>
                    </>
                  );
                }}
              </Show>
              <Show when={detail.loading}>
                <h2>Loading...</h2>
              </Show>
            </div>
            <div class="overlay-content">
              <div class="detail">
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
                        <div class="detail-meta">
                          <div class="meta-field">
                            <button
                              class="meta-button"
                              onClick={() => setOpenMenu(openMenu() === "status" ? null : "status")}
                            >
                              <svg class="meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M5 12l4 4L19 6" />
                              </svg>
                              {detailStatus() ? getStatusLabel(detailStatus()) : "status"}
                            </button>
                            <Show when={openMenu() === "status"}>
                              <div class="meta-menu">
                                <For each={COLUMNS}>
                                  {(col) => (
                                    <button class="meta-item" onClick={() => handleStatusChange(project.id, col.id)}>
                                      {col.title}
                                    </button>
                                  )}
                                </For>
                              </div>
                            </Show>
                          </div>
                          <span class="meta-chip">
                            <svg class="meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                              <circle cx="12" cy="12" r="9" />
                              <path d="M12 7v5l3 3" />
                            </svg>
                            {formatCreatedRelative(getFrontmatterString(fm, "created"))}
                          </span>
                          <div class="meta-field">
                            <button
                              class="meta-button"
                              onClick={() => setOpenMenu(openMenu() === "appetite" ? null : "appetite")}
                            >
                              <svg class="meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M12 3v18" />
                                <path d="M7 8h10" />
                                <path d="M6 13h12" />
                                <path d="M5 18h14" />
                              </svg>
                              {detailAppetite() || "appetite"}
                            </button>
                            <Show when={openMenu() === "appetite"}>
                              <div class="meta-menu">
                                <button class="meta-item" onClick={() => handleAppetiteChange(project.id, "")}>unset</button>
                                <button class="meta-item" onClick={() => handleAppetiteChange(project.id, "small")}>small</button>
                                <button class="meta-item" onClick={() => handleAppetiteChange(project.id, "big")}>big</button>
                              </div>
                            </Show>
                          </div>
                          <div class="meta-field">
                            <button
                              class="meta-button"
                              onClick={() => setOpenMenu(openMenu() === "domain" ? null : "domain")}
                            >
                              <svg class="meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M20 7H10l-6 5 6 5h10l-4-5z" />
                              </svg>
                              {detailDomain() || "domain"}
                            </button>
                            <Show when={openMenu() === "domain"}>
                              <div class="meta-menu">
                                <button class="meta-item" onClick={() => handleDomainChange(project.id, "")}>unset</button>
                                <button class="meta-item" onClick={() => handleDomainChange(project.id, "life")}>life</button>
                                <button class="meta-item" onClick={() => handleDomainChange(project.id, "admin")}>admin</button>
                                <button class="meta-item" onClick={() => handleDomainChange(project.id, "coding")}>coding</button>
                              </div>
                            </Show>
                          </div>
                        </div>
                        <div class="detail-body" innerHTML={renderMarkdown(project.content)} />
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
                      onClick={() => setOpenMenu(openMenu() === "owner" ? null : "owner")}
                    >
                      <svg class="meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="8" r="4" />
                        <path d="M4 20c2.5-4 13.5-4 16 0" />
                      </svg>
                      {detailOwner() || "owner"}
                    </button>
                    <Show when={openMenu() === "owner"}>
                      <div class="meta-menu">
                        <button class="meta-item" onClick={() => handleOwnerChange(params.id ?? "", "")}>unset</button>
                        <For each={ownerOptions()}>
                          {(owner) => (
                            <button class="meta-item" onClick={() => handleOwnerChange(params.id ?? "", owner)}>
                              {owner}
                            </button>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                  <Show when={detailStatus() !== "shaping"}>
                    <div class="meta-field">
                      <button
                        class="meta-button"
                        onClick={() => setOpenMenu(openMenu() === "mode" ? null : "mode")}
                      >
                        <svg class="meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <path d="M4 6h16M8 6v12M16 12v6" />
                        </svg>
                        {detailMode() ? detailMode().replace(/_/g, " ") : "execution mode"}
                      </button>
                      <Show when={openMenu() === "mode"}>
                        <div class="meta-menu">
                          <button class="meta-item" onClick={() => handleModeChange(params.id ?? "", "")}>unset</button>
                          <button class="meta-item" onClick={() => handleModeChange(params.id ?? "", "manual")}>manual</button>
                          <button class="meta-item" onClick={() => handleModeChange(params.id ?? "", "exploratory")}>exploratory</button>
                          <button class="meta-item" onClick={() => handleModeChange(params.id ?? "", "auto")}>auto</button>
                          <button class="meta-item" onClick={() => handleModeChange(params.id ?? "", "full_auto")}>full auto</button>
                        </div>
                      </Show>
                    </div>
                  </Show>
                  <div class="meta-field">
                    <label class="meta-label">Agent</label>
                    <select
                      class="meta-select"
                      value={detailRunAgent()}
                      onChange={(e) => handleRunAgentChange(params.id ?? "", e.currentTarget.value)}
                    >
                      <For each={runAgentOptions()}>
                        {(opt) => (
                          <option value={opt.id}>{opt.label}</option>
                        )}
                      </For>
                    </select>
                  </div>
                  <Show when={selectedRunAgent()?.type === "cli"}>
                    <div class="meta-field">
                      <label class="meta-label">Run mode</label>
                      <select
                        class="meta-select"
                        value={detailRunMode()}
                        onChange={(e) => handleRunModeChange(params.id ?? "", e.currentTarget.value)}
                      >
                        <option value="main-run">main-run</option>
                        <option value="worktree">worktree</option>
                      </select>
                    </div>
                  </Show>
                  <Show when={detailDomain() === "coding" && selectedRunAgent()?.type === "cli"}>
                    <div class="meta-field meta-field-wide">
                      <label class="meta-label">Repo</label>
                      <input
                        class="meta-input"
                        value={detailRepo()}
                        onInput={(e) => setDetailRepo(e.currentTarget.value)}
                        onBlur={() => handleRepoSave(params.id ?? "")}
                        placeholder="/abs/path/to/repo"
                      />
                    </div>
                  </Show>
                  <Show when={selectedRunAgent()?.type === "cli"}>
                    <div class="meta-field">
                      <label class="meta-label">Base branch</label>
                      <select
                        class="meta-select"
                        value={detailBranch()}
                        onChange={(e) => setDetailBranch(e.currentTarget.value)}
                        disabled={branches().length === 0}
                      >
                        <For each={branches().length > 0 ? branches() : ["main"]}>
                          {(branch) => <option value={branch}>{branch}</option>}
                        </For>
                      </select>
                    </div>
                  </Show>
                  <Show when={selectedRunAgent()?.type === "cli" && detailRunMode() === "worktree"}>
                    <div class="meta-field">
                      <label class="meta-label">Slug</label>
                      <input
                        class="meta-input"
                        value={detailSlug()}
                        onInput={(e) => setDetailSlug(e.currentTarget.value)}
                        placeholder="short-slug"
                      />
                    </div>
                  </Show>
                </div>
                <div
                  class={`monitoring-columns ${
                    detailDomain() === "coding"
                      ? subagentsExpanded()
                        ? "subagents-only"
                        : "split"
                      : "main-only"
                  }`}
                >
                  <Show when={detailDomain() === "coding" && subagentsExpanded()}>
                    <button
                      class="main-toggle-rail"
                      onClick={() => setSubagentsExpanded(false)}
                      aria-label="Show main agent"
                    >
                      <span>Main</span>
                    </button>
                  </Show>
                  <Show when={detailDomain() !== "coding" || !subagentsExpanded()}>
                    <div class="monitoring-main">
                    <div class="monitoring-header-row">
                      <div class={`status-pill ${mainStatus()}`}>
                        <span class="status-dot" />
                        <span class="status-text">{mainStatus()}</span>
                      </div>
                      <Show when={detailDomain() === "coding"}>
                        <button
                          class="collapse-btn"
                          onClick={() => setSubagentsExpanded(true)}
                          disabled={subagentsExpanded()}
                          aria-label="Expand subagents panel"
                        >
                          Subagents
                        </button>
                      </Show>
                      <label class="start-custom-toggle">
                        <input
                          type="checkbox"
                          checked={customStartEnabled()}
                          onChange={(e) => setCustomStartEnabled(e.currentTarget.checked)}
                        />
                        <span>custom prompt</span>
                      </label>
                      <div class="monitoring-actions">
                        <Show when={!hasMainRun()}>
                          <button
                            class="start-btn"
                            onClick={() => {
                              const current = detail() as ProjectDetail | null;
                              if (current) handleStart(current);
                            }}
                            disabled={!canStart()}
                          >
                            Start
                          </button>
                        </Show>
                        <Show when={hasMainRun() && selectedRunAgent()?.type === "aihub"}>
                          <button
                            class="start-btn"
                            onClick={() => {
                              const current = detail() as ProjectDetail | null;
                              if (current) handleNew(current);
                            }}
                            disabled={mainStatus() === "running"}
                          >
                            New
                          </button>
                        </Show>
                        <Show when={hasMainRun()}>
                          <button
                            class="stop-btn"
                            onClick={() => {
                              const current = detail() as ProjectDetail | null;
                              if (current) handleStop(current);
                            }}
                            disabled={mainStatus() !== "running"}
                          >
                            Stop
                          </button>
                        </Show>
                      </div>
                    </div>
                    <Show when={branchesError()}>
                      <div class="monitoring-error">{branchesError()}</div>
                    </Show>
                    <Show when={!hasMainRun()}>
                      <div class="monitoring-empty">
                        <p>Start a run to see logs.</p>
                      </div>
                    </Show>
                    <Show when={customStartEnabled()}>
                      <textarea
                        class="custom-start-textarea"
                        rows={2}
                        value={customStartPrompt()}
                        placeholder="Add a one-off custom prompt..."
                        onInput={(e) => setCustomStartPrompt(e.currentTarget.value)}
                      />
                    </Show>
                    <Show when={hasMainRun()}>
                      <div class="monitoring-tabs">
                        <button
                          class={`tab-btn ${mainTab() === "logs" ? "active" : ""}`}
                          onClick={() => setMainTab("logs")}
                        >
                          Logs
                        </button>
                        <Show when={selectedRunAgent()?.type === "cli"}>
                          <button
                            class={`tab-btn ${mainTab() === "diffs" ? "active" : ""}`}
                            onClick={() => setMainTab("diffs")}
                          >
                            Diffs
                          </button>
                        </Show>
                      </div>
                      <div class="log-pane" ref={mainLogPaneRef}>
                        <Show when={selectedRunAgent()?.type === "aihub"}>
                          <For each={aihubLogs()}>
                            {(entry) => renderLogItem(entry)}
                          </For>
                          <Show when={aihubLive()}>
                            <div class="log-line assistant live">
                              <div class="log-stack">
                                <pre class="log-text">{aihubLive()}</pre>
                              </div>
                            </div>
                          </Show>
                        </Show>
                        <Show when={selectedRunAgent()?.type === "cli"}>
                          <For each={mainTab() === "diffs" ? cliDiffItems() : cliLogItems()}>
                            {(entry) => renderLogItem(entry)}
                          </For>
                        </Show>
                        <Show when={selectedRunAgent()?.type === "cli" && mainLogs().length === 0}>
                          <div class="log-empty">No logs yet.</div>
                        </Show>
                        <Show when={selectedRunAgent()?.type === "aihub" && aihubLogs().length === 0 && !aihubLive()}>
                          <div class="log-empty">No logs yet.</div>
                        </Show>
                      </div>
                      <div class="monitoring-input">
                      <textarea
                        ref={monitoringTextareaRef}
                        class="monitoring-textarea"
                        rows={1}
                        value={mainInput()}
                        placeholder="Send a follow-up..."
                        onInput={(e) => {
                          setMainInput(e.currentTarget.value);
                          resizeTextarea(monitoringTextareaRef);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            const current = detail() as ProjectDetail | null;
                            if (current) handleSend(current);
                          }
                        }}
                      />
                        <button
                          class="monitoring-send"
                          onClick={() => {
                            const current = detail() as ProjectDetail | null;
                            if (current) handleSend(current);
                          }}
                          disabled={!mainInput().trim()}
                        >
                          Send
                        </button>
                      </div>
                      <Show when={mainError()}>
                        <div class="monitoring-error">{mainError()}</div>
                      </Show>
                    </Show>
                  </div>
                  </Show>
                  <Show when={detailDomain() === "coding"}>
                    <div class={`subagents-panel ${subagentsExpanded() ? "expanded" : "collapsed"}`}>
                      <button
                        class="subagents-toggle"
                        onClick={() => setSubagentsExpanded((prev) => !prev)}
                      >
                        <span>Subagents</span>
                        <span class="subagents-count">{subagents().length}</span>
                      </button>
                      <Show when={subagentsExpanded()}>
                        <div class="subagents-body">
                          <Show when={subagentError()}>
                            <div class="monitoring-error">{subagentError()}</div>
                          </Show>
                          <div class="subagents-list">
                            <For each={subagents().filter((item) => item.slug !== mainSlug())}>
                              {(item) => (
                                <button
                                  class={`subagent-row ${selectedSubagent() === item.slug ? "active" : ""}`}
                                  onClick={() => setSelectedSubagent(item.slug)}
                                >
                                  <div class="subagent-title">{item.slug}</div>
                                  <div class="subagent-meta">
                                    <span>{item.cli ?? "cli"}</span>
                                    <span class={`subagent-status ${item.status}`}>{item.status}</span>
                                    <span>{item.lastActive ? formatTimestamp(item.lastActive) : ""}</span>
                                  </div>
                                </button>
                              )}
                            </For>
                          <Show when={subagents().filter((item) => item.slug !== mainSlug()).length === 0}>
                            <div class="log-empty">No subagents yet.</div>
                          </Show>
                        </div>
                          <Show when={selectedSubagentError()}>
                            <div class="monitoring-error">{selectedSubagentError()}</div>
                          </Show>
                          <Show when={selectedSubagent()}>
                            <div class="subagent-logs">
                              <div class="monitoring-tabs">
                                <button
                                  class={`tab-btn ${subTab() === "logs" ? "active" : ""}`}
                                  onClick={() => setSubTab("logs")}
                                >
                                  Logs
                                </button>
                                <button
                                  class={`tab-btn ${subTab() === "diffs" ? "active" : ""}`}
                                  onClick={() => setSubTab("diffs")}
                                >
                                  Diffs
                                </button>
                              </div>
                              <div class="log-pane">
                                <For each={subTab() === "diffs" ? subagentDiffItems() : subagentLogItems()}>
                                  {(entry) => renderLogItem(entry)}
                                </For>
                                <Show when={subagentLogs().length === 0}>
                                  <div class="log-empty">No logs yet.</div>
                                </Show>
                              </div>
                              <button
                                class="stop-btn subagent-stop"
                                onClick={() => {
                                  const current = detail() as ProjectDetail | null;
                                  if (current && selectedSubagent()) {
                                    setSubagentLogs((prev) => [
                                      ...prev,
                                      { type: "message", text: "Stop requested." },
                                    ]);
                                    interruptSubagent(current.id, selectedSubagent()!);
                                  }
                                }}
                                disabled={selectedSubagentStatus() !== "running"}
                              >
                                Stop
                              </button>
                            </div>
                          </Show>
                        </div>
                      </Show>
                    </div>
                  </Show>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Show>

      <style>{`
        .projects-page {
          width: 100vw;
          margin-left: calc(50% - 50vw);
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

        .back-btn {
          width: 40px;
          height: 40px;
          border-radius: 12px;
          background: #131821;
          border: 1px solid #232a35;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: #b8c0cc;
        }

        .header-title h1 {
          font-size: 20px;
          font-weight: 700;
          letter-spacing: 0.02em;
        }

        .header-subtitle {
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.2em;
          color: #7f8a9a;
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

        .column-header {
          border: none;
          background: transparent;
          color: inherit;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 16px;
          cursor: pointer;
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
        }

        .overlay-backdrop {
          position: absolute;
          inset: 0;
          background: rgba(0, 0, 0, 0.5);
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
        }

        .overlay-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .title-block {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
        }

        .overlay-header h2 {
          font-size: 20px;
          font-weight: 700;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
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
          overflow: hidden;
          display: flex;
          flex-direction: column;
          gap: 12px;
          min-height: 0;
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

        .detail-body {
          flex: 1;
          overflow: auto;
          background: transparent;
          border: none;
          padding: 0;
          color: #d4dbe5;
          font-size: 14px;
          line-height: 1.5;
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
        }

        .subagent-stop {
          align-self: flex-end;
        }

        @media (max-width: 900px) {
          .overlay-panel {
            height: 92vh;
            padding: 16px;
          }

          .overlay-content {
            grid-template-columns: 1fr;
            grid-template-rows: minmax(0, 1fr) minmax(0, 0.6fr);
          }

          .board {
            padding: 12px;
          }
        }
      `}</style>
    </div>
  );
}
