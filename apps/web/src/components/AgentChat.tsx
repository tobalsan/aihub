import {
  For,
  Show,
  batch,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { marked } from "marked";
import DOMPurify from "dompurify";
import {
  archiveSubagent,
  fetchFullHistory,
  fetchSubagents,
  fetchSubagentLogs,
  getSessionKey,
  interruptSubagent,
  killSubagent,
  spawnSubagent,
  streamMessage,
  subscribeToSession,
  uploadFiles,
} from "../api/client";
import type {
  ContentBlock,
  FullHistoryMessage,
  FullToolResultMessage,
  SubagentLogEvent,
  SubagentStatus,
  FileAttachment,
} from "../api/types";

type AgentChatProps = {
  agentId: string | null;
  agentName: string | null;
  agentType: "lead" | "subagent" | null;
  subagentInfo?: {
    projectId: string;
    slug: string;
    cli?: string;
    runMode?: "main-run" | "worktree" | "clone" | "none";
    status?: SubagentStatus;
  };
  onBack: () => void;
  onOpenProject?: (id: string) => void;
  fullscreen?: boolean;
  showHeader?: boolean;
  inputDraft?: string;
  onInputDraftChange?: (value: string) => void;
};

type SubagentRunInfo = {
  toolUseId: string;
  nestedItems: LogItem[];
};

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
    | "error"
    | "subagent";
  title?: string;
  summaryPreview?: string;
  body: string;
  collapsible?: boolean;
  systemCallout?: boolean;
  subagentRun?: SubagentRunInfo;
};

// Local UI state for file attachments (before upload)
type PendingFile = {
  id: string;
  file: File;
  name: string;
};

type SubagentTransientUiState = {
  awaiting: boolean;
  pending: string[];
};
const subagentTransientState = new Map<string, SubagentTransientUiState>();
const activeSubagentPollIntervals = new Map<string, number>();

export function __resetAgentChatStateForTests(): void {
  subagentTransientState.clear();
  if (typeof window !== "undefined") {
    for (const timer of activeSubagentPollIntervals.values()) {
      window.clearInterval(timer);
    }
  }
  activeSubagentPollIntervals.clear();
}

function subagentStateKey(
  info: { projectId: string; slug: string } | undefined
): string | null {
  if (!info?.projectId || !info?.slug) return null;
  return `${info.projectId}:${info.slug}`;
}

const supportedImageTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/jpg",
]);
const supportedImageExtensions = new Set(["jpg", "jpeg", "png", "gif", "webp"]);
const DEFAULT_MODEL_CONTEXT_LIMIT = 200_000;
const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  default: DEFAULT_MODEL_CONTEXT_LIMIT,
  opus: 200_000,
  sonnet: 200_000,
  haiku: 200_000,
  "gpt-5.3-codex": 200_000,
  "gpt-5.3-codex-spark": 200_000,
  "gpt-5.2": 128_000,
};

function formatJson(args: unknown): string {
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

function renderMarkdown(content: string): string {
  const html = marked.parse(content, { breaks: true, async: false }) as string;
  return DOMPurify.sanitize(html);
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

function parseJsonRecord(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const KNOWN_SYSTEM_EVENT_TYPES = new Set([
  "rate_limit_event",
  "system",
  "init",
  "config",
  "ping",
  "pong",
]);

function isSystemEventPayload(payload: Record<string, unknown>): boolean {
  if (
    typeof payload.type === "string" &&
    KNOWN_SYSTEM_EVENT_TYPES.has(payload.type)
  )
    return true;
  if (typeof payload.session_id === "string" && typeof payload.uuid === "string")
    return true;
  if (payload.rate_limit_info && typeof payload.rate_limit_info === "object")
    return true;
  return false;
}

function toSystemCalloutItem(text: string): LogItem {
  const payload = parseJsonRecord(text);
  const eventType =
    payload && typeof payload.type === "string" ? payload.type : "";
  return {
    tone: "muted",
    icon: "system",
    title: eventType ? `System: ${eventType}` : "System event",
    body: text,
    collapsible: true,
    systemCallout: true,
  };
}

function isBase64ImageText(text: string): boolean {
  return /data:image\/[^;]+;base64,/i.test(text.trim());
}

function toImageAttachmentItem(text: string): LogItem {
  const preview = `${text.slice(0, 80)}...`;
  return {
    tone: "muted",
    icon: "system",
    title: "Image attachment",
    body: preview,
    collapsible: true,
  };
}

function summarizeInitialPrompt(text: string): string {
  const firstLines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 3)
    .join(" ");
  const compact = firstLines || text.replace(/\s+/g, " ").trim();
  if (!compact) return "Details";
  return compact.length > 200 ? `${compact.slice(0, 200)}...` : compact;
}

function buildAihubLogs(messages: FullHistoryMessage[]): LogItem[] {
  const entries: LogItem[] = [];
  let initialPromptAdded = false;
  let skipNextUserIfSkill = false;
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
      if (!text) continue;
      if (skipNextUserIfSkill) {
        skipNextUserIfSkill = false;
        continue;
      }
      skipNextUserIfSkill = false;
      const parsed = parseJsonRecord(text);
      if (parsed && isSystemEventPayload(parsed)) {
        entries.push(toSystemCalloutItem(text));
        continue;
      }
      if (isBase64ImageText(text)) {
        entries.push(toImageAttachmentItem(text));
        continue;
      }
      if (!initialPromptAdded) {
        entries.push({
          tone: "user",
          summaryPreview: summarizeInitialPrompt(text),
          body: text,
          collapsible: true,
        });
        initialPromptAdded = true;
        continue;
      }
      entries.push({ tone: "user", body: text });
      continue;
    }
    if (msg.role === "assistant") {
      for (const block of msg.content) {
        if (block.type === "text" && block.text) {
          const text = extractBlockText(block.text);
          if (!text) continue;
          const parsed = parseJsonRecord(text);
          if (parsed && isSystemEventPayload(parsed)) {
            entries.push(toSystemCalloutItem(text));
          } else {
            entries.push({ tone: "assistant", body: text });
          }
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
          if (toolKey === "skill") {
            const output = toolResults.get(block.id);
            const body = output ? getTextBlocks(output.content) : "";
            entries.push({
              tone: "muted",
              icon: "tool",
              title: "Skill",
              body: body || formatJson(block.arguments),
              collapsible: true,
            });
            if (output) skipResults.add(block.id);
            skipNextUserIfSkill = true;
            continue;
          }
          if (toolKey === "agent") {
            const prompt = typeof args?.prompt === "string" ? args.prompt : "";
            const description =
              typeof args?.description === "string" ? args.description : "";
            const subagentType =
              typeof args?.subagent_type === "string" ? args.subagent_type : "";
            const agentOutput = toolResults.get(block.id);
            const summary = agentOutput
              ? getTextBlocks(agentOutput.content)
              : "";
            const nestedItems: LogItem[] = [];
            if (prompt) {
              nestedItems.push({
                tone: "user",
                title: "Coordinator \u2192 Subagent",
                body: prompt,
              });
            }
            if (summary) {
              nestedItems.push({
                tone: "assistant",
                title: "Subagent summary returned",
                body: summary,
              });
            }
            entries.push({
              tone: "muted",
              icon: "subagent",
              title: `Subagent Run${subagentType ? ` (${subagentType})` : ""}`,
              body:
                description || (prompt ? prompt.slice(0, 200) : "Subagent run"),
              subagentRun: { toolUseId: block.id, nestedItems },
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

function logLabel(type: string, text: string): string {
  if (type === "tool_call") {
    const name = text.split("\n")[0]?.trim();
    return name ? `Tool: ${name}` : "Tool call";
  }
  if (type === "tool_output") return "Tool output";
  if (type === "diff") return "Diff";
  if (type === "stderr") return "Error";
  if (type === "session") return "Session";
  if (type === "message") return "Message";
  return "";
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

function relabelAsSubagent(items: LogItem[]): LogItem[] {
  return items.map((item) => {
    if (item.subagentRun) return item;
    if (item.tone === "assistant") return { ...item, title: "Subagent" };
    if (item.icon === "tool")
      return {
        ...item,
        title:
          item.title?.replace(/^Tool:/, "Subagent Tool:") ?? "Subagent Tool",
      };
    if (item.icon === "output") return { ...item, title: "Subagent Result" };
    return item;
  });
}

function buildCliLogs(events: SubagentLogEvent[]): LogItem[] {
  // Phase 1: group nested events by parentToolUseId
  const nestedByParent = new Map<string, SubagentLogEvent[]>();
  for (const event of events) {
    if (event.parentToolUseId) {
      const group = nestedByParent.get(event.parentToolUseId) ?? [];
      group.push(event);
      nestedByParent.set(event.parentToolUseId, group);
    }
  }

  // Phase 2: build log items, filtering out nested events
  const entries: LogItem[] = [];
  let initialPromptAdded = false;
  let skipNextUserIfSkill = false;
  const toolOutputs = new Map<string, SubagentLogEvent>();
  for (const event of events) {
    if (
      event.type === "tool_output" &&
      event.tool?.id &&
      !event.parentToolUseId
    ) {
      toolOutputs.set(event.tool.id, event);
    }
  }
  const skipOutputs = new Set<string>();

  for (const event of events) {
    if (event.parentToolUseId) continue;
    if (event.type === "skip") continue;
    if (event.type === "session" || event.type === "message") continue;
    if (event.type === "user") {
      if (event.text) {
        if (skipNextUserIfSkill) {
          skipNextUserIfSkill = false;
          continue;
        }
        skipNextUserIfSkill = false;
        const parsed = parseJsonRecord(event.text);
        if (parsed && isSystemEventPayload(parsed)) {
          entries.push(toSystemCalloutItem(event.text));
          continue;
        }
        if (isBase64ImageText(event.text)) {
          entries.push(toImageAttachmentItem(event.text));
          continue;
        }
        if (!initialPromptAdded) {
          entries.push({
            tone: "user",
            summaryPreview: summarizeInitialPrompt(event.text),
            body: event.text,
            collapsible: true,
          });
          initialPromptAdded = true;
          continue;
        }
        const last = entries[entries.length - 1];
        if (!last || last.tone !== "user" || last.body !== event.text) {
          entries.push({ tone: "user", body: event.text });
        }
      }
      continue;
    }
    if (event.type === "assistant") {
      if (event.text) {
        const parsed = parseJsonRecord(event.text);
        if (parsed && isSystemEventPayload(parsed)) {
          entries.push(toSystemCalloutItem(event.text));
          continue;
        }
        const last = entries[entries.length - 1];
        if (!last || last.tone !== "assistant" || last.body !== event.text) {
          entries.push({ tone: "assistant", body: event.text });
        }
      }
      continue;
    }
    if (event.type === "tool_call") {
      const toolId = event.tool?.id ?? "";
      const toolName = (event.tool?.name ?? "").trim();
      const toolKey = toolName.toLowerCase();
      const args = parseToolArgs(event.text ?? "");

      // Agent tool call → Subagent Run card
      if (toolKey === "agent" && toolId) {
        const prompt = typeof args?.prompt === "string" ? args.prompt : "";
        const description =
          typeof args?.description === "string" ? args.description : "";
        const subagentType =
          typeof args?.subagent_type === "string" ? args.subagent_type : "";
        const output = toolOutputs.get(toolId);
        const summary = output?.text ?? "";
        const nested = nestedByParent.get(toolId) ?? [];
        const nestedLogItems =
          nested.length > 0 ? relabelAsSubagent(buildCliLogs(nested)) : [];

        const allNested: LogItem[] = [];
        if (prompt) {
          allNested.push({
            tone: "user",
            title: "Coordinator \u2192 Subagent",
            body: prompt,
          });
        }
        allNested.push(...nestedLogItems);
        if (summary) {
          allNested.push({
            tone: "assistant",
            title: "Subagent summary returned",
            body: summary,
          });
        }
        entries.push({
          tone: "muted",
          icon: "subagent",
          title: `Subagent Run${subagentType ? ` (${subagentType})` : ""}`,
          body: description || (prompt ? prompt.slice(0, 200) : "Subagent run"),
          subagentRun: { toolUseId: toolId, nestedItems: allNested },
        });
        if (toolId) skipOutputs.add(toolId);
        continue;
      }

      const output = toolId ? toolOutputs.get(toolId) : undefined;
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
      if (toolKey === "skill") {
        entries.push({
          tone: "muted",
          icon: "tool",
          title: "Skill",
          body: output?.text ?? event.text ?? "",
          collapsible: true,
        });
        if (toolId) skipOutputs.add(toolId);
        skipNextUserIfSkill = true;
        continue;
      }
      entries.push({
        tone: "muted",
        icon: "tool",
        title: toolName ? `Tool: ${toolName}` : "Tool",
        body: output?.text ?? event.text ?? "",
        collapsible: true,
      });
      if (toolId) skipOutputs.add(toolId);
      continue;
    }
    if (event.type === "tool_output") {
      if (event.tool?.id && skipOutputs.has(event.tool.id)) continue;
      entries.push(toLogItem(event));
      continue;
    }
    if (event.type === "diff") {
      entries.push({
        tone: "muted",
        icon: "diff",
        title: "Diff",
        body: event.text ?? "",
        collapsible: true,
      });
      continue;
    }
    if (event.text) {
      const parsed = parseJsonRecord(event.text);
      if (parsed && isSystemEventPayload(parsed)) {
        entries.push(toSystemCalloutItem(event.text));
        continue;
      }
      entries.push(toLogItem(event));
    }
  }

  return entries;
}

function isUiNoopSubagentEvent(event: SubagentLogEvent): boolean {
  return (
    event.type === "skip" ||
    event.type === "session" ||
    event.type === "message"
  );
}

function hasTextContent(event: SubagentLogEvent): boolean {
  return typeof event.text === "string" && event.text.trim().length > 0;
}

function isMeaningfulSubagentResponseEvent(event: SubagentLogEvent): boolean {
  return event.type === "assistant" && hasTextContent(event);
}

function SubagentRunCard(props: {
  item: LogItem;
  showNested: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const run = props.item.subagentRun!;
  const count = run.nestedItems.length;
  return (
    <div class="subagent-run-card" classList={{ open: props.expanded }}>
      <button
        type="button"
        class="subagent-run-header"
        onClick={props.onToggle}
        aria-expanded={props.expanded}
      >
        <span class="subagent-fork-icon" aria-hidden="true">
          &#x2442;
        </span>
        <div class="subagent-run-info">
          <span class="subagent-run-title">{props.item.title}</span>
          <span class="subagent-run-desc">{props.item.body}</span>
        </div>
        <span class="subagent-run-badge">
          {count} {count === 1 ? "item" : "items"}
        </span>
        <span class="subagent-run-chevron" aria-hidden="true">
          {props.expanded ? "▲" : "▼"}
        </span>
      </button>
      <Show when={props.expanded && props.showNested && count > 0}>
        <div class="subagent-run-content">
          {run.nestedItems.map((nested) => renderLogItem(nested))}
        </div>
      </Show>
    </div>
  );
}

function CollapsibleLogLine(props: {
  item: LogItem;
  summaryText: string;
  expanded: boolean;
  onToggle: (next: boolean) => void;
}) {
  let detailsRef: HTMLDetailsElement | undefined;
  const toggleHandler = () => {
    if (!detailsRef) return;
    props.onToggle(detailsRef.open);
  };

  onMount(() => {
    if (!detailsRef) return;
    detailsRef.addEventListener("toggle", toggleHandler);
  });
  onCleanup(() => {
    if (!detailsRef) return;
    detailsRef.removeEventListener("toggle", toggleHandler);
  });

  return (
    <details
      class={`log-line ${props.item.tone} collapsible${props.item.systemCallout ? " system-callout" : ""}`}
      open={props.expanded}
      ref={detailsRef}
    >
      <summary class="log-summary">
        {logIcon(props.item.icon)}
        <span>{props.summaryText}</span>
      </summary>
      {props.item.tone === "assistant" || props.item.tone === "user" ? (
        <div
          class="log-text log-markdown"
          innerHTML={renderMarkdown(props.item.body.length > 0 ? props.item.body : "Empty content")}
        />
      ) : (
        <pre class="log-text">
          {props.item.body.length > 0 ? props.item.body : "Empty content"}
        </pre>
      )}
    </details>
  );
}

function renderLogItem(
  item: LogItem,
  collapsibleKey?: string,
  expanded?: boolean,
  onToggle?: (next: boolean) => void
) {
  const useMarkdown = item.tone === "assistant" || item.tone === "user";
  if (item.collapsible) {
    const summaryText =
      item.summaryPreview ?? item.title ?? item.body.split("\n")[0] ?? "Details";
    if (collapsibleKey && typeof expanded === "boolean" && onToggle) {
      return (
        <CollapsibleLogLine
          item={item}
          summaryText={summaryText}
          expanded={expanded}
          onToggle={onToggle}
        />
      );
    }
    return (
      <details
        class={`log-line ${item.tone} collapsible${item.systemCallout ? " system-callout" : ""}`}
        open={false}
      >
        <summary class="log-summary">
          {logIcon(item.icon)}
          <span>{summaryText}</span>
        </summary>
        <pre class="log-text">
          {item.body.length > 0 ? item.body : "Empty content"}
        </pre>
      </details>
    );
  }
  return (
    <div
      class={`log-line ${item.tone}${item.systemCallout ? " system-callout" : ""}`}
    >
      {logIcon(item.icon)}
      <div class="log-stack">
        {item.title && <div class="log-title">{item.title}</div>}
        {useMarkdown ? (
          <div
            class="log-text log-markdown"
            innerHTML={renderMarkdown(item.body)}
          />
        ) : (
          <pre class="log-text">{item.body}</pre>
        )}
      </div>
    </div>
  );
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
  if (icon === "subagent") {
    return (
      <svg
        class="log-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="M6 3v12" />
        <path d="M6 15c0-3 6-3 6-6" />
        <path d="M12 9v12" />
      </svg>
    );
  }
  return null;
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

function extractCliUserTexts(events: SubagentLogEvent[]): string[] {
  const texts: string[] = [];
  for (const event of events) {
    if (event.type !== "user") continue;
    if (event.text) texts.push(event.text);
  }
  return texts;
}

function mergePendingAihubMessages(
  messages: FullHistoryMessage[],
  pending: string[]
): { merged: LogItem[]; remaining: string[] } {
  if (pending.length === 0)
    return { merged: buildAihubLogs(messages), remaining: [] };
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
    remaining.length > 0
      ? [
          ...base,
          ...remaining.map((text) => ({ tone: "user" as const, body: text })),
        ]
      : base;
  return { merged, remaining };
}

export function AgentChat(props: AgentChatProps) {
  const [localInput, setLocalInput] = createSignal("");
  const [error, setError] = createSignal("");
  const [pendingFiles, setPendingFiles] = createSignal<PendingFile[]>([]);
  const [aihubLogs, setAihubLogs] = createSignal<LogItem[]>([]);
  const [aihubLive, setAihubLive] = createSignal("");
  const [aihubStreaming, setAihubStreaming] = createSignal(false);
  const [aihubPending, setAihubPending] = createSignal(false);
  const [aihubHistoryMessages, setAihubHistoryMessages] = createSignal<
    FullHistoryMessage[]
  >([]);
  const [pendingAihubUserMessages, setPendingAihubUserMessages] = createSignal<
    string[]
  >([]);
  const [cliLogs, setCliLogs] = createSignal<SubagentLogEvent[]>([]);
  const [cliCursor, setCliCursor] = createSignal(0);
  const [pendingCliUserMessages, setPendingCliUserMessages] = createSignal<
    string[]
  >([]);
  const [subagentAwaitingResponse, setSubagentAwaitingResponse] =
    createSignal(false);
  const [subagentSending, setSubagentSending] = createSignal(false);
  const [stopping, setStopping] = createSignal(false);
  const [isAtBottom, setIsAtBottom] = createSignal(true);
  const input = createMemo(() => props.inputDraft ?? localInput());
  const setInput = (value: string) => {
    if (props.onInputDraftChange) {
      props.onInputDraftChange(value);
      return;
    }
    setLocalInput(value);
  };
  const streamingToolCalls = new Map<
    string,
    { index: number; name: string; args: Record<string, unknown> }
  >();
  const SCROLL_THRESHOLD = 40;

  let streamCleanup: (() => void) | null = null;
  let subscriptionCleanup: (() => void) | null = null;
  let pollInterval: number | null = null;
  let pollStateKey: string | null = null;
  let subagentSetupToken = 0;
  let activeChatIdentity: string | null = null;
  let logPaneRef: HTMLDivElement | undefined;
  let textareaRef: HTMLTextAreaElement | undefined;
  let fileInputRef: HTMLInputElement | undefined;

  const clearSubagentPollInterval = () => {
    if (pollInterval !== null) {
      window.clearInterval(pollInterval);
      if (pollStateKey) {
        const active = activeSubagentPollIntervals.get(pollStateKey);
        if (active === pollInterval) {
          activeSubagentPollIntervals.delete(pollStateKey);
        }
      }
    }
    pollInterval = null;
    pollStateKey = null;
  };
  const teardownChatRuntime = () => {
    if (streamCleanup) {
      streamCleanup();
      streamCleanup = null;
    }
    if (subscriptionCleanup) {
      subscriptionCleanup();
      subscriptionCleanup = null;
    }
    clearSubagentPollInterval();
    subagentSetupToken += 1;
  };

  const sessionKey = createMemo(() =>
    props.agentId ? getSessionKey(props.agentId) : "main"
  );
  const cliTokens = new Set(["claude", "codex", "pi"]);
  const canSendLead = createMemo(
    () => props.agentType === "lead" && props.agentId && !aihubStreaming()
  );
  const canSendSubagent = createMemo(
    () =>
      props.agentType === "subagent" &&
      props.subagentInfo &&
      props.subagentInfo.cli &&
      props.subagentInfo.status !== "running" &&
      !subagentAwaitingResponse() &&
      !subagentSending()
  );
  const canAttach = createMemo(
    () =>
      (props.agentType === "lead" && Boolean(props.agentId)) ||
      (props.agentType === "subagent" && Boolean(props.subagentInfo?.cli))
  );
  const isRunning = createMemo(() => {
    if (props.agentType === "lead") return aihubStreaming();
    if (props.agentType === "subagent") {
      return (
        subagentSending() ||
        subagentAwaitingResponse() ||
        props.subagentInfo?.status === "running"
      );
    }
    return false;
  });
  const [showSubagents, setShowSubagents] = createSignal(true);
  const [expandedSubagentCards, setExpandedSubagentCards] = createSignal<
    Set<string>
  >(new Set());
  const [expandedCollapsibles, setExpandedCollapsibles] = createSignal<
    Set<string>
  >(new Set());
  const toggleSubagentCard = (toolUseId: string) => {
    setExpandedSubagentCards((prev) => {
      const next = new Set(prev);
      if (next.has(toolUseId)) {
        next.delete(toolUseId);
      } else {
        next.add(toolUseId);
      }
      return next;
    });
  };
  const setCollapsibleOpen = (key: string, expanded: boolean) => {
    setExpandedCollapsibles((prev) => {
      const next = new Set(prev);
      if (expanded) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  };

  onMount(() => {
    resizeTextarea(input());
  });

  const isSupportedImage = (file: File) => {
    if (supportedImageTypes.has(file.type)) return true;
    const ext = file.name.toLowerCase().split(".").pop();
    return ext ? supportedImageExtensions.has(ext) : false;
  };

  const addPendingFiles = (files: FileList | File[]) => {
    const next: PendingFile[] = [];
    for (const file of Array.from(files)) {
      if (!isSupportedImage(file)) continue;
      next.push({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        file,
        name: file.name,
      });
    }
    if (next.length > 0) {
      setPendingFiles((prev) => [...prev, ...next]);
    }
  };

  const removePendingFile = (id: string) => {
    setPendingFiles((prev) => prev.filter((item) => item.id !== id));
  };

  const resizeTextarea = (value = input()) => {
    if (!textareaRef) return;
    const lineHeight = 20;
    const maxHeight = lineHeight * 10;
    const lines = Math.max(1, value.split("\n").length);
    const height = Math.min(lines * lineHeight + 24, maxHeight + 24);
    textareaRef.style.height = `${height}px`;
  };

  const checkIsAtBottom = () => {
    if (!logPaneRef) return true;
    const { scrollTop, scrollHeight, clientHeight } = logPaneRef;
    return scrollHeight - scrollTop - clientHeight <= SCROLL_THRESHOLD;
  };

  const handleScroll = () => {
    setIsAtBottom(checkIsAtBottom());
  };

  const scrollToBottom = (force = false) => {
    if (!logPaneRef) return;
    if (force || isAtBottom()) {
      logPaneRef.scrollTop = logPaneRef.scrollHeight;
      setIsAtBottom(true);
    }
  };

  const markAihubStreaming = () => {
    if (aihubPending()) setAihubPending(false);
  };

  const resolveToolPath = (args: Record<string, unknown>) => {
    if (typeof args.path === "string") return args.path;
    if (typeof args.file_path === "string") return args.file_path;
    return "";
  };

  const appendStreamingToolCall = (
    id: string,
    name: string,
    rawArgs: unknown
  ) => {
    const args =
      rawArgs && typeof rawArgs === "object"
        ? (rawArgs as Record<string, unknown>)
        : {};
    const toolKey = name.toLowerCase();
    let item: LogItem;

    if (toolKey === "read") {
      const path = resolveToolPath(args);
      item = {
        tone: "muted",
        icon: "read",
        title: `read ${path}`.trim(),
        body: "",
        collapsible: true,
      };
    } else if (toolKey === "bash") {
      const command = typeof args.command === "string" ? args.command : "";
      const params = typeof args.args === "string" ? args.args : "";
      const description =
        typeof args.description === "string" ? args.description : "";
      const summary = ["Bash", command, params, description]
        .filter((part) => part.trim())
        .join(" ");
      item = {
        tone: "muted",
        icon: "bash",
        title: summary || "Bash",
        body: "",
        collapsible: true,
      };
    } else if (toolKey === "write") {
      const path = resolveToolPath(args);
      const content = typeof args.content === "string" ? args.content : "";
      item = {
        tone: "muted",
        icon: "write",
        title: `write ${path}`.trim(),
        body: content,
        collapsible: true,
      };
    } else if (toolKey === "agent") {
      const prompt = typeof args.prompt === "string" ? args.prompt : "";
      const description =
        typeof args.description === "string" ? args.description : "";
      const subagentType =
        typeof args.subagent_type === "string" ? args.subagent_type : "";
      item = {
        tone: "muted",
        icon: "subagent",
        title: `Subagent Run${subagentType ? ` (${subagentType})` : ""}`,
        body:
          description ||
          (prompt ? prompt.slice(0, 200) : "Subagent running..."),
        subagentRun: {
          toolUseId: id,
          nestedItems: prompt
            ? [
                {
                  tone: "user",
                  title: "Coordinator \u2192 Subagent",
                  body: prompt,
                },
              ]
            : [],
        },
      };
    } else {
      item = {
        tone: "muted",
        icon: "tool",
        title: name ? `Tool: ${name}` : "Tool",
        body: "",
        collapsible: true,
      };
    }

    setAihubLogs((prev) => {
      streamingToolCalls.set(id, { index: prev.length, name, args });
      return [...prev, item];
    });
  };

  const updateStreamingToolResult = (
    id: string,
    content: string,
    details?: { diff?: string }
  ) => {
    const entry = streamingToolCalls.get(id);
    if (!entry) return;

    const toolKey = entry.name.toLowerCase();
    if (toolKey === "write") return;

    if (toolKey === "agent") {
      if (!content) return;
      setAihubLogs((prev) => {
        if (entry.index < 0 || entry.index >= prev.length) return prev;
        const current = prev[entry.index];
        if (!current.subagentRun) return prev;
        const next = [...prev];
        const updatedNested = [...current.subagentRun.nestedItems];
        updatedNested.push({
          tone: "assistant",
          title: "Subagent summary returned",
          body: content,
        });
        next[entry.index] = {
          ...current,
          subagentRun: {
            ...current.subagentRun,
            nestedItems: updatedNested,
          },
        };
        return next;
      });
      return;
    }

    const nextBody =
      content ||
      (toolKey === "read" || toolKey === "bash" ? "" : formatJson(entry.args));

    setAihubLogs((prev) => {
      if (entry.index < 0 || entry.index >= prev.length) return prev;
      const current = prev[entry.index];
      if (current.body === nextBody) return prev;
      const next = [...prev];
      next[entry.index] = { ...current, body: nextBody };
      return next;
    });

    if (details?.diff) {
      setAihubLogs((prev) => [
        ...prev,
        {
          tone: "muted",
          icon: "diff",
          title: "Diff",
          body: details.diff ?? "",
          collapsible: true,
        },
      ]);
    }
  };

  const loadAihubHistory = async () => {
    if (!props.agentId) return;
    const res = await fetchFullHistory(props.agentId, sessionKey());
    setAihubHistoryMessages(res.messages ?? []);
    const pending = pendingAihubUserMessages();
    const { merged, remaining } = mergePendingAihubMessages(
      res.messages ?? [],
      pending
    );
    setAihubLogs(merged);
    setPendingAihubUserMessages(remaining);
  };

  const setupLead = () => {
    if (!props.agentId) return;
    loadAihubHistory();
    subscriptionCleanup = subscribeToSession(props.agentId, sessionKey(), {
      onHistoryUpdated: () => {
        if (!aihubStreaming()) {
          loadAihubHistory();
        }
      },
    });
  };

  const setupSubagent = (setupToken: number) => {
    const subagentInfo = props.subagentInfo;
    if (!subagentInfo) return;
    let activeSlug = subagentInfo.slug;
    const resolveSlug = async () => {
      if (!cliTokens.has(activeSlug)) return;
      const res = await fetchSubagents(subagentInfo.projectId);
      if (setupToken !== subagentSetupToken) return;
      if (!res.ok) return;
      const token = activeSlug;
      const match = res.data.items.find(
        (item) => item.slug === token || item.cli === token
      );
      if (match) {
        activeSlug = match.slug;
      } else if (res.data.items.length === 1) {
        activeSlug = res.data.items[0].slug;
      }
    };
    const loadLogs = async () => {
      if (setupToken !== subagentSetupToken) return;
      const currentCursor = cliCursor();
      const res = await fetchSubagentLogs(
        subagentInfo.projectId,
        activeSlug,
        currentCursor
      );
      if (setupToken !== subagentSetupToken) return;
      if (!res.ok) return;
      const stateKey = `${subagentInfo.projectId}:${activeSlug}`;
      const fetchedEvents = res.data.events;
      if (fetchedEvents.length > 0) {
        const keptEvents = fetchedEvents.filter(
          (event) => !isUiNoopSubagentEvent(event)
        );
        const next =
          keptEvents.length > 0 ? [...cliLogs(), ...keptEvents] : cliLogs();
        const pending = pendingCliUserMessages();
        const sawResponse = keptEvents.some(isMeaningfulSubagentResponseEvent);
        let remaining = pending;
        let nextAwaiting = subagentAwaitingResponse();

        if (pending.length > 0) {
          const historyUsers = extractCliUserTexts(next);
          let cursor = 0;
          remaining = [];
          for (const text of pending) {
            const idx = historyUsers.indexOf(text, cursor);
            if (idx === -1) {
              remaining.push(text);
            } else {
              cursor = idx + 1;
            }
          }
        }

        batch(() => {
          if (keptEvents.length > 0) {
            setCliLogs(next);
          }
          if (sawResponse) {
            nextAwaiting = false;
            setSubagentAwaitingResponse(false);
            setPendingCliUserMessages([]);
            subagentTransientState.delete(stateKey);
          } else if (next.every((event) => event.type === "user")) {
            nextAwaiting = true;
            setSubagentAwaitingResponse(true);
          }
          if (pending.length > 0 && !sawResponse) {
            setPendingCliUserMessages(remaining);
            subagentTransientState.set(stateKey, {
              awaiting: nextAwaiting,
              pending: remaining,
            });
          }
        });
      }
      setCliCursor(res.data.cursor);
    };
    void resolveSlug().then(() => {
      if (setupToken !== subagentSetupToken) return;
      pollStateKey = `${subagentInfo.projectId}:${activeSlug}`;
      const existing = activeSubagentPollIntervals.get(pollStateKey);
      if (existing !== undefined) {
        window.clearInterval(existing);
      }
      void loadLogs();
      pollInterval = window.setInterval(() => {
        void loadLogs();
      }, 2000);
      if (pollInterval !== null) {
        activeSubagentPollIntervals.set(pollStateKey, pollInterval);
      }
    });
  };

  createEffect(() => {
    const nextIdentity =
      props.agentType === "lead"
        ? `lead:${props.agentId ?? ""}`
        : `subagent:${props.subagentInfo?.projectId ?? ""}:${props.subagentInfo?.slug ?? ""}`;
    if (nextIdentity === activeChatIdentity) return;
    const isAgentSwitch = activeChatIdentity !== null;
    activeChatIdentity = nextIdentity;

    teardownChatRuntime();

    setError("");
    if (isAgentSwitch) setInput("");
    setAihubLogs([]);
    setAihubLive("");
    setAihubStreaming(false);
    setAihubPending(false);
    setAihubHistoryMessages([]);
    setPendingFiles([]);
    setPendingAihubUserMessages([]);
    streamingToolCalls.clear();
    setCliLogs([]);
    setCliCursor(0);
    setExpandedCollapsibles(new Set());
    setExpandedSubagentCards(new Set());
    const persistedState =
      props.agentType === "subagent" && props.subagentInfo
        ? subagentTransientState.get(
            subagentStateKey({
              projectId: props.subagentInfo.projectId,
              slug: props.subagentInfo.slug,
            }) ?? ""
          )
        : undefined;
    setPendingCliUserMessages(persistedState?.pending ?? []);
    setSubagentAwaitingResponse(persistedState?.awaiting ?? false);
    setSubagentSending(false);
    setIsAtBottom(true);
    if (textareaRef) {
      resizeTextarea("");
    }

    if (props.agentType === "lead" && props.agentId) {
      setupLead();
    }

    if (props.agentType === "subagent" && props.subagentInfo) {
      setupSubagent(subagentSetupToken);
    }
  });

  onCleanup(() => {
    teardownChatRuntime();
    activeChatIdentity = null;
  });

  createEffect(() => {
    aihubLogs();
    aihubLive();
    cliLogs();
    pendingCliUserMessages();
    aihubPending();
    scrollToBottom();
  });

  createEffect(() => {
    resizeTextarea(input());
  });

  createEffect(() => {
    if (!isRunning()) setStopping(false);
  });

  createEffect(() => {
    if (props.agentType !== "subagent" || !props.subagentInfo) return;
    const key = subagentStateKey({
      projectId: props.subagentInfo.projectId,
      slug: props.subagentInfo.slug,
    });
    if (!key) return;
    if (
      (props.subagentInfo.status === "replied" ||
        props.subagentInfo.status === "error" ||
        props.subagentInfo.status === "idle") &&
      !subagentSending() &&
      pendingCliUserMessages().length === 0
    ) {
      subagentTransientState.delete(key);
    }
  });

  const handleSend = async (overrideText?: string) => {
    const text = (overrideText ?? input()).trim();
    if (!text) return;
    const isAbort = text === "/abort";

    if (props.agentType === "subagent") {
      if (!props.subagentInfo || !props.subagentInfo.cli || subagentSending())
        return;
      const key = subagentStateKey({
        projectId: props.subagentInfo.projectId,
        slug: props.subagentInfo.slug,
      });
      setSubagentSending(true);
      setError("");
      setPendingCliUserMessages((prev) => {
        const next = [...prev, text];
        if (key) {
          subagentTransientState.set(key, { awaiting: true, pending: next });
        }
        return next;
      });
      setSubagentAwaitingResponse(true);
      const currentPending = pendingFiles();
      setInput("");
      setPendingFiles([]);
      resizeTextarea("");
      scrollToBottom(true);

      let attachments: FileAttachment[] | undefined;
      if (currentPending.length > 0) {
        try {
          attachments = await uploadFiles(currentPending.map((f) => f.file));
        } catch {
          // continue without attachments
        }
      }

      const mode =
        props.subagentInfo.runMode === "main-run"
          ? "main-run"
          : props.subagentInfo.runMode === "worktree"
            ? "worktree"
            : props.subagentInfo.runMode === "clone"
              ? "clone"
              : props.subagentInfo.runMode === "none"
                ? "none"
                : props.subagentInfo.slug === "main"
                  ? "main-run"
                  : "clone";
      void spawnSubagent(props.subagentInfo.projectId, {
        slug: props.subagentInfo.slug,
        cli: props.subagentInfo.cli,
        prompt: text,
        mode,
        resume: true,
        attachments,
      }).then((res) => {
        if (!res.ok) {
          setError(res.error);
          setPendingCliUserMessages((prev) => {
            const idx = prev.indexOf(text);
            if (idx === -1) return prev;
            const next = [...prev.slice(0, idx), ...prev.slice(idx + 1)];
            if (key) {
              subagentTransientState.set(key, {
                awaiting: false,
                pending: next,
              });
            }
            return next;
          });
          setSubagentAwaitingResponse(false);
        }
        setSubagentSending(false);
      });
      return;
    }

    if (!props.agentId || (aihubStreaming() && !isAbort)) return;

    // Upload files first, then send message with paths
    const currentPendingFiles = pendingFiles();
    let fileAttachments: FileAttachment[] = [];
    if (currentPendingFiles.length > 0 && !isAbort) {
      try {
        fileAttachments = await uploadFiles(
          currentPendingFiles.map((p) => p.file)
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to upload files");
        return;
      }
    }

    // Build log message with file attachments
    let logBody = text;
    if (fileAttachments.length > 0) {
      const fileList = fileAttachments.map((f) => `📎 ${f.path}`).join("\n");
      logBody = text ? `${text}\n\n${fileList}` : fileList;
    }

    if (!isAbort) {
      setPendingAihubUserMessages((prev) => [...prev, text]);
      setAihubLogs((prev) => [...prev, { tone: "user", body: logBody }]);
      setInput("");
      setPendingFiles([]);
    }
    setError("");
    setAihubLive("");
    setAihubStreaming(true);
    setAihubPending(true);
    streamingToolCalls.clear();
    resizeTextarea("");
    scrollToBottom(true);

    streamCleanup?.();
    streamCleanup = streamMessage(
      props.agentId,
      text,
      sessionKey(),
      (chunk) => {
        markAihubStreaming();
        setAihubLive((prev) => prev + chunk);
      },
      () => {
        const finalText = aihubLive();
        if (finalText) {
          setAihubLogs((prev) => [
            ...prev,
            { tone: "assistant", body: finalText },
          ]);
        }
        setAihubStreaming(false);
        setAihubLive("");
        setAihubPending(false);
        streamingToolCalls.clear();
        setPendingAihubUserMessages((prev) => {
          const idx = prev.indexOf(text);
          if (idx === -1) return prev;
          return [...prev.slice(0, idx), ...prev.slice(idx + 1)];
        });
      },
      (err) => {
        setError(err);
        setAihubStreaming(false);
        setAihubPending(false);
        streamingToolCalls.clear();
      },
      {
        onThinking: (_chunk) => {
          markAihubStreaming();
        },
        onToolCall: (id, name, args) => {
          markAihubStreaming();
          appendStreamingToolCall(id, name, args);
        },
        onToolResult: (id, _name, content, _isError, details) => {
          markAihubStreaming();
          updateStreamingToolResult(id, content, details);
        },
        onSessionReset: () => {
          setAihubLogs([]);
          setAihubLive("");
          setAihubStreaming(false);
          setAihubPending(false);
          setPendingAihubUserMessages([]);
          streamingToolCalls.clear();
        },
      },
      { attachments: fileAttachments.length > 0 ? fileAttachments : undefined }
    );
  };

  const handleStop = async () => {
    if (stopping()) return;
    setStopping(true);
    if (props.agentType === "lead") {
      try {
        await handleSend("/abort");
      } finally {
        setStopping(false);
      }
      return;
    }
    if (props.agentType === "subagent" && props.subagentInfo) {
      const { projectId, slug } = props.subagentInfo;
      const key = subagentStateKey({ projectId, slug });
      try {
        const res = await interruptSubagent(projectId, slug);
        if (!res.ok) {
          setError(res.error);
        } else {
          setSubagentAwaitingResponse(false);
          setPendingCliUserMessages([]);
          if (key) subagentTransientState.delete(key);
        }
      } finally {
        setStopping(false);
      }
      return;
    }
    setStopping(false);
  };

  const aihubLogItems = createMemo(() => aihubLogs());
  const estimatedContextUsagePct = createMemo(() => {
    let highestInputTokens = 0;
    let modelName: string | undefined;
    for (const message of aihubHistoryMessages()) {
      if (message.role !== "assistant") continue;
      const meta = message.meta;
      if (meta?.model) modelName = meta.model;
      const rawUsage = meta?.usage as
        | (typeof meta.usage & {
            input_tokens?: number;
            total_tokens?: number;
          })
        | undefined;
      if (!rawUsage) continue;
      const inputTokens =
        typeof rawUsage.input === "number"
          ? rawUsage.input
          : typeof rawUsage.input_tokens === "number"
            ? rawUsage.input_tokens
            : 0;
      if (inputTokens > highestInputTokens) highestInputTokens = inputTokens;
    }
    const normalizedModelName = modelName?.toLowerCase();
    const maxTokens =
      (normalizedModelName
        ? Object.entries(MODEL_CONTEXT_LIMITS).find(
            ([key]) =>
              key !== "default" && normalizedModelName.includes(key.toLowerCase())
          )?.[1]
        : undefined) ?? MODEL_CONTEXT_LIMITS.default;
    if (maxTokens <= 0 || highestInputTokens <= 0) return 0;
    const rawPct = (highestInputTokens / maxTokens) * 100;
    if (rawPct > 0 && rawPct < 1) return 1;
    return Math.max(0, Math.min(100, Math.round(rawPct)));
  });
  const cliDisplayEvents = createMemo(() => {
    const pending = pendingCliUserMessages();
    if (pending.length === 0) return cliLogs();
    return [...cliLogs(), ...pending.map((text) => ({ type: "user", text }))];
  });
  const cliLogItems = createMemo(() => buildCliLogs(cliDisplayEvents()));
  const hasSubagentRuns = createMemo(() => {
    const items = props.agentType === "lead" ? aihubLogItems() : cliLogItems();
    return items.some((item) => item.subagentRun);
  });

  return (
    <div
      class="agent-chat"
      classList={{ fullscreen: Boolean(props.fullscreen) }}
    >
      <Show when={props.showHeader !== false}>
        <div class="chat-header">
          <button class="back-btn" type="button" onClick={props.onBack}>
            ←
          </button>
          <div class="chat-title-row">
            <h3>{props.agentName ?? "Select an agent"}</h3>
            <Show when={props.agentType === "subagent" && props.subagentInfo}>
              <button
                class="open-project-btn"
                type="button"
                title="Open project details"
                aria-label="Open project details"
                onClick={() => {
                  const info = props.subagentInfo;
                  if (!info || !props.onOpenProject) return;
                  props.onOpenProject(info.projectId);
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
            </Show>
          </div>
          <Show when={props.agentType === "subagent" && props.subagentInfo}>
            <button
              class="archive-btn"
              type="button"
              title="Archive run"
              aria-label="Archive run"
              onClick={async () => {
                const info = props.subagentInfo!;
                if (!window.confirm(`Archive run ${info.slug}?`)) return;
                const res = await archiveSubagent(info.projectId, info.slug);
                if (res.ok) {
                  props.onBack();
                } else {
                  setError(res.error);
                }
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
          </Show>
          <Show when={props.agentType === "subagent" && props.subagentInfo}>
            <button
              class="kill-btn"
              type="button"
              title="Kill subagent"
              onClick={async () => {
                const info = props.subagentInfo!;
                if (
                  !window.confirm(
                    `Kill subagent ${info.slug}? This removes all workspace data.`
                  )
                )
                  return;
                const res = await killSubagent(info.projectId, info.slug);
                if (res.ok) {
                  props.onBack();
                } else {
                  setError(res.error);
                }
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
          </Show>
        </div>
      </Show>

      <div
        class="chat-messages"
        onDragOver={(e) => {
          e.preventDefault();
          if (!canAttach()) return;
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (!canAttach()) return;
          const files = e.dataTransfer?.files;
          if (!files || files.length === 0) return;
          addPendingFiles(files);
        }}
      >
        <Show when={!props.agentName}>
          <div class="chat-empty">Select an agent to chat</div>
        </Show>

        <Show when={props.agentName && props.agentType === "lead"}>
          <div class="log-pane" ref={logPaneRef} onScroll={handleScroll}>
            <Show when={hasSubagentRuns()}>
              <div class="subagent-filter-bar">
                <button
                  type="button"
                  class="subagent-filter-toggle"
                  classList={{ active: !showSubagents() }}
                  onClick={() => setShowSubagents((prev) => !prev)}
                >
                  {showSubagents() ? "All messages" : "Main only"}
                </button>
              </div>
            </Show>
            <Show
              when={aihubLogItems().length > 0}
              fallback={<div class="log-empty">No messages yet.</div>}
            >
              <For each={aihubLogItems()}>
                {(item) => {
                  const key = item.subagentRun
                    ? `subagent:${item.subagentRun.toolUseId}`
                    : `lead-collapsible:${item.summaryPreview ?? item.title ?? item.body.slice(0, 80)}:${item.body.length}`;
                  if (item.subagentRun) {
                    const id = item.subagentRun.toolUseId;
                    return (
                      <SubagentRunCard
                        item={item}
                        showNested={showSubagents()}
                        expanded={expandedSubagentCards().has(id)}
                        onToggle={() => toggleSubagentCard(id)}
                      />
                    );
                  }
                  return renderLogItem(
                    item,
                    key,
                    expandedCollapsibles().has(key),
                    (next) => setCollapsibleOpen(key, next)
                  );
                }}
              </For>
            </Show>
            <Show when={aihubLive()}>
              <div class="log-line assistant live">
                <div class="log-stack">
                  <pre class="log-text">{aihubLive()}</pre>
                </div>
              </div>
            </Show>
            <Show when={aihubPending()}>
              <div class="log-line pending">
                <span class="log-spinner" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
              </div>
            </Show>
          </div>
        </Show>

        <Show when={props.agentName && props.agentType === "subagent"}>
          <div class="log-pane" ref={logPaneRef} onScroll={handleScroll}>
            <Show when={hasSubagentRuns()}>
              <div class="subagent-filter-bar">
                <button
                  type="button"
                  class="subagent-filter-toggle"
                  classList={{ active: !showSubagents() }}
                  onClick={() => setShowSubagents((prev) => !prev)}
                >
                  {showSubagents() ? "All messages" : "Main only"}
                </button>
              </div>
            </Show>
            <Show
              when={cliLogItems().length > 0}
              fallback={<div class="log-empty">No logs yet.</div>}
            >
              <For each={cliLogItems()}>
                {(item) => {
                  const key = item.subagentRun
                    ? `subagent:${item.subagentRun.toolUseId}`
                    : `cli-collapsible:${item.summaryPreview ?? item.title ?? item.body.slice(0, 80)}:${item.body.length}`;
                  if (item.subagentRun) {
                    const id = item.subagentRun.toolUseId;
                    return (
                      <SubagentRunCard
                        item={item}
                        showNested={showSubagents()}
                        expanded={expandedSubagentCards().has(id)}
                        onToggle={() => toggleSubagentCard(id)}
                      />
                    );
                  }
                  return renderLogItem(
                    item,
                    key,
                    expandedCollapsibles().has(key),
                    (next) => setCollapsibleOpen(key, next)
                  );
                }}
              </For>
            </Show>
            <Show
              when={
                pendingCliUserMessages().length > 0 ||
                subagentSending() ||
                subagentAwaitingResponse()
              }
            >
              <div class="log-line pending">
                <span class="log-spinner" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
              </div>
            </Show>
          </div>
        </Show>
      </div>

      <Show when={error()}>
        <div class="chat-error">{error()}</div>
      </Show>

      <Show when={pendingFiles().length > 0}>
        <div class="chat-attachments">
          {pendingFiles().map((item) => (
            <div class="attachment-pill">
              <span class="attachment-name" title={item.name}>
                {item.name}
              </span>
              <button
                type="button"
                class="attachment-remove"
                aria-label={`Remove ${item.name}`}
                onClick={() => removePendingFile(item.id)}
              >
                x
              </button>
            </div>
          ))}
        </div>
      </Show>

      <div class="chat-input">
        <div class="chat-controls">
          <input
            ref={fileInputRef}
            class="chat-file-input"
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp,image/jpg"
            multiple
            onChange={(e) => {
              if (!canAttach()) return;
              const files = e.currentTarget.files;
              if (!files || files.length === 0) return;
              addPendingFiles(files);
              e.currentTarget.value = "";
            }}
          />
          <button
            type="button"
            class="attach-btn"
            aria-label="Attach images"
            disabled={!canAttach()}
            onClick={() => fileInputRef?.click()}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="currentColor"
                d="M16.5 6.5v9.1a4.5 4.5 0 0 1-9 0V6.3a3.3 3.3 0 0 1 6.6 0v8.8a2.1 2.1 0 1 1-4.2 0V7.2h1.6v7.9a.5.5 0 1 0 1 0V6.3a1.7 1.7 0 0 0-3.4 0v9.3a2.9 2.9 0 0 0 5.8 0V6.5h1.6z"
              />
            </svg>
          </button>
          <textarea
            placeholder="Type a message..."
            disabled={!canSendLead() && !canSendSubagent()}
            value={input()}
            ref={textareaRef}
            rows={1}
            onInput={(e) => {
              const value = e.currentTarget.value;
              setInput(value);
              resizeTextarea(value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
          />
          <Show
            when={isRunning()}
            fallback={
              <button
                type="button"
                class="send-btn"
                disabled={!canSendLead() && !canSendSubagent()}
                onClick={() => void handleSend()}
              >
                Send
              </button>
            }
          >
            <button
              type="button"
              class="stop-btn"
              classList={{ stopping: stopping() }}
              disabled={stopping()}
              onClick={() => void handleStop()}
            >
              {stopping() ? "Stopping..." : "Stop"}
            </button>
          </Show>
        </div>
        <Show when={estimatedContextUsagePct() > 0}>
          <div class="context-usage">~{estimatedContextUsagePct()}% context used</div>
        </Show>
      </div>

      <style>{`
        .agent-chat {
          display: flex;
          flex-direction: column;
          height: 100%;
          min-width: 0;
          font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
          font-size: 14px;
          line-height: 1.6;
          color: var(--text-primary);
        }

        /* ── Header ── */

        .chat-header {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 16px;
          border-bottom: 1px solid var(--border-default);
        }

        .chat-header h3 {
          margin: 0;
          font-size: 14px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .chat-title-row {
          display: flex;
          align-items: center;
          gap: 6px;
          min-width: 0;
        }

        .back-btn {
          background: none;
          border: none;
          color: var(--text-tertiary);
          font-size: 16px;
          cursor: pointer;
        }

        .back-btn:hover { color: var(--text-primary); }

        .back-btn:focus-visible {
          outline: 2px solid rgba(59, 130, 246, 0.6);
          outline-offset: 2px;
        }

        .chat-header .open-project-btn,
        .chat-header .archive-btn {
          background: none;
          border: none;
          padding: 4px;
          cursor: pointer;
          color: #8b96a5;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .chat-header .open-project-btn svg,
        .chat-header .archive-btn svg,
        .chat-header .kill-btn svg {
          width: 16px;
          height: 16px;
        }

        .chat-header .open-project-btn:hover { color: #d4dbe5; }
        .chat-header .archive-btn { margin-left: auto; }
        .chat-header .archive-btn:hover { color: #f6c454; }

        .chat-header .kill-btn {
          background: none;
          border: none;
          padding: 4px;
          cursor: pointer;
          color: var(--text-muted);
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .chat-header .kill-btn:hover { color: #e53935; }

        /* ── Messages area ── */

        .chat-messages {
          flex: 1;
          overflow-y: auto;
          padding: 0;
          display: flex;
          min-width: 0;
          scroll-behavior: smooth;
        }

        .chat-messages,
        .log-pane {
          scrollbar-width: thin;
          scrollbar-color: var(--scrollbar-thumb) transparent;
        }

        .chat-messages::-webkit-scrollbar,
        .log-pane::-webkit-scrollbar { width: 8px; }

        .chat-messages::-webkit-scrollbar-track,
        .log-pane::-webkit-scrollbar-track { background: transparent; }

        .chat-messages::-webkit-scrollbar-thumb,
        .log-pane::-webkit-scrollbar-thumb {
          background: var(--scrollbar-thumb);
          border: 2px solid transparent;
          background-clip: content-box;
          border-radius: 999px;
        }

        .chat-messages::-webkit-scrollbar-thumb:hover,
        .log-pane::-webkit-scrollbar-thumb:hover {
          background: var(--bg-raised);
          border: 2px solid transparent;
          background-clip: content-box;
        }

        .chat-empty {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-muted);
          font-size: 14px;
        }

        .chat-error {
          padding: 8px 16px;
          font-size: 12px;
          color: #f5b0b0;
          border-top: 1px solid var(--border-default);
        }

        /* ── Log pane — flat, no container chrome ── */

        .log-pane {
          background: transparent;
          border: none;
          border-radius: 0;
          padding: 16px 20px;
          overflow: auto;
          display: flex;
          flex-direction: column;
          gap: 2px;
          flex: 1;
          min-height: 0;
          min-width: 0;
          max-width: 100%;
        }

        /* ── Log lines — flat, full-width ── */

        .log-line {
          display: flex;
          gap: 10px;
          align-items: flex-start;
          padding: 10px 12px;
          border-radius: 6px;
          background: transparent;
          min-width: 0;
          max-width: 100%;
        }

        .log-line + .log-line {
          border-top: 1px solid rgba(255, 255, 255, 0.04);
        }

        /* ── User messages — subtle green left accent ── */

        .log-line.user {
          color: var(--tone-user);
          background: rgba(45, 212, 191, 0.04);
          border-left: 2px solid rgba(45, 212, 191, 0.4);
          border-radius: 0 6px 6px 0;
          padding-left: 14px;
          margin: 8px 0 4px;
        }

        .log-line.user + .log-line {
          border-top: none;
        }

        .log-line + .log-line.user {
          border-top: none;
        }

        /* ── Assistant messages — clean, no background ── */

        .log-line.assistant {
          color: var(--text-primary);
          padding: 10px 12px;
        }

        .log-line.live {
          color: var(--tone-live);
        }

        /* ── Muted / tool calls — compact, subtle ── */

        .log-line.muted {
          color: var(--text-tertiary);
          background: transparent;
          font-size: 13px;
          padding: 4px 12px;
        }

        .log-line.error {
          color: var(--tone-error);
          background: rgba(220, 50, 50, 0.06);
          border-left: 2px solid rgba(220, 50, 50, 0.4);
          border-radius: 0 6px 6px 0;
          padding-left: 14px;
        }

        .log-line.system-callout {
          background: rgba(59, 130, 246, 0.08);
          border-left: 3px solid #3b82f6;
          font-size: 11px;
          padding: 8px 12px;
          border-radius: 6px;
          color: var(--text-secondary);
        }

        /* ── Collapsible tool calls ── */

        .log-line.collapsible {
          padding: 0;
          display: block;
          border-radius: 6px;
        }

        .log-line.collapsible + .log-line,
        .log-line + .log-line.collapsible {
          border-top: none;
        }

        .log-summary {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 5px 12px;
          cursor: pointer;
          list-style: none;
          width: 100%;
          font-size: 13px;
          color: var(--text-tertiary);
          border-radius: 6px;
          transition: background 0.1s;
          min-width: 0;
        }

        .log-summary span {
          min-width: 0;
          overflow-wrap: anywhere;
          word-break: break-word;
        }

        .log-summary:hover {
          background: rgba(255, 255, 255, 0.03);
        }

        .log-summary::-webkit-details-marker {
          display: none;
        }

        .log-summary::before {
          display: none;
          content: "";
        }

        .log-line.collapsible .log-text {
          background: rgba(255, 255, 255, 0.02);
          border-radius: 0 0 6px 6px;
          border-top: 1px solid rgba(255, 255, 255, 0.05);
          /* Align expanded tool output with tool-call label text (after chevron+icon). */
          padding: 10px 12px 10px 36px;
          font-family: "SF Mono", "Consolas", "Liberation Mono", monospace;
          font-size: 12px;
          line-height: 1.5;
          color: var(--text-tertiary);
          max-height: 300px;
          overflow: auto;
          overflow-wrap: anywhere;
          word-break: break-word;
        }

        .log-line.collapsible.user .log-text {
          font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
          font-size: 13px;
          color: var(--text-primary);
          max-height: none;
          overflow: visible;
        }

        .log-line.collapsible.system-callout {
          padding: 0;
        }

        .log-line.collapsible.system-callout .log-summary {
          background: rgba(59, 130, 246, 0.08);
          border-left: 3px solid #3b82f6;
          border-radius: 6px 6px 0 0;
          padding: 8px 12px;
          font-size: 11px;
        }

        .log-line.collapsible.system-callout .log-summary:hover {
          background: rgba(59, 130, 246, 0.12);
        }

        .log-line.collapsible.system-callout .log-text {
          background: rgba(59, 130, 246, 0.08);
          border-top: 1px solid rgba(59, 130, 246, 0.35);
          border-left: 3px solid #3b82f6;
          border-radius: 0 0 6px 6px;
          padding: 8px 12px 8px 36px;
          font-size: 11px;
          color: var(--text-secondary);
        }

        /* ── Content layout ── */

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
          letter-spacing: 0.08em;
          color: var(--text-muted);
          font-weight: 500;
        }

        .log-icon {
          width: 14px;
          height: 14px;
          opacity: 0.5;
          margin-top: 3px;
          flex: 0 0 auto;
        }

        pre.log-text {
          margin: 0;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
          word-break: break-word;
          line-height: 1.6;
          max-width: 100%;
          font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
        }

        /* Terminal/tool output should stay monospace. */
        .log-line.muted pre.log-text,
        .log-line.error pre.log-text {
          font-family: "SF Mono", "Consolas", "Liberation Mono", monospace;
        }

        /* ── Markdown rendering ── */

        .log-markdown {
          white-space: normal;
          overflow-wrap: anywhere;
          word-break: break-word;
        }

        .log-markdown p {
          margin: 0;
        }

        .log-markdown p + p {
          margin-top: 8px;
        }

        .log-markdown strong {
          color: var(--text-primary);
          font-weight: 600;
        }

        .log-markdown code {
          background: rgba(255, 255, 255, 0.06);
          border-radius: 4px;
          padding: 2px 6px;
          font-family: "SF Mono", "Consolas", "Liberation Mono", monospace;
          font-size: 0.9em;
          color: var(--text-secondary);
          white-space: break-spaces;
          overflow-wrap: anywhere;
          word-break: break-word;
        }

        .log-markdown pre {
          margin: 10px 0;
          padding: 12px 14px;
          background: var(--shadow-md);
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 8px;
          overflow: auto;
          font-family: "SF Mono", "Consolas", "Liberation Mono", monospace;
          font-size: 13px;
          line-height: 1.5;
          color: var(--text-secondary);
        }

        .log-markdown pre code {
          background: transparent;
          padding: 0;
          color: inherit;
          white-space: pre;
          overflow-wrap: normal;
          word-break: normal;
        }

        .log-markdown ul,
        .log-markdown ol {
          margin: 8px 0;
          padding-left: 22px;
        }

        .log-markdown li {
          margin: 0;
        }

        .log-markdown li + li {
          margin-top: 4px;
        }

        .log-markdown li > p {
          margin: 0;
        }

        .log-markdown hr {
          margin: 12px 0;
          border: 0;
          border-top: 1px solid rgba(255, 255, 255, 0.08);
        }

        .log-markdown h1,
        .log-markdown h2,
        .log-markdown h3,
        .log-markdown h4 {
          color: var(--text-primary);
          margin: 16px 0 8px;
          line-height: 1.3;
        }

        .log-markdown h1 { font-size: 1.25em; }
        .log-markdown h2 { font-size: 1.15em; }
        .log-markdown h3 { font-size: 1.05em; }
        .log-markdown h4 { font-size: 1em; }

        .log-markdown h1:first-child,
        .log-markdown h2:first-child,
        .log-markdown h3:first-child,
        .log-markdown h4:first-child {
          margin-top: 0;
        }

        .log-markdown blockquote {
          margin: 8px 0;
          padding: 4px 12px;
          border-left: 2px solid rgba(255, 255, 255, 0.15);
          color: var(--text-tertiary);
        }

        .log-markdown table {
          width: 100%;
          display: block;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          border-collapse: collapse;
          margin: 10px 0;
          font-size: 13px;
        }

        .log-markdown th,
        .log-markdown td {
          border: 1px solid var(--border-default);
          padding: 8px 12px;
          text-align: left;
        }

        .log-markdown th {
          background: rgba(255, 255, 255, 0.04);
          color: var(--text-primary);
          font-weight: 600;
        }

        .log-markdown tbody tr:nth-child(even) {
          background: rgba(255, 255, 255, 0.02);
        }

        /* ── Pending / spinner ── */

        .log-line.pending {
          opacity: 0.9;
          align-items: center;
          background: transparent;
          padding: 8px 12px;
        }

        .log-spinner {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          height: 12px;
          padding: 0 4px;
        }

        .log-spinner span {
          width: 4px;
          height: 4px;
          border-radius: 999px;
          background: rgba(45, 212, 191, 0.8);
          animation: chat-pulse 1s ease-in-out infinite;
        }

        .log-spinner span:nth-child(2) { animation-delay: 0.15s; }
        .log-spinner span:nth-child(3) { animation-delay: 0.3s; }

        @keyframes chat-pulse {
          0%, 100% { transform: translateY(0); opacity: 0.3; }
          50% { transform: translateY(-3px); opacity: 1; }
        }

        /* ── Input area ── */

        .chat-input {
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 12px 16px 16px;
          border-top: 1px solid var(--border-default);
          background: var(--bg-base);
          position: sticky;
          bottom: 0;
          z-index: 2;
          min-width: 0;
        }

        .chat-controls {
          display: flex;
          gap: 8px;
          align-items: flex-end;
          width: 100%;
          min-width: 0;
        }

        .context-usage {
          align-self: flex-end;
          color: var(--text-muted);
          font-size: 11px;
        }

        .chat-file-input {
          display: none;
        }

        .attach-btn {
          width: 36px;
          height: 36px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 8px;
          border: 1px solid var(--border-default);
          background: transparent;
          color: var(--text-tertiary);
          cursor: pointer;
        }

        .attach-btn svg {
          width: 18px;
          height: 18px;
        }

        .attach-btn:hover { background: rgba(255, 255, 255, 0.04); color: var(--text-secondary); }

        .attach-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .chat-input textarea {
          flex: 1;
          min-width: 0;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid var(--border-default);
          border-radius: 8px;
          padding: 12px 14px;
          color: var(--text-primary);
          font-size: 13px;
          font-family: inherit;
          outline: none;
          resize: none;
          min-height: 44px;
          line-height: 20px;
        }

        .chat-input textarea:focus {
          border-color: var(--bg-raised);
          background: rgba(255, 255, 255, 0.04);
        }

        .chat-input textarea:disabled {
          opacity: 0.4;
        }

        .chat-input .send-btn {
          background: #3b82f6;
          border: none;
          border-radius: 8px;
          padding: 10px 16px;
          color: #fff;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          flex: 0 0 auto;
        }

        .chat-input .send-btn:hover { background: #2563eb; }

        .chat-input .send-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .chat-input .stop-btn {
          background: #e53935;
          color: #fff;
          border: none;
          border-radius: 8px;
          padding: 10px 16px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 500;
          flex: 0 0 auto;
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }

        .chat-input .stop-btn:hover { background: #c62828; }

        .chat-input .stop-btn.stopping {
          opacity: 0.75;
          cursor: wait;
        }

        .chat-input .stop-btn.stopping::before {
          content: "";
          width: 12px;
          height: 12px;
          border: 2px solid rgba(255, 255, 255, 0.8);
          border-top-color: transparent;
          border-radius: 999px;
          animation: stop-btn-spin 0.8s linear infinite;
        }

        @keyframes stop-btn-spin {
          to { transform: rotate(360deg); }
        }

        /* ── Attachments ── */

        .chat-attachments {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          padding: 8px 16px 0;
        }

        .attachment-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 10px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid var(--border-default);
          max-width: 180px;
        }

        .attachment-name {
          font-size: 12px;
          color: var(--text-secondary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .attachment-remove {
          border: none;
          background: none;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 12px;
          padding: 0;
        }

        .attachment-remove:hover { color: #f5b0b0; }

        /* ── Fullscreen overrides ── */

        .agent-chat.fullscreen .chat-header h3 {
          font-size: 16px;
          font-weight: 700;
        }

        .agent-chat.fullscreen .chat-input {
          padding-bottom: 20px;
        }

        .log-empty {
          color: var(--text-muted);
          font-size: 13px;
          padding: 4px 0;
        }

        /* ── Subagent Run Cards ── */

        .subagent-run-card {
          background: var(--subagent-bg);
          border-left: 3px solid var(--subagent-border);
          border-radius: 0 8px 8px 0;
          margin: 4px 0;
        }

        .subagent-run-card .subagent-run-content {
          display: none;
        }

        .subagent-run-card.open .subagent-run-content {
          display: flex;
        }

        .subagent-run-header {
          width: 100%;
          border: none;
          background: none;
          color: inherit;
          text-align: left;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 12px;
          cursor: pointer;
          user-select: none;
        }

        .subagent-fork-icon {
          color: var(--subagent-text);
          font-size: 16px;
          flex-shrink: 0;
        }

        .subagent-run-info {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .subagent-run-title {
          font-weight: 600;
          font-size: 12px;
          color: var(--subagent-text);
        }

        .subagent-run-desc {
          font-size: 12px;
          color: var(--text-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .subagent-run-badge {
          font-size: 11px;
          color: var(--text-muted);
          background: rgba(124, 58, 237, 0.1);
          padding: 2px 8px;
          border-radius: 999px;
          flex-shrink: 0;
        }

        .subagent-run-chevron {
          color: var(--text-muted);
          font-size: 10px;
          flex-shrink: 0;
        }

        .subagent-run-content {
          padding: 4px 12px 12px 24px;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .subagent-run-content .log-line {
          font-size: 13px;
        }

        .subagent-run-content .log-line + .log-line {
          border-top: 1px solid rgba(124, 58, 237, 0.08);
        }

        /* ── Subagent Filter Toggle ── */

        .subagent-filter-bar {
          display: flex;
          justify-content: flex-end;
          padding: 0 0 8px;
        }

        .subagent-filter-toggle {
          background: var(--bg-overlay);
          border: 1px solid var(--border-subtle);
          color: var(--text-secondary);
          border-radius: 999px;
          padding: 4px 12px;
          font-size: 11px;
          cursor: pointer;
          transition: background 0.15s, color 0.15s;
        }

        .subagent-filter-toggle:hover {
          background: rgba(124, 58, 237, 0.08);
        }

        .subagent-filter-toggle.active {
          background: rgba(124, 58, 237, 0.15);
          border-color: var(--subagent-border);
          color: var(--subagent-text);
        }
      `}</style>
    </div>
  );
}
