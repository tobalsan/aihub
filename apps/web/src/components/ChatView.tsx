import {
  createSignal,
  createEffect,
  createResource,
  createMemo,
  For,
  onCleanup,
  Show,
  on,
} from "solid-js";
import { useParams, useNavigate, A } from "@solidjs/router";
import {
  streamMessage,
  uploadFiles,
  getSessionKey,
  fetchSimpleHistory,
  fetchFullHistory,
  fetchAgent,
  fetchAgentStatuses,
  subscribeToSession,
  subscribeToStatus,
  postAbort,
  type DoneMeta,
} from "../api/client";
import type {
  Message,
  HistoryViewMode,
  FullHistoryMessage,
  FullToolResultMessage,
  ContentBlock,
  FileAttachment,
  FileBlock,
  ModelMeta,
  ActiveToolCall,
  ThinkLevel,
} from "../api/types";
import { formatTimestamp } from "../lib/format";
import { extractBlockText } from "../lib/history";
import { renderMarkdown } from "../lib/markdown";
import { isComponentEnabled } from "../lib/capabilities";
import { getMaxContextTokens } from "@aihub/shared/model-context";

// Threshold for auto-collapsing content
const COLLAPSE_THRESHOLD = 200;
const MAX_UPLOAD_SIZE_BYTES = 25 * 1024 * 1024;
const ACCEPTED_FILE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
].join(",");
const SUPPORTED_FILE_TYPES = new Set(ACCEPTED_FILE_TYPES.split(","));
const SUPPORTED_FILE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "svg",
  "pdf",
  "txt",
  "md",
  "markdown",
  "csv",
  "doc",
  "docx",
  "xls",
  "xlsx",
]);
const FILE_INPUT_ACCEPT = [
  ACCEPTED_FILE_TYPES,
  ...Array.from(SUPPORTED_FILE_EXTENSIONS, (ext) => `.${ext}`),
].join(",");

type PendingFile = {
  id: string;
  file: File;
  name: string;
  mimeType: string;
  size: number;
  previewUrl?: string;
};

function isLongContent(content: string): boolean {
  return content.length > COLLAPSE_THRESHOLD;
}

function formatFileSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "";
  if (size < 1024) return `${size} B`;
  const kb = size / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}

function isSupportedFile(file: File): boolean {
  if (SUPPORTED_FILE_TYPES.has(file.type)) return true;
  const ext = file.name.toLowerCase().split(".").pop();
  return ext ? SUPPORTED_FILE_EXTENSIONS.has(ext) : false;
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

function getFileIcon(mimeType: string): string {
  if (mimeType.startsWith("image/")) return "IMG";
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType.includes("word")) return "DOC";
  if (mimeType.includes("excel") || mimeType.includes("spreadsheet"))
    return "XLS";
  if (mimeType === "text/csv") return "CSV";
  if (mimeType === "text/markdown") return "MD";
  return "FILE";
}

function getAttachmentFileId(attachment: FileAttachment): string {
  const name = attachment.path.split(/[\\/]/).pop() ?? attachment.path;
  return name.replace(/\.[^.]+$/, "");
}

function attachmentToFileBlock(
  attachment: FileAttachment,
  pending?: PendingFile
): FileBlock {
  return {
    type: "file",
    fileId: getAttachmentFileId(attachment),
    filename:
      pending?.name ??
      attachment.filename ??
      attachment.path.split(/[\\/]/).pop() ??
      "file",
    mimeType: pending?.mimeType || attachment.mimeType,
    size: pending?.size ?? 0,
    direction: "inbound",
  };
}

function formatJson(args: unknown): string {
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

// Collapsible block component
function CollapsibleBlock(props: {
  title: string;
  content: string;
  defaultCollapsed?: boolean;
  isError?: boolean;
  mono?: boolean;
  timestamp?: number;
}) {
  const shouldCollapse = props.defaultCollapsed ?? isLongContent(props.content);
  const [collapsed, setCollapsed] = createSignal(shouldCollapse);

  return (
    <div class={`collapsible-block ${props.isError ? "error" : ""}`}>
      <button
        class="collapse-header"
        onClick={() => setCollapsed(!collapsed())}
      >
        <span class="collapse-icon">{collapsed() ? "▶" : "▼"}</span>
        <span class="collapse-title">{props.title}</span>
        {collapsed() && (
          <span class="collapse-hint">{props.content.slice(0, 50)}...</span>
        )}
      </button>
      <Show when={!collapsed()}>
        <div class={`collapse-content ${props.mono ? "mono" : ""}`}>
          {props.content}
        </div>
      </Show>
      {props.timestamp && (
        <div class="block-time">{formatTimestamp(props.timestamp)}</div>
      )}
    </div>
  );
}

// Render a tool result inline
function ToolResultDisplay(props: { result: FullToolResultMessage }) {
  const textContent = props.result.content
    .filter((b) => b.type === "text")
    .map((b) => extractBlockText((b as { text: unknown }).text))
    .join("\n");

  return (
    <div class={`tool-result-inline ${props.result.isError ? "error" : ""}`}>
      <CollapsibleBlock
        title={`${props.result.isError ? "✗" : "✓"} ${props.result.toolName}`}
        content={textContent || "(no output)"}
        defaultCollapsed={isLongContent(textContent)}
        isError={props.result.isError}
        mono={true}
      />
      {props.result.details?.diff && (
        <CollapsibleBlock
          title="Diff"
          content={props.result.details.diff}
          defaultCollapsed={true}
          mono={true}
        />
      )}
    </div>
  );
}

// Render content blocks for full mode
function ContentBlocks(props: {
  blocks: ContentBlock[];
  timestamp?: number;
  toolResultsMap?: Map<string, FullToolResultMessage>;
}) {
  return (
    <div class="content-blocks">
      <For each={props.blocks}>
        {(block) => {
          if (block.type === "text") {
            return (
              <div
                class="block-text markdown-content"
                innerHTML={renderMarkdown(block.text)}
              />
            );
          }
          if (block.type === "thinking") {
            return (
              <CollapsibleBlock
                title="Thinking"
                content={block.thinking}
                defaultCollapsed={true}
                timestamp={props.timestamp}
              />
            );
          }
          if (block.type === "toolCall") {
            const argsStr = formatJson(block.arguments);
            const result = props.toolResultsMap?.get(block.id);
            return (
              <div class="tool-call-group">
                <CollapsibleBlock
                  title={`Tool: ${block.name}`}
                  content={argsStr}
                  defaultCollapsed={isLongContent(argsStr)}
                  mono={true}
                  timestamp={props.timestamp}
                />
                {result && <ToolResultDisplay result={result} />}
              </div>
            );
          }
          if (block.type === "file") {
            return <FileCard file={block} />;
          }
          return null;
        }}
      </For>
    </div>
  );
}

function FileAttachmentList(props: { files?: FileBlock[] }) {
  return (
    <Show when={props.files && props.files.length > 0}>
      <div class="message-files">
        <For each={props.files ?? []}>
          {(file) => (
            <div class="message-file-pill">
              <span class="file-icon">{getFileIcon(file.mimeType)}</span>
              <span class="file-name" title={file.filename}>
                {file.filename}
              </span>
              <Show when={formatFileSize(file.size)}>
                {(size) => <span class="file-size">{size()}</span>}
              </Show>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}

function FileCard(props: { file: FileBlock }) {
  const href = () => `/api/media/download/${props.file.fileId}`;
  return (
    <div class={`file-card ${props.file.direction}`}>
      <span class="file-icon">{getFileIcon(props.file.mimeType)}</span>
      <div class="file-card-body">
        <div class="file-card-name" title={props.file.filename}>
          {props.file.filename}
        </div>
        <div class="file-card-meta">
          {[props.file.mimeType, formatFileSize(props.file.size)]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </div>
      <Show when={props.file.direction === "outbound"}>
        <a class="file-download" href={href()} download>
          Download
        </a>
      </Show>
    </div>
  );
}

// Model meta display
function ModelMetaDisplay(props: { meta: ModelMeta }) {
  const usage = props.meta.usage;
  return (
    <div class="model-meta">
      <span class="meta-model">{props.meta.model ?? "unknown"}</span>
      {usage && (
        <span class="meta-tokens">
          {usage.input}→{usage.output} tok
        </span>
      )}
    </div>
  );
}

// Active tool indicator during streaming
function ActiveToolIndicator(props: { tools: ActiveToolCall[] }) {
  return (
    <div class="active-tools">
      <For each={props.tools}>
        {(tool) => (
          <div class={`active-tool ${tool.status}`}>
            <span class="tool-icon">
              {tool.status === "running"
                ? "⟳"
                : tool.status === "error"
                  ? "✗"
                  : "✓"}
            </span>
            <span class="tool-name">{tool.toolName}</span>
          </div>
        )}
      </For>
    </div>
  );
}

export function ChatView() {
  const params = useParams<{ agentId: string; view?: string }>();
  const navigate = useNavigate();
  const [agent] = createResource(() => params.agentId, fetchAgent);

  const viewMode = createMemo<HistoryViewMode>(() =>
    params.view === "full" ? "full" : "simple"
  );
  const [simpleMessages, setSimpleMessages] = createSignal<Message[]>([]);
  const [fullMessages, setFullMessages] = createSignal<FullHistoryMessage[]>(
    []
  );
  const [thinkingLevel, setThinkingLevel] = createSignal<
    ThinkLevel | undefined
  >();
  const [pendingThinkLevel, setPendingThinkLevel] =
    createSignal<ThinkLevel | null>(null);
  const [input, setInput] = createSignal("");
  const [pendingFiles, setPendingFiles] = createSignal<PendingFile[]>([]);
  const [uploadingFiles, setUploadingFiles] = createSignal(false);
  const [uploadError, setUploadError] = createSignal("");
  const [stopping, setStopping] = createSignal(false);
  const [showInterrupted, setShowInterrupted] = createSignal(false);
  const [isStreaming, setIsStreaming] = createSignal(false);
  const [streamingThinking, setStreamingThinking] = createSignal("");
  const [streamingThinkingAt, setStreamingThinkingAt] = createSignal<
    number | null
  >(null);
  const [streamingToolCalls, setStreamingToolCalls] = createSignal<
    Array<{
      id: string;
      name: string;
      arguments: unknown;
      status: "running" | "done" | "error";
      timestamp: number;
    }>
  >([]);
  const [streamingText, setStreamingText] = createSignal("");
  const [streamingFiles, setStreamingFiles] = createSignal<FileBlock[]>([]);
  const [streamingTextAt, setStreamingTextAt] = createSignal<number | null>(
    null
  );
  const [streamingStartedAt, setStreamingStartedAt] = createSignal<
    number | null
  >(null);
  const [activeTools, setActiveTools] = createSignal<ActiveToolCall[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [pendingHistoryRefresh, setPendingHistoryRefresh] = createSignal(false);
  const [pendingQueuedMessages, setPendingQueuedMessages] = createSignal<
    Array<{ text: string; timestamp: number; files?: FileBlock[] }>
  >([]);
  const [contextFullMessages, setContextFullMessages] = createSignal<
    FullHistoryMessage[]
  >([]);

  let messagesEndRef: HTMLDivElement | undefined;
  let messagesContainerRef: HTMLDivElement | undefined;
  let textareaRef: HTMLTextAreaElement | undefined;
  let fileInputRef: HTMLInputElement | undefined;
  let cleanup: (() => void) | null = null;
  let subscriptionCleanup: (() => void) | null = null;
  let aborted = false;

  const sessionKey = () => getSessionKey(params.agentId);

  const isOAuth = () => agent()?.authMode === "oauth";

  // Build a map of toolCallId -> toolResult for grouping tool calls with their results
  const toolResultsMap = createMemo(() => {
    const map = new Map<string, FullToolResultMessage>();
    for (const msg of fullMessages()) {
      if (msg.role === "toolResult") {
        map.set(msg.toolCallId, msg);
      }
    }
    return map;
  });

  const estimatedContextUsagePct = createMemo(() => {
    let highestInputTokens = 0;
    let modelName: string | undefined;
    const messages =
      viewMode() === "full" ? fullMessages() : contextFullMessages();
    for (const message of messages) {
      if (message.role !== "assistant") continue;
      const meta = message.meta;
      if (meta?.model) modelName = meta.model;
      const rawUsage = meta?.usage;
      if (!rawUsage) continue;
      const inputTokens =
        (typeof rawUsage.input === "number" ? rawUsage.input : 0) +
        (typeof rawUsage.cacheRead === "number" ? rawUsage.cacheRead : 0) +
        (typeof rawUsage.cacheWrite === "number" ? rawUsage.cacheWrite : 0);
      if (inputTokens > highestInputTokens) highestInputTokens = inputTokens;
    }
    const maxTokens = getMaxContextTokens(modelName);
    if (maxTokens <= 0 || highestInputTokens <= 0) return 0;
    const rawPct = (highestInputTokens / maxTokens) * 100;
    if (rawPct > 0 && rawPct < 1) return 1;
    return Math.max(0, Math.min(100, Math.round(rawPct)));
  });

  const contextUsageDisplay = createMemo(() => {
    const pct = estimatedContextUsagePct();
    if (pct > 0) {
      return { text: `~${pct}% context used`, unavailable: false };
    }
    return null;
  });

  const contextWarning = createMemo(() => {
    const pct = estimatedContextUsagePct();
    if (pct >= 80) {
      return `Context usage is high (~${pct}%). Consider wrapping up this conversation or creating a handoff document to continue in a new session.`;
    }
    return null;
  });

  const [isAtBottom, setIsAtBottom] = createSignal(true);
  const SCROLL_THRESHOLD = 40;

  const checkIsAtBottom = () => {
    if (!messagesContainerRef) return true;
    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef;
    return scrollHeight - scrollTop - clientHeight <= SCROLL_THRESHOLD;
  };

  const handleScroll = () => {
    setIsAtBottom(checkIsAtBottom());
  };

  const scrollToBottom = (force = false) => {
    if (force || isAtBottom()) {
      messagesEndRef?.scrollIntoView({ behavior: "smooth" });
    }
  };

  const resizeTextarea = () => {
    if (!textareaRef) return;
    textareaRef.style.height = "auto";
    const lineHeight = 22;
    const maxHeight = lineHeight * 10;
    textareaRef.style.height = `${Math.min(textareaRef.scrollHeight, maxHeight)}px`;
  };

  const revokePendingFile = (item: PendingFile) => {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  };

  const clearPendingFiles = () => {
    setPendingFiles((prev) => {
      prev.forEach(revokePendingFile);
      return [];
    });
  };

  const addPendingFiles = (files: FileList | File[]) => {
    setUploadError("");
    const next: PendingFile[] = [];
    for (const file of Array.from(files)) {
      if (!isSupportedFile(file)) {
        setUploadError(`Unsupported file type: ${file.name}`);
        continue;
      }
      if (file.size > MAX_UPLOAD_SIZE_BYTES) {
        setUploadError(`File exceeds 25 MB: ${file.name}`);
        continue;
      }
      next.push({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        file,
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        previewUrl: isImageFile(file) ? URL.createObjectURL(file) : undefined,
      });
    }
    if (next.length > 0) {
      setPendingFiles((prev) => [...prev, ...next]);
    }
  };

  const removePendingFile = (id: string) => {
    setPendingFiles((prev) => {
      const removed = prev.find((item) => item.id === id);
      if (removed) revokePendingFile(removed);
      return prev.filter((item) => item.id !== id);
    });
  };

  const handleFileDragOver = (event: DragEvent) => {
    event.preventDefault();
  };

  const handleFileDrop = (event: DragEvent) => {
    event.preventDefault();
    if (isStreaming()) {
      setUploadError("Wait for the current response before attaching files.");
      return;
    }
    const files = event.dataTransfer?.files;
    if (!files || files.length === 0) return;
    addPendingFiles(files);
  };

  onCleanup(clearPendingFiles);

  // Load history based on view mode
  const loadHistory = async (mode: HistoryViewMode) => {
    setLoading(true);
    if (mode === "full") {
      const res = await fetchFullHistory(params.agentId, sessionKey());
      const baseMessages = [...res.messages];
      if (res.activeTurn?.userText) {
        baseMessages.push({
          role: "user",
          content: [{ type: "text", text: res.activeTurn.userText }],
          timestamp: res.activeTurn.userTimestamp,
        });
      }
      const pending = pendingQueuedMessages();
      const merged = pending.length
        ? [
            ...baseMessages,
            ...pending.map((msg) => ({
              role: "user" as const,
              content: [
                { type: "text" as const, text: msg.text },
                ...(msg.files ?? []),
              ],
              timestamp: msg.timestamp,
            })),
          ]
        : baseMessages;
      setFullMessages(merged);
      setContextFullMessages(res.messages);
      if (res.thinkingLevel) setThinkingLevel(res.thinkingLevel);
      applyActiveTurn(res.isStreaming ?? false, res.activeTurn ?? null);
    } else {
      const res = await fetchSimpleHistory(params.agentId, sessionKey());
      const base = res.messages.map((h) => ({
        id: crypto.randomUUID(),
        role: h.role,
        content: h.content,
        files: h.files,
        timestamp: h.timestamp,
      }));
      if (res.activeTurn?.userText) {
        base.push({
          id: crypto.randomUUID(),
          role: "user",
          content: res.activeTurn.userText,
          timestamp: res.activeTurn.userTimestamp,
        });
      }
      const pending = pendingQueuedMessages();
      const merged = pending.length
        ? [
            ...base,
            ...pending.map((msg) => ({
              id: crypto.randomUUID(),
              role: "user" as const,
              content: msg.text,
              files: msg.files,
              timestamp: msg.timestamp,
            })),
          ]
        : base;
      setSimpleMessages(merged);
      if (res.thinkingLevel) setThinkingLevel(res.thinkingLevel);
      applyActiveTurn(res.isStreaming ?? false, res.activeTurn ?? null);
    }
    setLoading(false);
  };

  const applyActiveTurnSnapshot = (
    turn: import("../api/client").ActiveTurn
  ) => {
    setIsStreaming(true);
    setStreamingStartedAt(turn.startedAt ?? Date.now());
    setStreamingThinking(turn.thinking ?? "");
    setStreamingThinkingAt(turn.thinking ? turn.startedAt : null);
    setStreamingText(turn.text ?? "");
    setStreamingTextAt(turn.text ? turn.startedAt : null);
    setStreamingToolCalls(
      (turn.toolCalls ?? []).map((tc) => ({
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments,
        status: tc.status,
        timestamp: turn.startedAt,
      }))
    );
    setActiveTools(
      (turn.toolCalls ?? []).map((tc) => ({
        id: tc.id || crypto.randomUUID(),
        toolName: tc.name,
        status: tc.status,
      }))
    );
    // Ensure the user message that triggered the active run is visible
    // even before the persisted history is re-fetched.
    if (turn.userText) {
      const userText = turn.userText;
      const timestamp = turn.userTimestamp;
      setSimpleMessages((prev) =>
        prev.some((m) => m.timestamp === timestamp && m.role === "user")
          ? prev
          : [
              ...prev,
              {
                id: crypto.randomUUID(),
                role: "user",
                content: userText,
                timestamp,
              },
            ]
      );
      setFullMessages((prev) =>
        prev.some((m) => m.timestamp === timestamp && m.role === "user")
          ? prev
          : [
              ...prev,
              {
                role: "user",
                content: [{ type: "text", text: userText }],
                timestamp,
              },
            ]
      );
    }
  };

  const applyActiveTurn = (
    streaming: boolean,
    turn: import("../api/client").ActiveTurn | null
  ) => {
    if (!streaming || !turn) return;
    if (cleanup) return;
    applyActiveTurnSnapshot(turn);
  };

  // Load history when agent is loaded or view mode changes.
  // Do not track isStreaming here: reloading on stream end can wipe optimistic
  // user/error messages for failed runs before history is persisted.
  createEffect(
    on([agent, viewMode], ([currentAgent, mode]) => {
      if (currentAgent) void loadHistory(mode);
    })
  );

  // In simple view, also fetch full history in background for context estimation
  createEffect(() => {
    const mode = viewMode();
    const currentAgent = agent();
    if (mode === "simple" && currentAgent) {
      fetchFullHistory(params.agentId, sessionKey())
        .then((res) => {
          setContextFullMessages(res.messages);
        })
        .catch(() => {});
    }
  });

  // Subscribe to live updates for background runs
  createEffect(() => {
    const agentId = params.agentId;
    const key = sessionKey();
    if (!agentId) return;

    subscriptionCleanup?.();
    subscriptionCleanup = subscribeToSession(agentId, key, {
      onText: (chunk) => {
        if (cleanup) return;
        setStreamingText((prev) => prev + chunk);
        if (!streamingTextAt()) setStreamingTextAt(Date.now());
        if (!streamingStartedAt()) setStreamingStartedAt(Date.now());
        setIsStreaming(true);
      },
      onThinking: (chunk) => {
        if (cleanup) return;
        setStreamingThinking((prev) => prev + chunk);
        if (!streamingThinkingAt()) setStreamingThinkingAt(Date.now());
        if (!streamingStartedAt()) setStreamingStartedAt(Date.now());
        setIsStreaming(true);
      },
      onToolCall: (id, name, args) => {
        if (cleanup) return;
        setStreamingToolCalls((prev) => {
          if (prev.some((tc) => tc.id === id)) return prev;
          return [
            ...prev,
            {
              id,
              name,
              arguments: args,
              status: "running",
              timestamp: Date.now(),
            },
          ];
        });
        if (!streamingStartedAt()) setStreamingStartedAt(Date.now());
        setIsStreaming(true);
      },
      onToolStart: (toolName) => {
        if (cleanup) return;
        setActiveTools((prev) =>
          prev.some((t) => t.toolName === toolName && t.status === "running")
            ? prev
            : [
                ...prev,
                { id: crypto.randomUUID(), toolName, status: "running" },
              ]
        );
      },
      onToolEnd: (toolName, isError) => {
        if (cleanup) return;
        setActiveTools((prev) =>
          prev.map((t) =>
            t.toolName === toolName && t.status === "running"
              ? { ...t, status: isError ? "error" : "done" }
              : t
          )
        );
        setStreamingToolCalls((prev) =>
          prev.map((tc) =>
            tc.name === toolName && tc.status === "running"
              ? { ...tc, status: isError ? "error" : "done" }
              : tc
          )
        );
      },
      onFileOutput: (file) => {
        if (cleanup) return;
        setStreamingFiles((prev) => [
          ...prev,
          { type: "file", direction: "outbound", ...file },
        ]);
        if (!streamingStartedAt()) setStreamingStartedAt(Date.now());
        setIsStreaming(true);
      },
      onDone: () => {
        if (cleanup) return;
        resetStreamingState();
      },
      onActiveTurn: (turn) => {
        if (cleanup) return;
        applyActiveTurnSnapshot(turn);
      },
      onHistoryUpdated: () => {
        // Refetch history when background run completes
        if (!isStreaming()) {
          if (pendingQueuedMessages().length > 0) {
            setPendingQueuedMessages((prev) => prev.slice(1));
          }
          loadHistory(viewMode());
          setPendingHistoryRefresh(false);
        } else {
          setPendingHistoryRefresh(true);
        }
      },
    });
  });

  // On mount, check if the agent is already running (e.g. after page refresh)
  // and subscribe to status changes to track when runs start/finish.
  let statusCleanup: (() => void) | null = null;
  createEffect(() => {
    const agentId = params.agentId;
    if (!agentId) return;

    statusCleanup?.();

    // Check current status immediately
    fetchAgentStatuses()
      .then((res) => {
        if (res.statuses[agentId] === "streaming" && !isStreaming()) {
          setIsStreaming(true);
          setStreamingStartedAt(Date.now());
        }
      })
      .catch(() => {
        /* ignore */
      });

    // Subscribe to real-time status changes
    statusCleanup = subscribeToStatus({
      onStatus: (id, status) => {
        if (id !== agentId) return;
        if (status === "streaming" && !isStreaming()) {
          setIsStreaming(true);
          setStreamingStartedAt(Date.now());
        } else if (status === "idle" && isStreaming() && !cleanup) {
          // Agent went idle and we're not the ones streaming (no active cleanup)
          // This means a background/reconnected run finished
          resetStreamingState();
          loadHistory(viewMode());
        }
      },
      onReconnect: () => {
        // Re-check status after reconnect
        fetchAgentStatuses()
          .then((res) => {
            if (res.statuses[agentId] === "streaming" && !isStreaming()) {
              setIsStreaming(true);
              setStreamingStartedAt(Date.now());
            } else if (
              res.statuses[agentId] !== "streaming" &&
              isStreaming() &&
              !cleanup
            ) {
              resetStreamingState();
              loadHistory(viewMode());
            }
          })
          .catch(() => {
            /* ignore */
          });
      },
    });
  });

  createEffect(() => {
    simpleMessages();
    fullMessages();
    streamingText();
    streamingFiles();
    activeTools();
    scrollToBottom();
  });

  onCleanup(() => {
    cleanup?.();
    subscriptionCleanup?.();
    statusCleanup?.();
  });

  const handleViewChange = (mode: HistoryViewMode) => {
    if (mode !== viewMode()) {
      const path =
        mode === "full"
          ? `/chat/${params.agentId}/full`
          : `/chat/${params.agentId}`;
      navigate(path, { replace: true });
    }
  };

  // Helper to reset streaming state (used by onDone and onError)
  const resetStreamingState = () => {
    setStreamingThinking("");
    setStreamingThinkingAt(null);
    setStreamingToolCalls([]);
    setStreamingText("");
    setStreamingFiles([]);
    setStreamingTextAt(null);
    setActiveTools([]);
    setIsStreaming(false);
    setStreamingStartedAt(null);
  };

  const maybeRefreshHistory = () => {
    if (pendingQueuedMessages().length > 0) return;
    if (pendingHistoryRefresh()) {
      loadHistory(viewMode());
      setPendingHistoryRefresh(false);
    }
  };

  // Check if stream has any content (used to guard against wiping real stream)
  const hasStreamingContent = () =>
    streamingText() ||
    streamingThinking() ||
    streamingToolCalls().length > 0 ||
    streamingFiles().length > 0;

  const handleSend = async () => {
    const text = input().trim();
    const currentPendingFiles = pendingFiles();
    const hasFiles = currentPendingFiles.length > 0;
    if ((!text && !hasFiles) || loading() || uploadingFiles()) return;
    if (isStreaming() && hasFiles) {
      setUploadError("Wait for the current response before attaching files.");
      return;
    }

    // Treat /stop as an interrupt
    if (text === "/stop") {
      setInput("");
      if (textareaRef) textareaRef.style.height = "auto";
      handleStop();
      return;
    }

    let attachments: FileAttachment[] | undefined;
    let inboundFiles: FileBlock[] = [];
    if (hasFiles) {
      setUploadingFiles(true);
      setUploadError("");
      try {
        attachments = await uploadFiles(
          currentPendingFiles.map((item) => item.file)
        );
        inboundFiles = attachments.map((attachment, index) =>
          attachmentToFileBlock(attachment, currentPendingFiles[index])
        );
        clearPendingFiles();
      } catch (error) {
        setUploadError(
          error instanceof Error ? error.message : "File upload failed"
        );
        setUploadingFiles(false);
        return;
      }
      setUploadingFiles(false);
    }

    const messageText = text || "Attached file(s).";
    const levelToSend = pendingThinkLevel() ?? thinkingLevel();
    const currentAgent = agent();
    const queueMode = currentAgent?.queueMode ?? "queue";
    const streamOptions = {
      ...(attachments?.length ? { attachments } : {}),
      ...(levelToSend ? { thinkLevel: levelToSend } : {}),
    };

    // Add user message to both views
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: messageText,
      files: inboundFiles.length > 0 ? inboundFiles : undefined,
      timestamp: Date.now(),
    };
    setShowInterrupted(false);
    setSimpleMessages((prev) => [...prev, userMsg]);
    setFullMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: [{ type: "text", text: messageText }, ...inboundFiles],
        timestamp: Date.now(),
      },
    ]);

    setInput("");
    if (textareaRef) textareaRef.style.height = "auto";
    scrollToBottom(true);
    setIsAtBottom(true);

    // If streaming in queue mode, send message without interrupting current stream
    if (isStreaming() && queueMode === "queue") {
      const sdkId = currentAgent?.sdk ?? "pi";
      const trackSequentialQueue = sdkId === "claude" || sdkId === "openclaw";
      if (trackSequentialQueue) {
        setPendingQueuedMessages((prev) => [
          ...prev,
          {
            text: messageText,
            files: inboundFiles.length > 0 ? inboundFiles : undefined,
            timestamp: Date.now(),
          },
        ]);
      }
      let queuedText = "";
      let queuedThinking = "";
      const queuedFiles: FileBlock[] = [];
      const queuedToolCalls: Array<{
        id: string;
        name: string;
        arguments: unknown;
        status: "running" | "done" | "error";
        timestamp: number;
      }> = [];

      // Send queued message with minimal handlers (queue ack doesn't affect streaming state)
      const queueCleanup = streamMessage(
        params.agentId,
        messageText,
        sessionKey(),
        (chunk) => {
          queuedText += chunk;
        },
        (meta?: DoneMeta) => {
          if (meta?.queued) {
            if (queueCleanup) queueCleanup();
            return;
          }

          if (trackSequentialQueue) {
            setPendingQueuedMessages((prev) =>
              prev.length ? prev.slice(0, -1) : prev
            );
          }

          const blocks: ContentBlock[] = [];
          if (queuedThinking) {
            blocks.push({ type: "thinking", thinking: queuedThinking });
          }
          for (const tc of queuedToolCalls) {
            blocks.push({
              type: "toolCall",
              id: tc.id,
              name: tc.name,
              arguments: tc.arguments,
            });
          }
          if (queuedText) {
            blocks.push({ type: "text", text: queuedText });
          }
          blocks.push(...queuedFiles);

          if (
            queuedText ||
            queuedThinking ||
            queuedToolCalls.length > 0 ||
            queuedFiles.length > 0
          ) {
            setSimpleMessages((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                role: "assistant",
                content: queuedText,
                files: queuedFiles.length > 0 ? queuedFiles : undefined,
                timestamp: Date.now(),
              },
            ]);
            setFullMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                content:
                  blocks.length > 0
                    ? blocks
                    : [{ type: "text", text: queuedText }],
                timestamp: Date.now(),
              },
            ]);
          }
          if (pendingThinkLevel()) {
            setThinkingLevel(pendingThinkLevel()!);
            setPendingThinkLevel(null);
          }

          if (queueCleanup) queueCleanup();
        },
        (error) => {
          const content = `Error: ${error}`;
          setSimpleMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content,
              timestamp: Date.now(),
            },
          ]);
          if (queueCleanup) queueCleanup();
        },
        {
          onThinking: (chunk) => {
            queuedThinking += chunk;
          },
          onToolCall: (id, name, args) => {
            queuedToolCalls.push({
              id,
              name,
              arguments: args,
              status: "running",
              timestamp: Date.now(),
            });
          },
          onToolEnd: (toolName, isError) => {
            for (const tc of queuedToolCalls) {
              if (tc.name === toolName && tc.status === "running") {
                tc.status = isError ? "error" : "done";
              }
            }
          },
          onFileOutput: (file) => {
            queuedFiles.push({
              type: "file",
              direction: "outbound",
              ...file,
            });
          },
          onSessionReset: () => {
            // Queued /new or /reset triggered - clear messages and streaming state
            setSimpleMessages([]);
            setFullMessages([]);
            resetStreamingState();
            setPendingQueuedMessages([]);
            clearPendingFiles();
            if (cleanup) {
              cleanup();
              cleanup = null;
            }
          },
        },
        streamOptions
      );
      return;
    }

    // Interrupt mode or not streaming: abort current stream if running
    if (cleanup) {
      cleanup();
      cleanup = null;
    }

    setIsStreaming(true);
    setStreamingStartedAt(Date.now());
    setStreamingThinking("");
    setStreamingThinkingAt(null);
    setStreamingToolCalls([]);
    setStreamingText("");
    setStreamingFiles([]);
    setStreamingTextAt(null);
    setActiveTools([]);

    cleanup = streamMessage(
      params.agentId,
      messageText,
      sessionKey(),
      (chunk) => {
        setStreamingText((prev) => prev + chunk);
        if (!streamingTextAt()) setStreamingTextAt(Date.now());
      },
      (meta?: DoneMeta) => {
        // Queued ack arrived unexpectedly - reset state only if no real stream content
        if (meta?.queued) {
          if (!hasStreamingContent()) {
            resetStreamingState();
            cleanup = null;
          }
          return;
        }

        // If aborted, discard streamed content and show system message
        if (aborted || meta?.aborted) {
          aborted = false;
          resetStreamingState();
          cleanup = null;
          maybeRefreshHistory();
          return;
        }

        // Add assistant message - build content blocks from streaming state
        const content = streamingText();
        const blocks: ContentBlock[] = [];
        const thinkingContent = streamingThinking();
        if (thinkingContent) {
          blocks.push({ type: "thinking", thinking: thinkingContent });
        }
        for (const tc of streamingToolCalls()) {
          blocks.push({
            type: "toolCall",
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
          });
        }
        if (content) {
          blocks.push({ type: "text", text: content });
        }
        const files = streamingFiles();
        blocks.push(...files);

        // Only add assistant message if there's actual content
        if (
          content ||
          thinkingContent ||
          streamingToolCalls().length > 0 ||
          files.length > 0
        ) {
          setSimpleMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content,
              files: files.length > 0 ? files : undefined,
              timestamp: Date.now(),
            },
          ]);
          setFullMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content:
                blocks.length > 0 ? blocks : [{ type: "text", text: content }],
              timestamp: Date.now(),
            },
          ]);
        }
        // Update thinkingLevel if pending was used
        if (pendingThinkLevel()) {
          setThinkingLevel(pendingThinkLevel()!);
          setPendingThinkLevel(null);
        }
        resetStreamingState();
        cleanup = null;
        maybeRefreshHistory();
      },
      (error) => {
        const content = `Error: ${error}`;
        setSimpleMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content,
            timestamp: Date.now(),
          },
        ]);
        setFullMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: [{ type: "text", text: content }],
            timestamp: Date.now(),
          },
        ]);
        resetStreamingState();
        cleanup = null;
        maybeRefreshHistory();
      },
      {
        onThinking: (chunk) => {
          setStreamingThinking((prev) => prev + chunk);
          if (!streamingThinkingAt()) setStreamingThinkingAt(Date.now());
        },
        onToolCall: (id, name, args) => {
          setStreamingToolCalls((prev) => [
            ...prev,
            {
              id,
              name,
              arguments: args,
              status: "running",
              timestamp: Date.now(),
            },
          ]);
        },
        onToolStart: (toolName) => {
          setActiveTools((prev) => [
            ...prev,
            { id: crypto.randomUUID(), toolName, status: "running" },
          ]);
        },
        onToolEnd: (toolName, isError) => {
          // Update activeTools for the pill display
          setActiveTools((prev) =>
            prev.map((t) =>
              t.toolName === toolName && t.status === "running"
                ? { ...t, status: isError ? "error" : "done" }
                : t
            )
          );
          // Also update streamingToolCalls status
          setStreamingToolCalls((prev) =>
            prev.map((tc) =>
              tc.name === toolName && tc.status === "running"
                ? { ...tc, status: isError ? "error" : "done" }
                : tc
            )
          );
        },
        onFileOutput: (file) => {
          setStreamingFiles((prev) => [
            ...prev,
            { type: "file", direction: "outbound", ...file },
          ]);
        },
        onSessionReset: () => {
          // Clear messages when session resets (e.g., /new command)
          setSimpleMessages([]);
          setFullMessages([]);
          setPendingQueuedMessages([]);
          clearPendingFiles();
        },
      },
      streamOptions
    );
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleStop = async () => {
    if (stopping() || !isStreaming() || !params.agentId) return;
    setStopping(true);
    aborted = true;

    // Close current stream
    if (cleanup) {
      cleanup();
      cleanup = null;
    }

    // Discard any streamed content and show "Interrupted"
    resetStreamingState();
    setShowInterrupted(true);

    try {
      await postAbort(params.agentId, sessionKey());
    } finally {
      setStopping(false);
    }
  };

  return (
    <div class="chat-view">
      <header class="header">
        <A href="/agents" class="back-btn" aria-label="Go back">
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
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </A>
        <div class="agent-info">
          <div class="agent-name">{agent()?.name ?? "Loading..."}</div>
          <div class="agent-status">
            <span class="status-dot" classList={{ active: isStreaming() }} />
            <span class="status-text">
              {isStreaming() ? "thinking" : "online"}
            </span>
          </div>
        </div>
        <Show when={isComponentEnabled("projects")}>
          <A
            class="taskboard-btn"
            href="/projects"
            aria-label="Open taskboard"
            title="Tasks (Cmd+K)"
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
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
            </svg>
          </A>
        </Show>
        <Show when={isOAuth()}>
          <select
            class="think-dropdown"
            value={pendingThinkLevel() ?? thinkingLevel() ?? ""}
            onChange={(e) => {
              const val = e.currentTarget.value;
              setPendingThinkLevel(val ? (val as ThinkLevel) : null);
            }}
          >
            <option value="">Default</option>
            <option value="off">Off</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="xhigh">XHigh</option>
          </select>
        </Show>
        <div class="view-toggle">
          <button
            class="toggle-btn"
            classList={{ active: viewMode() === "simple" }}
            onClick={() => handleViewChange("simple")}
          >
            Simple
          </button>
          <button
            class="toggle-btn"
            classList={{ active: viewMode() === "full" }}
            onClick={() => handleViewChange("full")}
          >
            Full
          </button>
        </div>
      </header>

      <div
        class="messages"
        ref={messagesContainerRef}
        onScroll={handleScroll}
        onDragOver={handleFileDragOver}
        onDrop={handleFileDrop}
      >
        <Show when={viewMode() === "simple"}>
          <For each={simpleMessages()}>
            {(msg) => (
              <div class={`message ${msg.role}`}>
                {msg.role === "assistant" ? (
                  <>
                    <Show when={msg.content}>
                      <div
                        class="content markdown-content"
                        innerHTML={renderMarkdown(msg.content)}
                      />
                    </Show>
                    <For each={msg.files ?? []}>
                      {(file) => <FileCard file={file} />}
                    </For>
                  </>
                ) : (
                  <>
                    <div class="content">{msg.content}</div>
                    <FileAttachmentList files={msg.files} />
                  </>
                )}
                <div class="message-time">{formatTimestamp(msg.timestamp)}</div>
              </div>
            )}
          </For>
        </Show>

        <Show when={viewMode() === "full"}>
          <For each={fullMessages()}>
            {(msg) => {
              if (msg.role === "user") {
                const textContent = msg.content
                  .filter(
                    (b): b is { type: "text"; text: string } =>
                      b.type === "text"
                  )
                  .map((b) => b.text)
                  .join("\n");
                return (
                  <div class="message user">
                    <Show when={textContent}>
                      <div class="content">{textContent}</div>
                    </Show>
                    <FileAttachmentList
                      files={msg.content.filter(
                        (b): b is FileBlock => b.type === "file"
                      )}
                    />
                    <div class="message-time">
                      {formatTimestamp(msg.timestamp)}
                    </div>
                  </div>
                );
              }
              if (msg.role === "assistant") {
                return (
                  <div class="message assistant full-message">
                    <ContentBlocks
                      blocks={msg.content}
                      timestamp={msg.timestamp}
                      toolResultsMap={toolResultsMap()}
                    />
                    {msg.meta && <ModelMetaDisplay meta={msg.meta} />}
                    <div class="message-time">
                      {formatTimestamp(msg.timestamp)}
                    </div>
                  </div>
                );
              }
              // Skip toolResult messages - they are now rendered inline with their tool calls
              if (msg.role === "toolResult") {
                return null;
              }
              return null;
            }}
          </For>
        </Show>

        {/* Streaming content in full mode - show blocks incrementally */}
        <Show
          when={
            viewMode() === "full" &&
            isStreaming() &&
            (streamingThinking() ||
              streamingToolCalls().length > 0 ||
              streamingText() ||
              streamingFiles().length > 0)
          }
        >
          <div class="message assistant full-message streaming">
            <div class="content-blocks">
              {streamingThinking() && (
                <CollapsibleBlock
                  title="Thinking"
                  content={streamingThinking()}
                  defaultCollapsed={false}
                  timestamp={
                    streamingThinkingAt() ?? streamingStartedAt() ?? undefined
                  }
                />
              )}
              <For each={streamingToolCalls()}>
                {(tc) => (
                  <CollapsibleBlock
                    title={`${tc.status === "error" ? "✗" : tc.status === "done" ? "✓" : "⟳"} ${tc.name}`}
                    content={formatJson(tc.arguments)}
                    defaultCollapsed={false}
                    mono={true}
                    timestamp={tc.timestamp}
                  />
                )}
              </For>
              {streamingText() && (
                <div
                  class="block-text markdown-content"
                  innerHTML={renderMarkdown(streamingText())}
                />
              )}
              <For each={streamingFiles()}>
                {(file) => <FileCard file={file} />}
              </For>
            </div>
            {streamingStartedAt() && (
              <div class="message-time">
                {formatTimestamp(streamingStartedAt()!)}
              </div>
            )}
          </div>
        </Show>

        {/* Streaming content in simple mode - just text */}
        <Show
          when={
            viewMode() === "simple" &&
            isStreaming() &&
            (streamingText() || streamingFiles().length > 0)
          }
        >
          <div class="message assistant streaming">
            <Show when={streamingText()}>
              <div
                class="content markdown-content"
                innerHTML={renderMarkdown(streamingText())}
              />
            </Show>
            <For each={streamingFiles()}>
              {(file) => <FileCard file={file} />}
            </For>
            {(streamingTextAt() || streamingStartedAt()) && (
              <div class="message-time">
                {formatTimestamp(
                  (streamingTextAt() ?? streamingStartedAt()) as number
                )}
              </div>
            )}
          </div>
        </Show>

        {/* Thinking dots when waiting (nothing received yet) */}
        {isStreaming() &&
          !streamingThinking() &&
          streamingToolCalls().length === 0 &&
          !streamingText() &&
          streamingFiles().length === 0 && (
            <div class="message assistant thinking">
              <div class="thinking-dots">
                <span />
                <span />
                <span />
              </div>
              {streamingStartedAt() && (
                <div class="message-time">
                  {formatTimestamp(streamingStartedAt()!)}
                </div>
              )}
            </div>
          )}

        {/* Keep ActiveToolIndicator for simple mode compatibility */}
        <Show when={viewMode() === "simple" && activeTools().length > 0}>
          <ActiveToolIndicator tools={activeTools()} />
        </Show>

        <Show when={showInterrupted()}>
          <div class="message interrupted">
            <div class="content">Interrupted</div>
          </div>
        </Show>

        <div ref={messagesEndRef} />
      </div>

      <Show when={uploadError()}>
        {(error) => <div class="upload-error">{error()}</div>}
      </Show>
      <Show when={pendingFiles().length > 0}>
        <div class="pending-attachments">
          <For each={pendingFiles()}>
            {(item) => (
              <div class="attachment-pill">
                <Show when={item.previewUrl}>
                  {(url) => <img class="attachment-thumb" src={url()} alt="" />}
                </Show>
                <span class="attachment-name" title={item.name}>
                  {item.name}
                </span>
                <button
                  type="button"
                  class="attachment-remove"
                  aria-label={`Remove ${item.name}`}
                  disabled={uploadingFiles()}
                  onClick={() => removePendingFile(item.id)}
                >
                  x
                </button>
              </div>
            )}
          </For>
          <Show when={uploadingFiles()}>
            <span class="uploading-label">Uploading...</span>
          </Show>
        </div>
      </Show>

      <div class="input-area">
        <input
          ref={fileInputRef}
          class="file-input"
          type="file"
          accept={FILE_INPUT_ACCEPT}
          multiple
          onChange={(e) => {
            if (isStreaming()) return;
            const files = e.currentTarget.files;
            if (!files || files.length === 0) return;
            addPendingFiles(files);
            e.currentTarget.value = "";
          }}
        />
        <button
          type="button"
          class="attach-btn"
          aria-label="Attach files"
          disabled={loading() || uploadingFiles() || isStreaming()}
          onClick={() => fileInputRef?.click()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M16.5 6.5v9.1a4.5 4.5 0 0 1-9 0V6.3a3.3 3.3 0 0 1 6.6 0v8.8a2.1 2.1 0 1 1-4.2 0V7.2h1.6v7.9a.5.5 0 1 0 1 0V6.3a1.7 1.7 0 0 0-3.4 0v9.3a2.9 2.9 0 0 0 5.8 0V6.5h1.6z"
            />
          </svg>
        </button>
        <div class="input-wrapper">
          <textarea
            ref={textareaRef}
            class="input"
            placeholder="Message..."
            value={input()}
            onInput={(e) => {
              setInput(e.currentTarget.value);
              resizeTextarea();
            }}
            onKeyDown={handleKeyDown}
            rows={1}
          />
        </div>
        <Show
          when={isStreaming()}
          fallback={
            <button
              class="send-btn"
              onClick={handleSend}
              disabled={
                (!input().trim() && pendingFiles().length === 0) ||
                loading() ||
                uploadingFiles()
              }
              aria-label="Send message"
            >
              <svg
                class="send-icon"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
              >
                <path
                  d="M5 12h14M12 5l7 7-7 7"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
          }
        >
          <button
            class="stop-btn"
            classList={{ stopping: stopping() }}
            disabled={stopping()}
            onClick={handleStop}
            aria-label="Stop agent"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          </button>
        </Show>
      </div>

      <Show when={contextUsageDisplay()}>
        {(display) => (
          <div
            class="context-usage"
            classList={{ unavailable: display().unavailable }}
          >
            {display().text}
          </div>
        )}
      </Show>
      <Show when={contextWarning()}>
        {(warning) => <div class="context-warning">{warning()}</div>}
      </Show>

      <style>{`
        .chat-view {
          --accent: #6366f1;
          --accent-glow: rgba(99, 102, 241, 0.4);
          --surface-0: var(--bg-base);
          --surface-1: var(--bg-surface);
          --surface-2: var(--border-default);
          --surface-3: var(--bg-raised);
          --user-bg: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
          --error: #ef4444;
          --success: #22c55e;
          --radius-sm: 8px;
          --radius-md: 16px;
          --radius-lg: 24px;

          height: 100%;
          display: flex;
          flex-direction: column;
          background: var(--surface-0);
          font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif;
        }

        .header {
          display: flex;
          align-items: center;
          padding: 16px 20px;
          gap: 16px;
          background: var(--surface-0);
          border-bottom: 1px solid var(--surface-2);
          position: sticky;
          top: 0;
          z-index: 10;
        }

        .back-btn {
          width: 40px;
          height: 40px;
          border-radius: var(--radius-sm);
          background: var(--surface-1);
          border: 1px solid var(--surface-2);
          color: var(--text-secondary);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
          text-decoration: none;
        }

        .back-btn:hover {
          background: var(--surface-2);
          color: var(--text-primary);
        }

        .taskboard-btn {
          width: 40px;
          height: 40px;
          border-radius: var(--radius-sm);
          background: var(--surface-1);
          border: 1px solid var(--surface-2);
          color: var(--text-secondary);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
        }

        .taskboard-btn:hover {
          background: var(--surface-2);
          color: var(--text-primary);
        }

        .agent-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
          flex: 1;
        }

        .agent-name {
          font-size: 16px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .agent-status {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .status-dot {
          width: 6px;
          height: 6px;
          background: var(--success);
          border-radius: 50%;
        }

        .status-dot.active {
          background: var(--accent);
          animation: pulse-dot 2s ease-in-out infinite;
        }

        @keyframes pulse-dot {
          50% { opacity: 0.5; }
        }

        .status-text {
          font-size: 12px;
          color: var(--text-muted);
        }

        .think-dropdown {
          background: var(--surface-1);
          color: var(--text-primary);
          border: 1px solid var(--surface-2);
          border-radius: var(--radius-sm);
          padding: 6px 10px;
          font-size: 12px;
          cursor: pointer;
          outline: none;
        }

        .think-dropdown:focus {
          border-color: var(--accent);
        }

        .view-toggle {
          display: flex;
          background: var(--surface-1);
          border-radius: var(--radius-sm);
          padding: 2px;
          border: 1px solid var(--surface-2);
        }

        .toggle-btn {
          padding: 6px 12px;
          border: none;
          background: transparent;
          color: var(--text-muted);
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          border-radius: 6px;
          transition: all 0.2s ease;
        }

        .toggle-btn.active {
          background: var(--accent);
          color: #fff;
        }

        .toggle-btn:hover:not(.active) {
          color: var(--text-primary);
        }

        .messages {
          flex: 1;
          overflow-y: auto;
          overscroll-behavior: contain;
          -webkit-overflow-scrolling: touch;
          touch-action: pan-y;
          padding: 24px 20px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .messages::-webkit-scrollbar {
          width: 6px;
        }

        .messages::-webkit-scrollbar-thumb {
          background: var(--surface-2);
          border-radius: 3px;
        }

        .message {
          max-width: 85%;
          padding: 12px 16px;
          border-radius: var(--radius-md);
          line-height: 1.5;
          white-space: pre-wrap;
          word-wrap: break-word;
          font-size: 15px;
          animation: message-in 0.3s ease-out;
        }

        @keyframes message-in {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .message.user {
          align-self: flex-end;
          background: var(--user-bg);
          color: #fff;
          border-bottom-right-radius: 6px;
        }

        .message.assistant {
          align-self: flex-start;
          background: var(--surface-1);
          color: var(--text-primary);
          border: 1px solid var(--surface-2);
          border-bottom-left-radius: 6px;
        }

        .message.full-message {
          max-width: 95%;
        }

        .message.tool-result {
          align-self: flex-start;
          max-width: 95%;
          background: var(--surface-1);
          border: 1px solid var(--surface-2);
          padding: 8px;
        }

        .message.tool-result.error {
          border-color: var(--error);
        }

        .message-time {
          margin-top: 6px;
          font-size: 11px;
          color: var(--text-muted);
          text-align: right;
        }

        .message.user .message-time {
          color: rgba(255, 255, 255, 0.7);
        }

        .message-files {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 8px;
        }

        .message-file-pill,
        .file-card {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
          border-radius: var(--radius-sm);
        }

        .message-file-pill {
          max-width: 260px;
          padding: 6px 8px;
          background: rgba(255, 255, 255, 0.14);
          border: 1px solid rgba(255, 255, 255, 0.2);
        }

        .file-icon {
          flex-shrink: 0;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0;
          color: var(--text-secondary);
        }

        .message.user .file-icon,
        .message.user .file-size,
        .message.user .file-name {
          color: rgba(255, 255, 255, 0.86);
        }

        .file-name,
        .file-card-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .file-name {
          min-width: 0;
          font-size: 12px;
        }

        .file-size {
          flex-shrink: 0;
          font-size: 11px;
          color: var(--text-muted);
        }

        .file-card {
          width: min(360px, 100%);
          padding: 10px;
          background: var(--surface-0);
          border: 1px solid var(--surface-2);
          white-space: normal;
        }

        .file-card-body {
          min-width: 0;
          flex: 1;
        }

        .file-card-name {
          color: var(--text-primary);
          font-size: 13px;
          font-weight: 600;
        }

        .file-card-meta {
          margin-top: 2px;
          color: var(--text-muted);
          font-size: 11px;
        }

        .file-download {
          flex-shrink: 0;
          padding: 6px 8px;
          border-radius: var(--radius-sm);
          background: var(--accent);
          color: #fff;
          font-size: 12px;
          text-decoration: none;
        }

        .message.streaming .content::after {
          content: "";
          display: inline-block;
          width: 2px;
          height: 1em;
          background: var(--accent);
          margin-left: 2px;
          animation: cursor-blink 1s step-end infinite;
        }

        @keyframes cursor-blink {
          50% { opacity: 0; }
        }

        .message.thinking {
          padding: 16px 20px;
        }

        .thinking-dots {
          display: flex;
          gap: 6px;
        }

        .thinking-dots span {
          width: 8px;
          height: 8px;
          background: var(--text-muted);
          border-radius: 50%;
          animation: thinking 1.4s ease-in-out infinite;
        }

        .thinking-dots span:nth-child(2) { animation-delay: 0.15s; }
        .thinking-dots span:nth-child(3) { animation-delay: 0.3s; }

        @keyframes thinking {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.85); }
          40% { opacity: 1; transform: scale(1); }
        }

        /* Collapsible blocks */
        .collapsible-block {
          background: var(--surface-0);
          border: 1px solid var(--surface-2);
          border-radius: var(--radius-sm);
          overflow: hidden;
          margin: 4px 0;
        }

        .collapsible-block.error {
          border-color: var(--error);
        }

        .collapse-header {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          padding: 8px 12px;
          background: transparent;
          border: none;
          color: var(--text-secondary);
          font-size: 13px;
          cursor: pointer;
          text-align: left;
        }

        .collapse-header:hover {
          background: var(--surface-2);
        }

        .collapse-icon {
          font-size: 10px;
          color: var(--text-muted);
        }

        .collapse-title {
          font-weight: 500;
          color: var(--text-primary);
        }

        .collapse-hint {
          flex: 1;
          color: var(--text-muted);
          font-size: 12px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .collapse-content {
          padding: 12px;
          border-top: 1px solid var(--surface-2);
          font-size: 13px;
          color: var(--text-secondary);
          white-space: pre-wrap;
          word-break: break-word;
          max-height: 300px;
          overflow-y: auto;
        }

        .collapse-content.mono {
          font-family: 'SF Mono', 'Consolas', monospace;
          font-size: 12px;
        }

        .block-time {
          padding: 6px 12px 8px;
          font-size: 11px;
          color: var(--text-muted);
          text-align: right;
        }

        /* Content blocks */
        .content-blocks {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        /* Tool call with result grouped together */
        .tool-call-group {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .tool-result-inline {
          margin-left: 12px;
          border-left: 2px solid var(--surface-3);
          padding-left: 8px;
        }

        .tool-result-inline.error {
          border-left-color: var(--error);
        }

        .block-text {
          white-space: pre-wrap;
        }

        /* Markdown content */
        .markdown-content {
          line-height: 1.7;
          white-space: normal;
        }

        .markdown-content > *:first-child {
          margin-top: 0;
        }

        .markdown-content > *:last-child {
          margin-bottom: 0;
        }

        .markdown-content p {
          margin: 0.4em 0;
        }

        .markdown-content code {
          background: var(--surface-2);
          padding: 0.1em 0.35em;
          border-radius: 4px;
          font-family: 'SF Mono', 'Consolas', monospace;
          font-size: 0.9em;
        }

        .markdown-content pre {
          background: var(--surface-0);
          border: 1px solid var(--surface-2);
          border-radius: var(--radius-sm);
          padding: 10px;
          overflow-x: auto;
          margin: 0.5em 0;
        }

        .markdown-content pre code {
          background: none;
          padding: 0;
          font-size: 0.85em;
          line-height: 1.4;
        }

        .markdown-content ul,
        .markdown-content ol {
          margin: 0.6em 0;
          padding-left: 1.5em;
        }

        .markdown-content li {
          margin: 0.25em 0;
        }

        .markdown-content li p {
          margin: 0;
        }

        .markdown-content a {
          color: #818cf8;
          text-decoration: underline;
          text-decoration-color: rgba(129, 140, 248, 0.35);
          text-underline-offset: 2px;
          transition: text-decoration-color 0.15s ease;
        }

        .markdown-content a:hover {
          text-decoration-color: #818cf8;
        }

        .markdown-content blockquote {
          border-left: 3px solid var(--surface-3);
          margin: 0.4em 0;
          padding-left: 0.75em;
          color: var(--text-secondary);
        }

        .markdown-content h1,
        .markdown-content h2,
        .markdown-content h3 {
          margin: 0.6em 0 0.3em 0;
          font-weight: 600;
        }

        .markdown-content table {
          width: 100%;
          display: block;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          border-collapse: collapse;
          margin: 0.5em 0;
          font-size: 0.9em;
        }

        .markdown-content th,
        .markdown-content td {
          padding: 8px 12px;
          text-align: left;
          border: 1px solid var(--border-default);
        }

        .markdown-content th {
          background: var(--bg-surface);
          font-weight: 600;
          color: var(--text-primary);
        }

        .markdown-content tbody tr:nth-child(even) {
          background: rgba(255, 255, 255, 0.02);
        }

        /* Model meta */
        .model-meta {
          display: flex;
          gap: 12px;
          margin-top: 8px;
          padding-top: 8px;
          border-top: 1px solid var(--surface-2);
          font-size: 11px;
          color: var(--text-muted);
        }

        .meta-model {
          font-weight: 500;
        }

        /* Active tools */
        .active-tools {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          padding: 8px 0;
        }

        .active-tool {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          background: var(--surface-1);
          border: 1px solid var(--surface-2);
          border-radius: var(--radius-sm);
          font-size: 12px;
          color: var(--text-secondary);
        }

        .active-tool.running .tool-icon {
          animation: spin 1s linear infinite;
          color: var(--accent);
        }

        .active-tool.done .tool-icon {
          color: var(--success);
        }

        .active-tool.error .tool-icon {
          color: var(--error);
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .input-area {
          display: flex;
          align-items: flex-end;
          flex-shrink: 0;
          gap: 12px;
          padding: 16px 20px 24px;
          background: var(--surface-0);
          border-top: 1px solid var(--surface-2);
        }

        .file-input {
          display: none;
        }

        .pending-attachments {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          padding: 10px 20px 0;
          background: var(--surface-0);
          border-top: 1px solid var(--surface-2);
        }

        .attachment-pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          max-width: 240px;
          padding: 6px 8px;
          border-radius: var(--radius-sm);
          background: var(--surface-1);
          border: 1px solid var(--surface-2);
        }

        .attachment-thumb {
          width: 24px;
          height: 24px;
          object-fit: cover;
          border-radius: 4px;
          flex-shrink: 0;
        }

        .attachment-name {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 12px;
          color: var(--text-secondary);
        }

        .attachment-remove {
          width: 18px;
          height: 18px;
          border: none;
          border-radius: 4px;
          background: transparent;
          color: var(--text-muted);
          cursor: pointer;
          line-height: 1;
        }

        .attachment-remove:hover:not(:disabled) {
          background: var(--surface-2);
          color: var(--text-primary);
        }

        .uploading-label,
        .upload-error {
          color: var(--text-muted);
          font-size: 12px;
        }

        .upload-error {
          padding: 8px 20px 0;
          color: var(--error);
          background: var(--surface-0);
        }

        .attach-btn {
          width: 48px;
          height: 48px;
          border-radius: var(--radius-sm);
          background: var(--surface-1);
          border: 1px solid var(--surface-2);
          color: var(--text-secondary);
          cursor: pointer;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
        }

        .attach-btn svg {
          width: 22px;
          height: 22px;
        }

        .attach-btn:hover:not(:disabled) {
          background: var(--surface-2);
          color: var(--text-primary);
        }

        .attach-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .input-wrapper {
          flex: 1;
          background: var(--surface-1);
          border: 1px solid var(--surface-2);
          border-radius: var(--radius-lg);
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }

        .input-wrapper:focus-within {
          border-color: var(--accent);
          box-shadow: 0 0 0 3px var(--accent-glow);
        }

        .input {
          width: 100%;
          padding: 14px 20px;
          background: transparent;
          border: none;
          color: var(--text-primary);
          font-size: 15px;
          line-height: 22px;
          resize: none;
          outline: none;
          font-family: inherit;
          overflow-y: auto;
        }

        .input::placeholder {
          color: var(--text-muted);
        }

        .input:disabled {
          opacity: 0.5;
        }

        .send-btn {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          background: var(--surface-2);
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .send-btn:not(:disabled) {
          background: var(--accent);
          color: #fff;
          box-shadow: 0 4px 16px var(--accent-glow);
        }

        .send-btn:not(:disabled):hover {
          transform: scale(1.05);
        }

        .send-btn:not(:disabled):active {
          transform: scale(0.95);
        }

        .send-btn:disabled {
          cursor: not-allowed;
        }

        .send-icon {
          transition: transform 0.2s ease;
        }

        .send-btn:not(:disabled):hover .send-icon {
          transform: translateX(2px);
        }

        .stop-btn {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          background: #d32f2f;
          border: none;
          color: #fff;
          cursor: pointer;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 4px 16px rgba(211, 47, 47, 0.4);
        }

        .stop-btn:hover:not(:disabled) {
          background: #c62828;
          transform: scale(1.05);
        }

        .stop-btn:active:not(:disabled) {
          transform: scale(0.95);
        }

        .stop-btn.stopping {
          background: #f57c00;
          cursor: not-allowed;
        }

        .context-usage {
          text-align: right;
          color: var(--text-muted);
          font-size: 11px;
          padding: 0 20px 8px;
        }

        .context-usage.unavailable {
          opacity: 0.9;
        }

        .context-warning {
          margin: 0 20px 8px;
          padding: 8px 10px;
          border: 1px solid color-mix(in srgb, #ef4444 35%, transparent);
          border-radius: 10px;
          background: color-mix(in srgb, #ef4444 10%, transparent);
          color: #fca5a5;
          font-size: 12px;
          line-height: 1.4;
        }

        .message.interrupted {
          text-align: center;
          padding: 8px 20px;
        }

        .message.interrupted .content {
          color: var(--text-muted);
          font-size: 0.85em;
          font-style: italic;
        }
      `}</style>
    </div>
  );
}
