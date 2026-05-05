import {
  createSignal,
  createEffect,
  onMount,
  onCleanup,
  createMemo,
  Show,
  For,
  Suspense,
} from "solid-js";
import { useLocation, useParams } from "@solidjs/router";
import {
  fetchAgents,
  fetchFullHistory,
  getSessionKey,
  postAbort,
  streamMessage,
  subscribeToSession,
  uploadFiles,
} from "../api/client";
import type { ActiveTurn } from "../api/client";
import type {
  Agent,
  FileAttachment,
  FileBlock,
  FullHistoryMessage,
  FullToolResultMessage,
} from "../api/types";
import { buildBoardLogs, BoardChatLog } from "./BoardChatRenderer";
import type { BoardLogItem } from "./BoardChatRenderer";
import { ScratchpadEditor } from "./ScratchpadEditor";
import { BoardLifecycleListPage } from "./board/BoardLifecycleListPage";
import { BoardProjectDetailPage } from "./board/BoardProjectDetailPage";
import {
  attachmentToFileBlock,
  createPendingFile,
  FILE_INPUT_ACCEPT,
  formatFileSize,
  isSupportedFile,
  MAX_UPLOAD_SIZE_BYTES,
  revokePendingFile,
  type PendingFile,
} from "../lib/attachments";

// ── Types ───────────────────────────────────────────────────────────

type CanvasPanel = "overview" | "projects" | "projects:detail" | "spec";

interface CanvasState {
  panel: CanvasPanel;
  props?: Record<string, unknown>;
}

type BoardProjectRoute = {
  projectId: string;
  sliceId: string | null;
  tab: string | undefined;
} | null;

type DropZone = "history" | "composer" | "attach";

// ── API helpers ─────────────────────────────────────────────────────

const API_BASE = "/api/board";
const SELECTED_AGENT_STORAGE_KEY = "aihub:board:selected-agent";

function readSelectedAgentId(): string | null {
  try {
    return localStorage.getItem(SELECTED_AGENT_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeSelectedAgentId(agentId: string | null): void {
  try {
    if (agentId) {
      localStorage.setItem(SELECTED_AGENT_STORAGE_KEY, agentId);
    } else {
      localStorage.removeItem(SELECTED_AGENT_STORAGE_KEY);
    }
  } catch {
    // ignore localStorage failures
  }
}

async function getCanvasState(agentId: string): Promise<CanvasState> {
  const res = await fetch(`${API_BASE}/canvas/${encodeURIComponent(agentId)}`);
  if (!res.ok) return { panel: "overview" };
  return normalizeCanvasState(await res.json());
}

async function setCanvasState(
  agentId: string,
  panel: string,
  props?: Record<string, unknown>
): Promise<void> {
  await fetch(`${API_BASE}/canvas/${encodeURIComponent(agentId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ panel, props }),
  });
}

function normalizeCanvasState(state: CanvasState): CanvasState {
  return state.panel === "projects:detail" ? { panel: "projects" } : state;
}

const basePath = import.meta.env.BASE_URL?.replace(/\/+$/, "") ?? "";

function stripBase(pathname: string): string {
  if (basePath && pathname.startsWith(basePath)) {
    return pathname.slice(basePath.length) || "/";
  }
  return pathname;
}

function withBase(path: string): string {
  if (!basePath) return path;
  if (path.startsWith(basePath + "/") || path === basePath) return path;
  return `${basePath}${path.startsWith("/") ? "" : "/"}${path}`;
}

function parseBoardProjectRoute(
  pathname: string,
  search: string
): BoardProjectRoute {
  const match = stripBase(pathname).match(
    /^\/board\/projects\/([^/]+)(?:\/slices\/([^/]+))?$/
  );
  if (!match) return null;
  return {
    projectId: decodeURIComponent(match[1]),
    sliceId: match[2] ? decodeURIComponent(match[2]) : null,
    tab: new URLSearchParams(search).get("tab") ?? undefined,
  };
}

// ── BoardView ───────────────────────────────────────────────────────

export function BoardView() {
  const location = useLocation();
  const [agents, setAgents] = createSignal<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = createSignal<string | null>(
    readSelectedAgentId()
  );
  const [canvas, setCanvas] = createSignal<CanvasState>({ panel: "overview" });
  const [chatInput, setChatInput] = createSignal("");
  const [logItems, setLogItems] = createSignal<BoardLogItem[]>([]);
  const [streamingLogItems, setStreamingLogItems] = createSignal<
    BoardLogItem[]
  >([]);
  const [isStreaming, setIsStreaming] = createSignal(false);
  const [waitingForFirstText, setWaitingForFirstText] = createSignal(false);
  const [stickToBottom, setStickToBottom] = createSignal(true);
  const [queuedMessages, setQueuedMessages] = createSignal<string[]>([]);
  const [pendingFiles, setPendingFiles] = createSignal<PendingFile[]>([]);
  const [uploadingFiles, setUploadingFiles] = createSignal(false);
  const [uploadError, setUploadError] = createSignal("");
  const [isFileDragActive, setIsFileDragActive] = createSignal(false);
  const [activeDropZone, setActiveDropZone] = createSignal<DropZone | null>(
    null
  );

  let boardChatEl: HTMLDivElement | undefined;
  let messagesEl: HTMLDivElement | undefined;
  let inputEl: HTMLTextAreaElement | undefined;
  let fileInputEl: HTMLInputElement | undefined;
  let stopStream: (() => void) | null = null;
  let stopSubscription: (() => void) | null = null;
  let historyLoadVersion = 0;
  let activeQueuedMessage: string | null = null;
  let fileDragDepth = 0;

  const selectedAgent = createMemo(() =>
    agents().find((a) => a.id === selectedAgentId())
  );
  const selectedAgentAvatar = createMemo(() => selectedAgent()?.avatar);
  const displayedLogItems = createMemo<BoardLogItem[]>(() => {
    return [...logItems(), ...streamingLogItems()];
  });

  createEffect(() => {
    if (location.pathname.startsWith("/board/projects")) {
      setCanvas({ panel: "projects" });
    }
  });

  function setCanvasForRoute(state: CanvasState) {
    setCanvas(
      location.pathname.startsWith("/board/projects")
        ? { panel: "projects" }
        : state
    );
  }

  function cleanupStream() {
    stopStream?.();
    stopStream = null;
  }

  function cleanupSubscription() {
    stopSubscription?.();
    stopSubscription = null;
  }

  function cleanupLiveConnections() {
    cleanupStream();
    cleanupSubscription();
  }

  function resetInputHeight() {
    if (inputEl) inputEl.style.height = "auto";
  }

  function clearPendingFiles() {
    setPendingFiles((prev) => {
      prev.forEach(revokePendingFile);
      return [];
    });
  }

  function addPendingFiles(files: FileList | File[]) {
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
      next.push(createPendingFile(file));
    }
    if (next.length > 0) {
      setPendingFiles((prev) => [...prev, ...next]);
    }
  }

  function removePendingFile(id: string) {
    setPendingFiles((prev) => {
      const removed = prev.find((item) => item.id === id);
      if (removed) revokePendingFile(removed);
      return prev.filter((item) => item.id !== id);
    });
  }

  function canAttachFiles() {
    return !isStreaming() && !uploadingFiles();
  }

  function getFileDropError() {
    if (isStreaming()) {
      return "Wait for the current response before attaching files.";
    }
    if (uploadingFiles()) {
      return "Wait for the current upload to finish before attaching files.";
    }
    return "";
  }

  function isFileDragEvent(event: DragEvent) {
    return Array.from(event.dataTransfer?.types ?? []).includes("Files");
  }

  function getDropZone(target: EventTarget | null): DropZone | null {
    const element = target instanceof Element ? target : null;
    if (!element) return null;
    if (element.closest(".board-chat-attach")) return "attach";
    if (
      element.closest(".board-chat-input-wrapper") ||
      element.closest(".board-chat-input-area")
    ) {
      return "composer";
    }
    if (element.closest(".board-chat-messages")) return "history";
    return null;
  }

  function resetFileDragState() {
    fileDragDepth = 0;
    setIsFileDragActive(false);
    setActiveDropZone(null);
  }

  function updateDropZoneFromEvent(event: DragEvent) {
    setActiveDropZone(getDropZone(event.target));
  }

  function isNearBottom(el: HTMLElement) {
    return el.scrollHeight - el.scrollTop - el.clientHeight <= 48;
  }

  function scrollToBottom(force = false) {
    if (!messagesEl || (!force && !stickToBottom())) return;
    queueMicrotask(() => {
      if (!messagesEl) return;
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  function appendUserLog(text: string, files?: FileBlock[]) {
    setLogItems((prev) => [
      ...prev,
      { type: "text", role: "user", content: text, files },
    ]);
  }

  function appendAssistantLog(text: string) {
    if (!text) return;
    setLogItems((prev) => [
      ...prev,
      { type: "text", role: "assistant", content: text },
    ]);
  }

  function appendStreamingTextLog(text: string) {
    setWaitingForFirstText(false);
    setStreamingLogItems((prev) => {
      const last = prev.at(-1);
      if (last?.type === "text" && last.role === "assistant") {
        return [
          ...prev.slice(0, -1),
          { ...last, content: last.content + text },
        ];
      }
      return [...prev, { type: "text", role: "assistant", content: text }];
    });
  }

  function appendStreamingThinkingLog(text: string) {
    setStreamingLogItems((prev) => {
      const last = prev.at(-1);
      if (last?.type === "thinking") {
        return [
          ...prev.slice(0, -1),
          { ...last, content: last.content + text },
        ];
      }
      return [...prev, { type: "thinking", content: text }];
    });
  }

  function appendStreamingToolLog(id: string, name: string, args: unknown) {
    setStreamingLogItems((prev) =>
      prev.some((item) => item.type === "tool" && item.id === id)
        ? prev
        : [
            ...prev,
            {
              type: "tool",
              id,
              toolName: name,
              args,
              status: "running",
            },
          ]
    );
  }

  function updateStreamingToolStatus(name: string, status: "done" | "error") {
    setStreamingLogItems((prev) =>
      prev.map((item) =>
        item.type === "tool" &&
        item.toolName === name &&
        item.status === "running"
          ? { ...item, status }
          : item
      )
    );
  }

  function attachStreamingToolResult(
    id: string,
    name: string,
    content: string,
    isError: boolean,
    details?: { diff?: string }
  ) {
    const result: FullToolResultMessage = {
      role: "toolResult",
      toolCallId: id,
      toolName: name,
      content: [{ type: "text", text: content }],
      isError,
      details,
      timestamp: Date.now(),
    };
    setStreamingLogItems((prev) =>
      prev.map((item) =>
        item.type === "tool" && item.id === id
          ? {
              ...item,
              body: content,
              result,
              status: isError ? "error" : "done",
            }
          : item
      )
    );
  }

  function finalizeStreamingLogs() {
    const items = streamingLogItems();
    if (items.length > 0) {
      setLogItems((prev) => [...prev, ...items]);
    }
    setStreamingLogItems([]);
  }

  function applyActiveTurnSnapshot(turn: ActiveTurn) {
    setIsStreaming(true);
    setWaitingForFirstText(!turn.text?.trim() && !turn.thinking?.trim());
    const activeItems: BoardLogItem[] = [];
    if (turn.thinking) {
      activeItems.push({ type: "thinking", content: turn.thinking });
    }
    if (turn.text) {
      activeItems.push({ type: "text", role: "assistant", content: turn.text });
    }
    for (const toolCall of turn.toolCalls ?? []) {
      activeItems.push({
        type: "tool",
        id: toolCall.id,
        toolName: toolCall.name,
        args: toolCall.arguments,
        status: toolCall.status,
      });
    }
    setStreamingLogItems(activeItems);
    if (turn.userText) {
      setLogItems((prev) =>
        prev.some(
          (item) =>
            item.type === "text" &&
            item.role === "user" &&
            item.content === turn.userText
        )
          ? prev
          : [
              ...prev,
              { type: "text", role: "user", content: turn.userText ?? "" },
            ]
      );
    }
  }

  function clearStreamingLogs() {
    setStreamingLogItems([]);
  }

  function buildHistoryLogItems(
    messages: FullHistoryMessage[]
  ): BoardLogItem[] {
    return buildBoardLogs(messages);
  }

  function attachSessionSubscription(agentId: string, sessionKey: string) {
    cleanupSubscription();
    stopSubscription = subscribeToSession(agentId, sessionKey, {
      onText(text) {
        if (!text) return;
        appendStreamingTextLog(text);
      },
      onThinking(text) {
        if (!text) return;
        appendStreamingThinkingLog(text);
      },
      onToolCall(id, name, args) {
        appendStreamingToolLog(id, name, args);
      },
      onToolEnd(name, isError) {
        updateStreamingToolStatus(name, isError ? "error" : "done");
      },
      onToolResult(id, name, content, isError, details) {
        attachStreamingToolResult(id, name, content, isError, details);
      },
      onActiveTurn(turn) {
        applyActiveTurnSnapshot(turn);
      },
      onDone() {
        cleanupSubscription();
        finalizeStreamingLogs();
        setWaitingForFirstText(false);
        setIsStreaming(false);
        processNextQueuedMessage(agentId);
      },
      onError(error) {
        cleanupSubscription();
        clearStreamingLogs();
        setWaitingForFirstText(false);
        setIsStreaming(false);
        appendAssistantLog(error);
        processNextQueuedMessage(agentId);
      },
    });
  }

  async function loadHistory(agentId: string) {
    const version = ++historyLoadVersion;
    const sessionKey = getSessionKey(agentId);

    try {
      const history = await fetchFullHistory(agentId, sessionKey);
      if (version !== historyLoadVersion || selectedAgentId() !== agentId)
        return;

      const historyMessages: FullHistoryMessage[] = history.messages;
      const items = buildHistoryLogItems(historyMessages);

      if (history.isStreaming && history.activeTurn && !stopStream) {
        cleanupSubscription();
        attachSessionSubscription(agentId, sessionKey);
      }

      setLogItems(items);
      if (history.isStreaming && history.activeTurn) {
        applyActiveTurnSnapshot(history.activeTurn);
      } else {
        clearStreamingLogs();
      }
      setIsStreaming(Boolean(history.isStreaming));
      setWaitingForFirstText(
        Boolean(history.isStreaming && !history.activeTurn?.text?.trim())
      );
      scrollToBottom(true);
    } catch (err) {
      if (version !== historyLoadVersion || selectedAgentId() !== agentId)
        return;
      console.error("[BoardView] failed to load history:", err);
      setLogItems([]);
      clearStreamingLogs();
      setIsStreaming(false);
      setWaitingForFirstText(false);
    }
  }

  // Load agents
  onMount(async () => {
    try {
      const list = await fetchAgents();
      setAgents(list);
      const selected = selectedAgentId();
      if (
        list.length > 0 &&
        (!selected || !list.some((agent) => agent.id === selected))
      ) {
        setSelectedAgentId(list[0].id);
      }
    } catch (err) {
      console.error("[BoardView] failed to load agents:", err);
    }
  });

  createEffect(() => {
    writeSelectedAgentId(selectedAgentId());
  });

  // Poll canvas state for selected agent
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  createEffect(() => {
    const agentId = selectedAgentId();
    if (pollTimer) clearInterval(pollTimer);
    if (!agentId) return;

    // Initial fetch
    getCanvasState(agentId).then(setCanvasForRoute);

    // Poll every 2s
    pollTimer = setInterval(() => {
      getCanvasState(agentId).then(setCanvasForRoute);
    }, 2000);
  });

  onCleanup(() => {
    if (pollTimer) clearInterval(pollTimer);
    cleanupLiveConnections();
    clearPendingFiles();
    resetFileDragState();
  });

  createEffect(() => {
    if (canAttachFiles()) return;
    resetFileDragState();
  });

  createEffect(() => {
    const root = boardChatEl;
    if (!root) return;

    const handleDragEnter = (event: Event) => {
      const dragEvent = event as DragEvent;
      if (!isFileDragEvent(dragEvent) || !canAttachFiles()) return;
      dragEvent.preventDefault();
      fileDragDepth += 1;
      setIsFileDragActive(true);
      updateDropZoneFromEvent(dragEvent);
    };

    const handleDragOver = (event: Event) => {
      const dragEvent = event as DragEvent;
      if (!isFileDragEvent(dragEvent) || !canAttachFiles()) return;
      dragEvent.preventDefault();
      if (dragEvent.dataTransfer) dragEvent.dataTransfer.dropEffect = "copy";
      setIsFileDragActive(true);
      updateDropZoneFromEvent(dragEvent);
    };

    const handleDragLeave = (event: Event) => {
      const dragEvent = event as DragEvent;
      if (!isFileDragEvent(dragEvent) || fileDragDepth === 0) return;
      fileDragDepth = Math.max(0, fileDragDepth - 1);
      if (fileDragDepth === 0) resetFileDragState();
    };

    const handleDrop = (event: Event) => {
      const dragEvent = event as DragEvent;
      if (!isFileDragEvent(dragEvent)) return;
      dragEvent.preventDefault();
      const files = dragEvent.dataTransfer?.files;
      const dropError = getFileDropError();
      resetFileDragState();
      if (dropError) {
        setUploadError(dropError);
        return;
      }
      if (!files || files.length === 0) return;
      addPendingFiles(files);
    };

    root.addEventListener("dragenter", handleDragEnter, true);
    root.addEventListener("dragover", handleDragOver, true);
    root.addEventListener("dragleave", handleDragLeave, true);
    root.addEventListener("drop", handleDrop, true);
    onCleanup(() => {
      root.removeEventListener("dragenter", handleDragEnter, true);
      root.removeEventListener("dragover", handleDragOver, true);
      root.removeEventListener("dragleave", handleDragLeave, true);
      root.removeEventListener("drop", handleDrop, true);
    });
  });

  // ── Chat ──────────────────────────────────────────────────────────

  createEffect(() => {
    displayedLogItems();
    queuedMessages();
    waitingForFirstText();
    scrollToBottom();
  });

  createEffect(() => {
    const agentId = selectedAgentId();
    cleanupLiveConnections();
    historyLoadVersion += 1;
    setLogItems([]);
    clearStreamingLogs();
    setIsStreaming(false);
    setWaitingForFirstText(false);
    setStickToBottom(true);
    setQueuedMessages([]);
    activeQueuedMessage = null;
    if (!agentId) return;
    void loadHistory(agentId);
  });

  function sendStreamMessage(
    agentId: string,
    text: string,
    mode: "normal" | "queued",
    attachments?: FileAttachment[]
  ) {
    cleanupSubscription();
    setIsStreaming(true);
    setWaitingForFirstText(true);
    setStickToBottom(true);
    clearStreamingLogs();
    scrollToBottom(true);

    const sessionKey = getSessionKey(agentId);
    stopStream = streamMessage(
      agentId,
      text,
      sessionKey,
      (chunk) => {
        if (!chunk) return;
        appendStreamingTextLog(chunk);
      },
      () => {
        cleanupStream();
        finalizeStreamingLogs();
        setWaitingForFirstText(false);
        setIsStreaming(false);
        if (mode === "queued") {
          activeQueuedMessage = null;
        }
        processNextQueuedMessage(agentId);
      },
      (error) => {
        cleanupStream();
        clearStreamingLogs();
        setWaitingForFirstText(false);
        setIsStreaming(false);
        if (mode === "queued") {
          activeQueuedMessage = null;
        }
        appendAssistantLog(error);
        processNextQueuedMessage(agentId);
      },
      {
        onThinking(chunk) {
          if (!chunk) return;
          appendStreamingThinkingLog(chunk);
        },
        onToolCall(id, name, args) {
          appendStreamingToolLog(id, name, args);
        },
        onToolEnd(name, isError) {
          updateStreamingToolStatus(name, isError ? "error" : "done");
        },
        onToolResult(id, name, content, isError, details) {
          attachStreamingToolResult(id, name, content, isError, details);
        },
      },
      attachments?.length ? { attachments } : undefined
    );
  }

  function processNextQueuedMessage(agentId: string) {
    if (selectedAgentId() !== agentId || isStreaming() || activeQueuedMessage) {
      return;
    }
    const nextText = queuedMessages()[0];
    if (!nextText) return;
    activeQueuedMessage = nextText;
    setQueuedMessages((prev) => prev.slice(1));
    appendUserLog(nextText);
    sendStreamMessage(agentId, nextText, "queued");
  }

  async function resumeQueuedMessagesAfterAbort(agentId: string) {
    if (!queuedMessages().length || selectedAgentId() !== agentId) return;
    const sessionKey = getSessionKey(agentId);
    try {
      const history = await fetchFullHistory(agentId, sessionKey);
      if (selectedAgentId() !== agentId) return;
      if (!history.isStreaming) {
        processNextQueuedMessage(agentId);
        return;
      }
      attachSessionSubscription(agentId, sessionKey);
    } catch (err) {
      console.error("[BoardView] failed to resume queued messages:", err);
    }
  }

  async function handleSend() {
    const agentId = selectedAgentId();
    const text = chatInput().trim();
    const currentPendingFiles = pendingFiles();
    const hasFiles = currentPendingFiles.length > 0;
    if (!agentId || (!text && !hasFiles) || uploadingFiles()) return;

    if (isStreaming() && hasFiles) {
      setUploadError("Wait for the current response before attaching files.");
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
    const logText = messageText;

    setChatInput("");
    resetInputHeight();

    if (isStreaming()) {
      setQueuedMessages((prev) => [...prev, messageText]);
      setStickToBottom(true);
      scrollToBottom(true);
      return;
    }

    appendUserLog(logText, inboundFiles.length > 0 ? inboundFiles : undefined);
    sendStreamMessage(agentId, messageText, "normal", attachments);
  }

  async function handleAbort() {
    const agentId = selectedAgentId();
    if (!agentId || !isStreaming()) return;
    const sessionKey = getSessionKey(agentId);
    try {
      await postAbort(agentId, sessionKey);
    } catch (err) {
      console.error("[BoardView] failed to abort stream:", err);
    } finally {
      cleanupLiveConnections();
      finalizeStreamingLogs();
      setIsStreaming(false);
      setWaitingForFirstText(false);
      activeQueuedMessage = null;
      void resumeQueuedMessagesAfterAbort(agentId);
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  function handleInputChange(e: Event) {
    const target = e.currentTarget as HTMLTextAreaElement;
    setChatInput(target.value);
    // Auto-resize
    target.style.height = "auto";
    target.style.height = Math.min(target.scrollHeight, 160) + "px";
  }

  const fileDropHint = createMemo(() => {
    if (!isFileDragActive()) return "";
    if (activeDropZone() === "history") return "Drop files into the chat.";
    if (activeDropZone() === "composer") {
      return "Drop files to attach them to your next message.";
    }
    if (activeDropZone() === "attach")
      return "Drop files on the attach button.";
    return "Drop files to attach them.";
  });

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div class="board">
      {/* Left pane: Chat */}
      <div
        class="board-chat"
        classList={{ "drop-active": isFileDragActive() }}
        ref={boardChatEl}
      >
        <div class="board-chat-header">
          <div class="board-chat-agent-info">
            <Show
              when={selectedAgentAvatar()}
              fallback={
                <div class="board-chat-agent-avatar board-chat-agent-avatar--default">
                  AI
                </div>
              }
            >
              {(avatar) => (
                <div class="board-chat-agent-avatar">{avatar()}</div>
              )}
            </Show>
            <select
              class="board-agent-select"
              value={selectedAgentId() ?? ""}
              onChange={(e) => setSelectedAgentId(e.currentTarget.value)}
            >
              <For each={agents()}>
                {(agent) => (
                  <option
                    value={agent.id}
                    selected={agent.id === selectedAgentId()}
                  >
                    {agent.name}
                  </option>
                )}
              </For>
            </select>
          </div>
        </div>

        <div
          class="board-chat-messages"
          classList={{
            "drop-target": isFileDragActive() && activeDropZone() === "history",
          }}
          ref={messagesEl}
          onScroll={(e) => setStickToBottom(isNearBottom(e.currentTarget))}
        >
          <Show when={logItems().length === 0 && !isStreaming()}>
            <div class="board-chat-empty">
              <div class="board-chat-empty-icon">
                <svg
                  width="40"
                  height="40"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <p class="board-chat-empty-title">How can I help?</p>
              <p class="board-chat-empty-sub">Send a message to start.</p>
            </div>
          </Show>
          <BoardChatLog
            items={displayedLogItems()}
            agentName={selectedAgent()?.name ?? "Agent"}
          />
          <For each={queuedMessages()}>
            {(message) => (
              <div class="board-msg board-msg-user">
                <div class="board-msg-role">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  <span>You (queued)</span>
                </div>
                <div class="board-msg-content">{message}</div>
              </div>
            )}
          </For>
          <Show when={isStreaming() && waitingForFirstText()}>
            <div class="board-msg board-msg-assistant">
              <div class="board-msg-role">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M12 2L2 7l10 5 10-5-10-5z" />
                  <path d="M2 17l10 5 10-5" />
                  <path d="M2 12l10 5 10-5" />
                </svg>
                <span>{selectedAgent()?.name ?? "Agent"}</span>
              </div>
              <div class="board-msg-thinking">Thinking…</div>
            </div>
          </Show>
        </div>

        <div class="board-chat-input-area">
          <Show when={isFileDragActive()}>
            <div class="board-drop-banner">{fileDropHint()}</div>
          </Show>
          <Show when={uploadError()}>
            {(error) => <div class="board-upload-error">{error()}</div>}
          </Show>
          <Show when={pendingFiles().length > 0}>
            <div class="board-attachments">
              <For each={pendingFiles()}>
                {(item) => (
                  <div class="board-attachment-pill">
                    <Show when={item.previewUrl}>
                      {(url) => (
                        <img
                          class="board-attachment-thumb"
                          src={url()}
                          alt=""
                        />
                      )}
                    </Show>
                    <span class="board-attachment-name" title={item.name}>
                      {item.name}
                    </span>
                    <Show when={formatFileSize(item.size)}>
                      {(size) => (
                        <span class="board-attachment-size">{size()}</span>
                      )}
                    </Show>
                    <button
                      type="button"
                      class="board-attachment-remove"
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
                <span class="board-uploading-label">Uploading...</span>
              </Show>
            </div>
          </Show>
          <div
            class="board-chat-input-wrapper"
            classList={{
              "drop-target":
                isFileDragActive() && activeDropZone() === "composer",
            }}
          >
            <input
              ref={fileInputEl}
              class="board-file-input"
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
              class="board-chat-attach"
              classList={{
                "drop-target":
                  isFileDragActive() && activeDropZone() === "attach",
              }}
              aria-label="Attach files"
              disabled={isStreaming() || uploadingFiles()}
              onClick={() => fileInputEl?.click()}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M16.5 6.5v9.1a4.5 4.5 0 0 1-9 0V6.3a3.3 3.3 0 0 1 6.6 0v8.8a2.1 2.1 0 1 1-4.2 0V7.2h1.6v7.9a.5.5 0 1 0 1 0V6.3a1.7 1.7 0 0 0-3.4 0v9.3a2.9 2.9 0 0 0 5.8 0V6.5h1.6z"
                />
              </svg>
            </button>
            <textarea
              class="board-chat-input"
              ref={inputEl}
              placeholder="Ask anything..."
              value={chatInput()}
              onInput={handleInputChange}
              onKeyDown={handleKeyDown}
              rows={1}
            />
            <Show
              when={isStreaming()}
              fallback={
                <button
                  class="board-chat-send"
                  onClick={() => void handleSend()}
                  type="button"
                  disabled={
                    (!chatInput().trim() && pendingFiles().length === 0) ||
                    uploadingFiles()
                  }
                  aria-label="Send message"
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
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                </button>
              }
            >
              <button
                class="board-chat-send board-chat-stop"
                onClick={handleAbort}
                type="button"
                aria-label="Stop response"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
            </Show>
          </div>
          <p class="board-chat-input-hint">
            Enter to send, Shift+Enter for new line
          </p>
        </div>
      </div>

      {/* Right pane: Canvas */}
      <div class="board-canvas">
        <div class="board-canvas-tabs">
          <button
            classList={{
              "board-canvas-tab": true,
              active: canvas().panel === "overview",
            }}
            onClick={() => {
              setCanvas({ panel: "overview" });
              if (selectedAgentId())
                setCanvasState(selectedAgentId()!, "overview");
            }}
          >
            Scratchpad
          </button>
          <button
            classList={{
              "board-canvas-tab": true,
              active: canvas().panel === "projects",
            }}
            onClick={() => {
              setCanvas({ panel: "projects" });
              if (selectedAgentId())
                setCanvasState(selectedAgentId()!, "projects");
            }}
          >
            Project lifecycle
          </button>
        </div>

        <div
          class="board-canvas-content"
          classList={{
            "board-canvas-content-projects": canvas().panel === "projects",
          }}
        >
          <Suspense fallback={<CanvasLoading />}>
            <CanvasPanelRenderer state={canvas()} />
          </Suspense>
        </div>
      </div>

      <style>{`
        .board {
          height: 100%;
          display: flex;
          width: 100%;
          min-height: 0;
          overflow: hidden;
        }

        /* ── Chat pane ─────────────────────────────────────────── */

        .board-chat {
          width: 640px;
          min-width: 400px;
          max-width: 55%;
          display: flex;
          flex-direction: column;
          border-right: 1px solid var(--border-default);
          background: var(--bg-base);
        }

        .board-chat.drop-active {
          box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text-accent, #6366f1) 28%, transparent);
        }

        /* Header */
        .board-chat-header {
          padding: 12px 20px;
          border-bottom: 1px solid var(--border-default);
          display: flex;
          align-items: center;
        }

        .board-chat-agent-info {
          display: flex;
          align-items: center;
          gap: 10px;
          flex: 1;
        }

        .board-chat-agent-avatar {
          width: 28px;
          height: 28px;
          border-radius: 8px;
          display: grid;
          place-items: center;
          font-size: 16px;
          background: var(--bg-surface);
          flex-shrink: 0;
        }

        .board-chat-agent-avatar--default {
          font-size: 11px;
          font-weight: 600;
          color: var(--text-secondary);
          letter-spacing: 0.5px;
        }

        .board-agent-select {
          flex: 1;
          padding: 6px 10px;
          border-radius: 8px;
          border: 1px solid transparent;
          background: transparent;
          color: var(--text-primary);
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.15s, border-color 0.15s;
          appearance: none;
          -webkit-appearance: none;
        }

        .board-agent-select:hover {
          background: var(--bg-surface);
          border-color: var(--border-default);
        }

        .board-agent-select:focus {
          outline: none;
          background: var(--bg-surface);
          border-color: var(--border-accent, var(--text-accent, #6366f1));
          box-shadow: 0 0 0 2px color-mix(in srgb, var(--text-accent, #6366f1) 20%, transparent);
        }

        /* Messages */
        .board-chat-messages {
          flex: 1;
          overflow-y: auto;
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .board-chat-messages.drop-target {
          outline: 1px dashed color-mix(in srgb, var(--text-accent, #6366f1) 38%, transparent);
          outline-offset: -8px;
          background: linear-gradient(180deg, color-mix(in srgb, var(--text-accent, #6366f1) 5%, transparent), transparent 28%);
        }

        /* Empty state */
        .board-chat-empty {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding-bottom: 40px;
        }

        .board-chat-empty-icon {
          color: var(--text-secondary);
          opacity: 0.4;
          margin-bottom: 4px;
        }

        .board-chat-empty-title {
          margin: 0;
          font-size: 16px;
          font-weight: 500;
          color: var(--text-primary);
        }

        .board-chat-empty-sub {
          margin: 0;
          font-size: 13px;
          color: var(--text-secondary);
        }

        /* Messages */
        .board-msg {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .board-msg-role {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          font-weight: 500;
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .board-msg-content {
          font-size: 14px;
          line-height: 1.55;
          word-break: break-word;
          color: var(--text-primary);
        }

        .board-msg-user .board-msg-content {
          padding: 10px 14px;
          border-radius: 12px;
          border-top-right-radius: 4px;
          background: color-mix(in srgb, var(--text-primary, #1e293b) 8%, transparent);
          color: var(--text-primary);
          white-space: pre-wrap;
        }

        .board-msg-assistant .board-msg-content {
          padding: 0;
          background: transparent;
        }

        .board-msg-thinking {
          font-size: 14px;
          font-style: italic;
          color: var(--text-secondary);
          animation: thinking-pulse 1.8s ease-in-out infinite;
        }

        @keyframes thinking-pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }

        @media (prefers-reduced-motion: reduce) {
          .board-msg-thinking {
            animation: none;
            opacity: 0.6;
          }
        }

        /* Input area */
        .board-chat-input-area {
          padding: 12px 20px 12px;
          border-top: 1px solid var(--border-default);
        }

        .board-drop-banner {
          margin: 0 0 8px;
          color: var(--text-accent, #6366f1);
          font-size: 12px;
          font-weight: 600;
        }

        .board-upload-error {
          margin: 0 0 8px;
          color: #ef4444;
          font-size: 12px;
        }

        .board-attachments {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 8px;
        }

        .board-attachment-pill {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          min-width: 0;
          max-width: 100%;
          padding: 5px 7px;
          border: 1px solid var(--border-default);
          border-radius: 8px;
          background: color-mix(in srgb, var(--text-primary) 5%, transparent);
          color: var(--text-secondary);
          font-size: 12px;
        }

        .board-attachment-thumb {
          width: 22px;
          height: 22px;
          flex-shrink: 0;
          object-fit: cover;
          border-radius: 4px;
        }

        .board-attachment-name {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .board-attachment-size,
        .board-uploading-label {
          flex-shrink: 0;
          color: var(--text-secondary);
          opacity: 0.7;
          font-size: 11px;
        }

        .board-attachment-remove {
          width: 18px;
          height: 18px;
          border: none;
          border-radius: 4px;
          background: transparent;
          color: var(--text-secondary);
          cursor: pointer;
          line-height: 1;
        }

        .board-attachment-remove:hover:not(:disabled) {
          background: color-mix(in srgb, var(--text-primary) 8%, transparent);
          color: var(--text-primary);
        }

        .board-file-input {
          display: none;
        }

        .board-chat-input-wrapper {
          display: flex;
          align-items: flex-end;
          gap: 0;
          border-radius: 14px;
          border: 1px solid var(--border-default);
          background: var(--bg-surface);
          transition: border-color 0.2s, box-shadow 0.2s;
          overflow: hidden;
        }

        .board-chat-input-wrapper:focus-within {
          border-color: var(--border-accent, var(--text-accent, #6366f1));
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--text-accent, #6366f1) 15%, transparent);
        }

        .board-chat-input-wrapper.drop-target {
          border-color: color-mix(in srgb, var(--text-accent, #6366f1) 52%, var(--border-default));
          background: color-mix(in srgb, var(--text-accent, #6366f1) 6%, var(--bg-surface));
        }

        .board-chat-attach {
          display: grid;
          place-items: center;
          width: 36px;
          height: 36px;
          margin: 4px 0 4px 4px;
          border: none;
          border-radius: 10px;
          background: transparent;
          color: var(--text-secondary);
          cursor: pointer;
          flex-shrink: 0;
        }

        .board-chat-attach svg {
          width: 19px;
          height: 19px;
        }

        .board-chat-attach:hover:not(:disabled) {
          background: color-mix(in srgb, var(--text-primary) 8%, transparent);
          color: var(--text-primary);
        }

        .board-chat-attach.drop-target {
          background: color-mix(in srgb, var(--text-accent, #6366f1) 12%, transparent);
          color: var(--text-primary);
        }

        .board-chat-attach:disabled {
          opacity: 0.35;
          cursor: default;
        }

        .board-chat-input {
          flex: 1;
          padding: 12px 4px;
          border: none;
          background: transparent;
          color: var(--text-primary);
          font-size: 14px;
          font-family: inherit;
          line-height: 1.5;
          resize: none;
          min-height: 44px;
          max-height: 160px;
        }

        .board-chat-input::placeholder {
          color: var(--text-secondary);
          opacity: 0.6;
        }

        .board-chat-input:focus {
          outline: none;
        }

        .board-chat-send {
          display: grid;
          place-items: center;
          width: 36px;
          height: 36px;
          margin: 4px;
          border-radius: 10px;
          border: none;
          background: var(--bg-accent, #6366f1);
          color: var(--text-on-accent, #ffffff);
          cursor: pointer;
          transition: opacity 0.15s, transform 0.15s;
          flex-shrink: 0;
        }

        .board-chat-send.board-chat-stop {
          background: #ef4444;
          color: #ffffff;
        }

        .board-chat-send:hover:not(:disabled) {
          opacity: 0.85;
          transform: scale(1.05);
        }

        .board-chat-send:active:not(:disabled) {
          transform: scale(0.95);
        }

        .board-chat-send:disabled {
          opacity: 0.3;
          cursor: default;
        }

        .board-chat-send:focus-visible {
          outline: 2px solid var(--text-accent, #6366f1);
          outline-offset: 2px;
        }

        .board-chat-attach:focus-visible,
        .board-attachment-remove:focus-visible {
          outline: 2px solid var(--text-accent, #6366f1);
          outline-offset: 2px;
        }

        .board-chat-input-hint {
          margin: 6px 0 0;
          font-size: 11px;
          color: var(--text-secondary);
          opacity: 0.5;
          text-align: center;
        }

        .board-canvas {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-width: 0;
          background: var(--bg-surface);
        }

        .board-canvas-tabs {
          display: flex;
          border-bottom: 1px solid var(--border-default);
          padding: 0 16px;
          gap: 4px;
        }

        .board-canvas-tab {
          padding: 10px 16px;
          border: none;
          background: none;
          color: var(--text-secondary);
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          border-bottom: 2px solid transparent;
          transition: color 0.15s, border-color 0.15s;
        }

        .board-canvas-tab:hover {
          color: var(--text-primary);
        }

        .board-canvas-tab.active {
          color: var(--text-accent, #6366f1);
          border-bottom-color: var(--text-accent, #6366f1);
        }

        .board-canvas-content {
          flex: 1;
          overflow-y: auto;
          padding: 24px;
          min-height: 0;
        }

        .board-canvas-content-projects {
          overflow: hidden;
          padding: 0;
        }

        @media (max-width: 768px) {
          .board {
            flex-direction: column;
          }
          .board-chat {
            width: 100%;
            max-width: 100%;
            height: 50%;
            border-right: none;
            border-bottom: 1px solid var(--border-default);
          }
        }
      `}</style>
    </div>
  );
}

// ── Canvas panels ───────────────────────────────────────────────────

function CanvasPanelRenderer(props: { state: CanvasState }) {
  return (
    <>
      <div
        class="canvas-panel"
        style={{ display: props.state.panel === "overview" ? "block" : "none" }}
      >
        <OverviewPanel />
      </div>
      <div
        class="canvas-panel"
        style={{ display: props.state.panel === "projects" ? "block" : "none" }}
      >
        <ProjectsPanel />
      </div>
      <style>{`
        .canvas-panel {
          width: 100%;
          height: 100%;
          min-height: 0;
        }
      `}</style>
    </>
  );
}

function CanvasLoading() {
  return (
    <div class="canvas-loading" data-testid="canvas-loading">
      Loading…
      <style>{`
        .canvas-loading {
          padding: 24px;
          color: var(--text-secondary);
          font-size: 13px;
        }
      `}</style>
    </div>
  );
}

function OverviewPanel() {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div class="canvas-overview">
      <h1>{dateStr}</h1>
      <div class="canvas-overview-scratchpad">
        <ScratchpadEditor />
      </div>
      <style>{`
        .canvas-overview {
          width: 100%;
          display: flex;
          flex-direction: column;
          height: 100%;
        }
        .canvas-overview h1 {
          margin: 0 0 8px;
          font-size: 22px;
          color: var(--text-primary);
          flex-shrink: 0;
        }
        .canvas-overview-scratchpad {
          flex: 1;
          min-height: 0;
          margin-top: 16px;
        }
      `}</style>
    </div>
  );
}

function ProjectsPanel() {
  const params = useParams<{ projectId?: string }>();
  const [localRoute, setLocalRoute] = createSignal<BoardProjectRoute>(
    parseBoardProjectRoute(window.location.pathname, window.location.search)
  );
  const selectedProjectId = createMemo(
    () => localRoute()?.projectId ?? params.projectId ?? null
  );
  const selectedSliceId = createMemo(() => localRoute()?.sliceId ?? null);
  const selectedTab = createMemo(() => localRoute()?.tab);

  onMount(() => {
    const updateLocalRoute = () => {
      setLocalRoute(
        parseBoardProjectRoute(window.location.pathname, window.location.search)
      );
    };
    window.addEventListener("popstate", updateLocalRoute);
    onCleanup(() => window.removeEventListener("popstate", updateLocalRoute));
  });

  const setEmbeddedUrl = (to: string, options?: { replace?: boolean }) => {
    const url = new URL(to, window.location.origin);
    const target = `${withBase(url.pathname)}${url.search}`;
    if (options?.replace) {
      window.history.replaceState(null, "", target);
    } else {
      window.history.pushState(null, "", target);
    }
    setLocalRoute(parseBoardProjectRoute(url.pathname, url.search));
  };

  const openProject = (id: string) => {
    setEmbeddedUrl(`/board/projects/${encodeURIComponent(id)}`);
  };

  const closeProject = () => {
    window.history.pushState(null, "", withBase("/board/projects"));
    setLocalRoute(null);
  };

  return (
    <div class="canvas-projects-overview">
      <Show
        when={selectedProjectId()}
        fallback={
          <BoardLifecycleListPage
            onProjectClick={(project) => openProject(project.id)}
          />
        }
      >
        <BoardProjectDetailPage
          projectId={selectedProjectId()!}
          sliceId={selectedSliceId()}
          tab={selectedTab()}
          onBack={closeProject}
          onOpenProject={openProject}
          onNavigate={setEmbeddedUrl}
        />
      </Show>
      <style>{`
        .canvas-projects-overview {
          width: 100%;
          height: 100%;
          min-height: 0;
          display: flex;
          flex-direction: column;
        }
      `}</style>
    </div>
  );
}
