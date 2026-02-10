import {
  Show,
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
    status?: SubagentStatus;
  };
  onBack: () => void;
  onOpenProject?: (id: string) => void;
  fullscreen?: boolean;
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
    | "error";
  title?: string;
  body: string;
  collapsible?: boolean;
};

// Local UI state for file attachments (before upload)
type PendingFile = {
  id: string;
  file: File;
  name: string;
};

const supportedImageTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/jpg",
]);
const supportedImageExtensions = new Set(["jpg", "jpeg", "png", "gif", "webp"]);

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
      entries.push(toLogItem(event));
    }
  }

  return entries;
}

function renderLogItem(item: LogItem) {
  const useMarkdown = item.tone === "assistant" || item.tone === "user";
  if (item.collapsible) {
    const summaryText = item.title ?? item.body.split("\n")[0] ?? "Details";
    return (
      <details class={`log-line ${item.tone} collapsible`} open={false}>
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
    <div class={`log-line ${item.tone}`}>
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
      ? [...base, ...remaining.map((text) => ({ tone: "user", body: text }))]
      : base;
  return { merged, remaining };
}

export function AgentChat(props: AgentChatProps) {
  const [input, setInput] = createSignal("");
  const [error, setError] = createSignal("");
  const [pendingFiles, setPendingFiles] = createSignal<PendingFile[]>([]);
  const [aihubLogs, setAihubLogs] = createSignal<LogItem[]>([]);
  const [aihubLive, setAihubLive] = createSignal("");
  const [aihubStreaming, setAihubStreaming] = createSignal(false);
  const [aihubPending, setAihubPending] = createSignal(false);
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
  const [isAtBottom, setIsAtBottom] = createSignal(true);
  const streamingToolCalls = new Map<
    string,
    { index: number; name: string; args: Record<string, unknown> }
  >();
  const SCROLL_THRESHOLD = 40;

  let streamCleanup: (() => void) | null = null;
  let subscriptionCleanup: (() => void) | null = null;
  let pollInterval: number | null = null;
  let logPaneRef: HTMLDivElement | undefined;
  let textareaRef: HTMLTextAreaElement | undefined;
  let fileInputRef: HTMLInputElement | undefined;

  const sessionKey = createMemo(() =>
    props.agentId ? getSessionKey(props.agentId) : "main"
  );
  const cliTokens = new Set(["claude", "codex", "droid", "gemini"]);
  const canSendLead = createMemo(
    () => props.agentType === "lead" && props.agentId && !aihubStreaming()
  );
  const canSendSubagent = createMemo(
    () =>
      props.agentType === "subagent" &&
      props.subagentInfo &&
      props.subagentInfo.cli &&
      props.subagentInfo.status !== "running" &&
      !subagentSending()
  );
  const canAttach = createMemo(
    () => props.agentType === "lead" && Boolean(props.agentId)
  );

  onMount(() => {
    resizeTextarea("");
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

  const setupSubagent = () => {
    if (!props.subagentInfo) return;
    let activeSlug = props.subagentInfo.slug;
    const resolveSlug = async () => {
      if (!cliTokens.has(activeSlug)) return;
      const res = await fetchSubagents(props.subagentInfo.projectId);
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
      const res = await fetchSubagentLogs(
        props.subagentInfo.projectId,
        activeSlug,
        cliCursor()
      );
      if (!res.ok) return;
      if (res.data.events.length > 0) {
        const next = [...cliLogs(), ...res.data.events];
        setCliLogs(next);
        if (res.data.events.some((event) => event.type !== "user")) {
          setSubagentAwaitingResponse(false);
        }
        if (pendingCliUserMessages().length > 0) {
          const historyUsers = extractCliUserTexts(next);
          let cursor = 0;
          const remaining: string[] = [];
          for (const text of pendingCliUserMessages()) {
            const idx = historyUsers.indexOf(text, cursor);
            if (idx === -1) {
              remaining.push(text);
            } else {
              cursor = idx + 1;
            }
          }
          setPendingCliUserMessages(remaining);
        }
      }
      setCliCursor(res.data.cursor);
    };
    void resolveSlug().then(() => {
      void loadLogs();
      pollInterval = window.setInterval(loadLogs, 2000);
    });
  };

  createEffect(() => {
    void props.agentId;
    void props.agentType;
    void props.subagentInfo?.projectId;
    void props.subagentInfo?.slug;

    setError("");
    setInput("");
    setAihubLogs([]);
    setAihubLive("");
    setAihubStreaming(false);
    setAihubPending(false);
    setPendingFiles([]);
    setPendingAihubUserMessages([]);
    streamingToolCalls.clear();
    setCliLogs([]);
    setCliCursor(0);
    setPendingCliUserMessages([]);
    setSubagentAwaitingResponse(false);
    setSubagentSending(false);
    setIsAtBottom(true);
    if (textareaRef) {
      resizeTextarea("");
    }

    if (streamCleanup) {
      streamCleanup();
      streamCleanup = null;
    }
    if (subscriptionCleanup) {
      subscriptionCleanup();
      subscriptionCleanup = null;
    }
    if (pollInterval) {
      window.clearInterval(pollInterval);
      pollInterval = null;
    }

    if (props.agentType === "lead" && props.agentId) {
      setupLead();
    }

    if (props.agentType === "subagent" && props.subagentInfo) {
      setupSubagent();
    }

    onCleanup(() => {
      if (streamCleanup) streamCleanup();
      if (subscriptionCleanup) subscriptionCleanup();
      if (pollInterval) window.clearInterval(pollInterval);
      streamCleanup = null;
      subscriptionCleanup = null;
      pollInterval = null;
    });
  });

  createEffect(() => {
    aihubLogs();
    aihubLive();
    cliLogs();
    pendingCliUserMessages();
    aihubPending();
    scrollToBottom();
  });

  const handleSend = async () => {
    const text = input().trim();
    if (!text) return;

    if (props.agentType === "subagent") {
      if (!props.subagentInfo || !props.subagentInfo.cli || subagentSending())
        return;
      setSubagentSending(true);
      setError("");
      setPendingCliUserMessages((prev) => [...prev, text]);
      setSubagentAwaitingResponse(true);
      setInput("");
      setPendingFiles([]);
      resizeTextarea("");
      scrollToBottom(true);
      const mode = props.subagentInfo.slug === "main" ? "main-run" : "worktree";
      void spawnSubagent(props.subagentInfo.projectId, {
        slug: props.subagentInfo.slug,
        cli: props.subagentInfo.cli,
        prompt: text,
        mode,
        resume: true,
      }).then((res) => {
        if (!res.ok) {
          setError(res.error);
          setPendingCliUserMessages((prev) => {
            const idx = prev.indexOf(text);
            if (idx === -1) return prev;
            return [...prev.slice(0, idx), ...prev.slice(idx + 1)];
          });
          setSubagentAwaitingResponse(false);
        }
        setSubagentSending(false);
      });
      return;
    }

    if (!props.agentId || aihubStreaming()) return;

    // Upload files first, then send message with paths
    const currentPendingFiles = pendingFiles();
    let fileAttachments: FileAttachment[] = [];
    if (currentPendingFiles.length > 0) {
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

    setPendingAihubUserMessages((prev) => [...prev, text]);
    setAihubLogs((prev) => [...prev, { tone: "user", body: logBody }]);
    setInput("");
    setPendingFiles([]);
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

  const aihubLogItems = createMemo(() => aihubLogs());
  const cliDisplayEvents = createMemo(() => {
    const pending = pendingCliUserMessages();
    if (pending.length === 0) return cliLogs();
    return [...cliLogs(), ...pending.map((text) => ({ type: "user", text }))];
  });
  const cliLogItems = createMemo(() => buildCliLogs(cliDisplayEvents()));

  return (
    <div
      class="agent-chat"
      classList={{ fullscreen: Boolean(props.fullscreen) }}
    >
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
            <Show
              when={aihubLogItems().length > 0}
              fallback={<div class="log-empty">No messages yet.</div>}
            >
              {aihubLogItems().map((item) => renderLogItem(item))}
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
            <Show
              when={cliLogItems().length > 0}
              fallback={<div class="log-empty">No logs yet.</div>}
            >
              {cliLogItems().map((item) => renderLogItem(item))}
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
          <button
            type="button"
            class="send-btn"
            disabled={!canSendLead() && !canSendSubagent()}
            onClick={() => void handleSend()}
          >
            Send
          </button>
        </div>
      </div>

      <style>{`
        .agent-chat {
          display: flex;
          flex-direction: column;
          height: 100%;
          font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif;
        }

        .chat-header {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 16px;
          border-bottom: 1px solid #2a2a2a;
        }

        .chat-header h3 {
          margin: 0;
          font-size: 14px;
          font-weight: 600;
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
          color: #888;
          font-size: 16px;
          cursor: pointer;
        }

        .back-btn:hover {
          color: #fff;
        }

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

        .chat-header .open-project-btn:hover {
          color: #d4dbe5;
        }

        .chat-header .archive-btn {
          margin-left: auto;
        }

        .chat-header .archive-btn:hover {
          color: #f6c454;
        }

        .chat-header .kill-btn {
          background: none;
          border: none;
          padding: 4px;
          cursor: pointer;
          color: #666;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .chat-header .kill-btn:hover {
          color: #e53935;
        }

        .chat-messages {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
          display: flex;
          scroll-behavior: smooth;
        }

        .chat-empty {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #666;
          font-size: 14px;
          text-align: center;
        }

        .chat-error {
          padding: 8px 16px;
          font-size: 12px;
          color: #f5b0b0;
          border-top: 1px solid #2a2a2a;
        }

        .chat-input {
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 16px;
          border-top: 1px solid #2a2a2a;
        }

        .chat-controls {
          display: flex;
          gap: 8px;
          align-items: flex-end;
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
          border: 1px solid #2a2a2a;
          background: #121212;
          color: #cfd6e2;
          cursor: pointer;
        }

        .attach-btn svg {
          width: 18px;
          height: 18px;
        }

        .attach-btn:hover {
          background: #1c1c1c;
        }

        .attach-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .chat-input textarea {
          flex: 1;
          background: #0a0a0a;
          border: 1px solid #2a2a2a;
          border-radius: 8px;
          padding: 12px 14px;
          color: #fff;
          font-size: 13px;
          outline: none;
          resize: none;
          min-height: 44px;
          line-height: 20px;
        }

        .chat-input textarea:focus {
          border-color: #444;
        }

        .chat-input textarea:disabled {
          opacity: 0.5;
        }

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
          padding: 6px 8px;
          border-radius: 999px;
          background: #1b1b1b;
          border: 1px solid #2a2a2a;
          max-width: 180px;
        }

        .attachment-name {
          font-size: 12px;
          color: #cfd6e2;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .attachment-remove {
          border: none;
          background: none;
          color: #888;
          cursor: pointer;
          font-size: 12px;
          padding: 0;
        }

        .attachment-remove:hover {
          color: #f5b0b0;
        }

        .log-line.pending {
          opacity: 0.9;
          align-items: center;
        }

        .log-spinner {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          height: 12px;
          padding: 0 6px;
          border-radius: 999px;
          background: rgba(6, 78, 59, 0.35);
          box-shadow: inset 0 0 0 1px rgba(45, 212, 191, 0.35);
        }

        .log-spinner span {
          width: 4px;
          height: 4px;
          border-radius: 999px;
          background: rgba(45, 212, 191, 0.95);
          box-shadow: 0 0 6px rgba(20, 184, 166, 0.85);
          animation: chat-pulse 1s ease-in-out infinite;
        }

        .log-spinner span:nth-child(2) {
          animation-delay: 0.15s;
        }

        .log-spinner span:nth-child(3) {
          animation-delay: 0.3s;
        }

        @keyframes chat-pulse {
          0%,
          100% {
            transform: translateY(0);
            opacity: 0.4;
          }
          50% {
            transform: translateY(-3px);
            opacity: 1;
          }
        }

        .chat-input .send-btn {
          background: #3b82f6;
          border: none;
          border-radius: 8px;
          padding: 10px 16px;
          color: #fff;
          font-size: 13px;
          cursor: pointer;
        }

        .chat-input .send-btn:hover {
          background: #2563eb;
        }

        .chat-input .send-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .agent-chat.fullscreen .chat-header h3 {
          font-size: 16px;
          font-weight: 700;
        }

        .agent-chat.fullscreen .chat-input {
          padding-bottom: 20px;
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
          font-size: 14px;
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
          line-height: 1.45;
        }

        .log-markdown {
          white-space: normal;
        }

        .log-markdown p {
          margin: 0;
        }

        .log-markdown p + p {
          margin-top: 6px;
        }

        .log-markdown code {
          background: rgba(8, 11, 16, 0.7);
          border-radius: 4px;
          padding: 1px 4px;
          font-family: "SF Mono", "Consolas", monospace;
        }

        .log-markdown pre {
          margin: 6px 0 0;
          padding: 8px;
          background: rgba(8, 11, 16, 0.6);
          border-radius: 8px;
          overflow: auto;
          font-family: "SF Mono", "Consolas", monospace;
        }

        .log-markdown pre code {
          background: transparent;
          padding: 0;
        }

        .log-markdown ul,
        .log-markdown ol {
          margin: 6px 0;
          padding-left: 20px;
        }

        .log-markdown li + li {
          margin-top: 4px;
        }

        .log-markdown hr {
          margin: 8px 0;
          border: 0;
          border-top: 1px solid rgba(255, 255, 255, 0.12);
        }

        .log-empty {
          color: #7f8a9a;
          font-size: 12px;
        }
      `}</style>
    </div>
  );
}
