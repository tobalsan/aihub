import {
  createSignal,
  createEffect,
  onMount,
  onCleanup,
  createMemo,
  Show,
  For,
  Switch,
  Match,
} from "solid-js";
import {
  archiveRuntimeSubagent,
  deleteRuntimeSubagent,
  fetchAgents,
  fetchBoardProjects,
  fetchFullHistory,
  fetchRuntimeSubagentLogs,
  fetchRuntimeSubagents,
  getSessionKey,
  interruptRuntimeSubagent,
  postAbort,
  streamMessage,
  subscribeToSubagentChanges,
  subscribeToSession,
  uploadFiles,
} from "../api/client";
import type { ActiveTurn } from "../api/client";
import type {
  Agent,
  BoardProject,
  FileAttachment,
  FileBlock,
  FullHistoryMessage,
  FullToolResultMessage,
  SubagentLogEvent,
} from "../api/types";
import type { SubagentRun } from "@aihub/shared/types";
import { buildBoardLogs, BoardChatLog } from "./BoardChatRenderer";
import type { BoardLogItem } from "./BoardChatRenderer";
import { ScratchpadEditor } from "./ScratchpadEditor";
import { AreaSummaries } from "./AreaSummaries";
import { renderMarkdown } from "../lib/markdown";
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

type CanvasPanel = "overview" | "projects" | "agents" | "spec" | "monitor";

interface CanvasState {
  panel: CanvasPanel;
  props?: Record<string, unknown>;
}

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
  return res.json();
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

// ── BoardView ───────────────────────────────────────────────────────

export function BoardView() {
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
    getCanvasState(agentId).then(setCanvas);

    // Poll every 2s
    pollTimer = setInterval(() => {
      getCanvasState(agentId).then(setCanvas);
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
            Overview
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
            Projects
          </button>
          <button
            classList={{
              "board-canvas-tab": true,
              active: canvas().panel === "monitor",
            }}
            onClick={() => {
              setCanvas({ panel: "monitor" });
              if (selectedAgentId())
                setCanvasState(selectedAgentId()!, "monitor");
            }}
          >
            Agents
          </button>
        </div>

        <div class="board-canvas-content">
          <CanvasPanelRenderer state={canvas()} agentId={selectedAgentId()} />
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
          width: 520px;
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

function CanvasPanelRenderer(props: {
  state: CanvasState;
  agentId: string | null;
}) {
  return (
    <Switch fallback={<OverviewPanel />}>
      <Match when={props.state.panel === "overview"}>
        <OverviewPanel />
      </Match>
      <Match when={props.state.panel === "projects"}>
        <ProjectsPanel />
      </Match>
      <Match
        when={props.state.panel === "agents" || props.state.panel === "monitor"}
      >
        <MonitorPanel agentId={props.agentId} />
      </Match>
    </Switch>
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

type ProjectGroup = BoardProject["group"];

const GROUP_ORDER: ProjectGroup[] = ["review", "active", "stale", "done"];
const GROUP_LABEL: Record<ProjectGroup, string> = {
  review: "Review",
  active: "Active",
  stale: "Stale",
  done: "Done",
};
const GROUP_EMPTY: Record<ProjectGroup, string> = {
  review: "No projects in review.",
  active: "No active projects.",
  stale: "No stale projects.",
  done: "No done projects.",
};

function ProjectsPanel() {
  const [projects, setProjects] = createSignal<BoardProject[]>([]);
  const [error, setError] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [includeDone, setIncludeDone] = createSignal(false);
  const [filterChanged, setFilterChanged] = createSignal(false);
  const [areaFilter, setAreaFilter] = createSignal<string>("all");
  const [expanded, setExpanded] = createSignal<Record<string, boolean>>({});
  const [initialised, setInitialised] = createSignal(false);

  async function load() {
    setLoading(true);
    try {
      const items = await fetchBoardProjects(includeDone());
      setProjects(items);
      setError(null);
      if (!initialised()) {
        const initial: Record<string, boolean> = {};
        for (const p of items) {
          initial[p.id] = p.group === "active" || p.group === "review";
        }
        setExpanded((prev) => ({ ...initial, ...prev }));
        setInitialised(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setFilterChanged(false);
    }
  }

  createEffect(() => {
    includeDone();
    void load();
  });

  onMount(() => {
    const timer = window.setInterval(() => void load(), 10000);
    onCleanup(() => window.clearInterval(timer));
  });

  const areas = createMemo(() => {
    const set = new Set<string>();
    for (const p of projects()) set.add(p.area);
    return Array.from(set).sort();
  });

  const filtered = createMemo(() => {
    const a = areaFilter();
    return a === "all" ? projects() : projects().filter((p) => p.area === a);
  });

  const grouped = createMemo(() => {
    const out: Record<ProjectGroup, BoardProject[]> = {
      review: [],
      active: [],
      stale: [],
      done: [],
    };
    for (const p of filtered()) out[p.group].push(p);
    return out;
  });

  const visibleGroups = createMemo<ProjectGroup[]>(() =>
    GROUP_ORDER.filter((g) => g !== "done" || includeDone())
  );

  function toggleProject(id: string) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <div class="canvas-projects">
      <div class="cp-header">
        <h2>Projects</h2>
        <div class="cp-controls">
          <select
            class="cp-select"
            value={areaFilter()}
            onChange={(e) => setAreaFilter(e.currentTarget.value)}
          >
            <option value="all">All areas</option>
            <For each={areas()}>
              {(area) => <option value={area}>{area}</option>}
            </For>
          </select>
          <label class="cp-toggle">
            <input
              type="checkbox"
              checked={includeDone()}
              onChange={(e) => {
                setFilterChanged(true);
                setIncludeDone(e.currentTarget.checked);
              }}
            />
            <span>Show done</span>
          </label>
        </div>
      </div>

      <AreaSummaries />

      <Show when={error()}>
        <div class="cp-error">{error()}</div>
      </Show>

      <Show when={loading() && (projects().length === 0 || filterChanged())}>
        <div class="cp-loading">
          <div class="cp-spinner" />
          <span>Loading projects…</span>
        </div>
      </Show>

      <div class="cp-sections">
        <For each={visibleGroups()}>
          {(group) => {
            const items = () => grouped()[group];
            return (
              <section class="cp-section">
                <header class="cp-section-header">
                  <span class={`cp-dot cp-dot-${group}`} />
                  <span class="cp-section-label">{GROUP_LABEL[group]}</span>
                  <span class="cp-section-count">({items().length})</span>
                </header>
                <Show
                  when={items().length > 0}
                  fallback={
                    <div class="cp-empty">{GROUP_EMPTY[group]}</div>
                  }
                >
                  <ul class="cp-list">
                    <For each={items()}>
                      {(project) => (
                        <li class="cp-item">
                          <button
                            type="button"
                            class="cp-row"
                            onClick={() => toggleProject(project.id)}
                          >
                            <span class={`cp-caret ${expanded()[project.id] ? "open" : ""}`}>
                              ▸
                            </span>
                            <span class="cp-id">{project.id}</span>
                            <span class="cp-title">{project.title}</span>
                            <span class="cp-area">{project.area}</span>
                            <span class={`cp-dot cp-dot-${project.group}`} />
                          </button>
                          <Show when={expanded()[project.id]}>
                            <Show
                              when={project.worktrees.length > 0}
                              fallback={
                                <div class="cp-worktrees-empty">(no worktrees)</div>
                              }
                            >
                              <ul class="cp-worktrees">
                                <For each={project.worktrees}>
                                  {(wt) => (
                                    <li class="cp-worktree">
                                      <span class="cp-wt-name">{wt.name}</span>
                                      <span class="cp-wt-branch">{wt.branch}</span>
                                      <Show when={wt.ahead > 0}>
                                        <span class="cp-ahead">+{wt.ahead}</span>
                                      </Show>
                                      <span
                                        class={`cp-wt-status ${wt.dirty ? "dirty" : "clean"}`}
                                        title={wt.dirty ? "Uncommitted changes" : "Clean"}
                                      >
                                        <span class="cp-wt-status-dot" />
                                        {wt.dirty ? "dirty" : "clean"}
                                      </span>
                                    </li>
                                  )}
                                </For>
                              </ul>
                            </Show>
                          </Show>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              </section>
            );
          }}
        </For>
      </div>

      <style>{`
        .canvas-projects {
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          gap: 16px;
          color: var(--text-primary);
        }
        .cp-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
        }
        .canvas-projects h2 {
          margin: 0;
          font-size: 22px;
          color: var(--text-primary);
        }
        .cp-controls {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .cp-select {
          background: var(--bg-raised);
          color: var(--text-primary);
          border: 1px solid var(--border-default);
          border-radius: 6px;
          padding: 6px 10px;
          font-size: 13px;
          font-family: inherit;
        }
        .cp-select:focus {
          outline: none;
          border-color: var(--text-accent, #6366f1);
        }
        .cp-toggle {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 13px;
          color: var(--text-secondary);
          cursor: pointer;
          user-select: none;
        }
        .cp-toggle input {
          accent-color: var(--text-accent, #6366f1);
          margin: 0;
        }
        .cp-error {
          color: #f87171;
          font-size: 13px;
          padding: 8px 12px;
          border: 1px solid color-mix(in srgb, #f87171 35%, var(--border-default));
          border-radius: 6px;
          background: color-mix(in srgb, #f87171 8%, var(--bg-surface));
        }
        .cp-loading {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding: 48px 0;
          color: var(--text-secondary);
          font-size: 13px;
        }
        .cp-spinner {
          width: 18px;
          height: 18px;
          border: 2px solid var(--border-default);
          border-top-color: var(--text-accent, #6366f1);
          border-radius: 50%;
          animation: cp-spin 0.7s linear infinite;
        }
        @keyframes cp-spin {
          to { transform: rotate(360deg); }
        }
        .cp-sections {
          display: flex;
          flex-direction: column;
          gap: 20px;
          overflow-y: auto;
          flex: 1;
          min-height: 0;
        }
        .cp-section {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .cp-section-header {
          display: flex;
          align-items: center;
          gap: 8px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-size: 11px;
          color: var(--text-secondary);
        }
        .cp-section-label {
          font-weight: 600;
        }
        .cp-section-count {
          color: var(--text-secondary);
          opacity: 0.7;
        }
        .cp-empty {
          font-size: 13px;
          color: var(--text-secondary);
          opacity: 0.7;
          padding: 6px 4px 0 20px;
        }
        .cp-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .cp-item {
          display: flex;
          flex-direction: column;
        }
        .cp-row {
          display: grid;
          grid-template-columns: 14px auto 1fr auto 10px;
          align-items: center;
          gap: 10px;
          width: 100%;
          padding: 8px 10px;
          background: transparent;
          color: var(--text-primary);
          border: 1px solid transparent;
          border-radius: 6px;
          cursor: pointer;
          text-align: left;
          font-family: inherit;
          font-size: 13px;
        }
        .cp-row:hover {
          background: var(--bg-raised);
          border-color: var(--border-default);
        }
        .cp-caret {
          display: inline-block;
          color: var(--text-secondary);
          font-size: 10px;
          transition: transform 120ms ease;
          width: 14px;
          text-align: center;
        }
        .cp-caret.open {
          transform: rotate(90deg);
        }
        .cp-id {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 12px;
          color: var(--text-secondary);
          letter-spacing: 0.02em;
        }
        .cp-title {
          color: var(--text-primary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .cp-area {
          font-size: 11px;
          padding: 2px 8px;
          border-radius: 999px;
          background: var(--bg-raised);
          color: var(--text-secondary);
          border: 1px solid var(--border-default);
          text-transform: lowercase;
        }
        .cp-dot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: var(--text-secondary);
          flex-shrink: 0;
          display: inline-block;
        }
        .cp-dot-active { background: #3b82f6; }
        .cp-dot-review { background: #f59e0b; }
        .cp-dot-stale  { background: #6b7280; }
        .cp-dot-done   { background: #10b981; }
        .cp-worktrees {
          list-style: none;
          margin: 4px 0 4px 24px;
          padding: 4px 0 4px 12px;
          border-left: 1px solid var(--border-default);
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .cp-worktrees-empty {
          margin: 4px 0 4px 24px;
          padding-left: 12px;
          font-size: 12px;
          color: var(--text-secondary);
          opacity: 0.7;
          border-left: 1px solid var(--border-default);
        }
        .cp-worktree {
          display: grid;
          grid-template-columns: minmax(120px, max-content) 1fr auto auto;
          align-items: center;
          gap: 12px;
          padding: 4px 6px;
          font-size: 12px;
          border-radius: 4px;
        }
        .cp-worktree:hover {
          background: var(--bg-raised);
        }
        .cp-wt-name {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          color: var(--text-primary);
        }
        .cp-wt-branch {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          color: var(--text-secondary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .cp-ahead {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 11px;
          padding: 1px 6px;
          border-radius: 999px;
          background: color-mix(in srgb, var(--text-accent, #6366f1) 14%, transparent);
          color: var(--text-accent, #6366f1);
        }
        .cp-wt-status {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-size: 11px;
          color: var(--text-secondary);
        }
        .cp-wt-status-dot {
          width: 6px;
          height: 6px;
          border-radius: 999px;
          background: #10b981;
          display: inline-block;
        }
        .cp-wt-status.dirty {
          color: #f59e0b;
        }
        .cp-wt-status.dirty .cp-wt-status-dot {
          background: #f59e0b;
        }
      `}</style>
    </div>
  );
}

function formatRuntime(startedAt: string) {
  const elapsed = Date.now() - Date.parse(startedAt);
  if (!Number.isFinite(elapsed) || elapsed < 0) return "now";
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function parentKey(parent: SubagentRun["parent"]) {
  return parent ? `${parent.type}:${parent.id}` : "";
}

type MonitorLogState = {
  cursor: number;
  events: SubagentLogEvent[];
  loading: boolean;
  error?: string;
};

type MonitorHistoryItem = {
  tone: "user" | "assistant" | "tool" | "system" | "error";
  title?: string;
  body: string;
  meta?: string;
  bodyFormat?: "markdown" | "mono";
};

function parseJsonRecord(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function titleFromType(type: string) {
  return type.replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function toMonitorHistoryItem(
  event: SubagentLogEvent
): MonitorHistoryItem | null {
  const text = (
    event.text ??
    event.diff?.summary ??
    event.tool?.name ??
    ""
  ).trim();
  if (!text) return null;

  if (event.type === "stderr" || event.type === "error") {
    return { tone: "error", title: "Error", body: text, bodyFormat: "mono" };
  }

  if (event.type === "tool_call" || event.type === "tool_output") {
    return {
      tone: "tool",
      title: event.type === "tool_call" ? "Tool call" : "Tool output",
      meta: [event.tool?.name, event.tool?.id].filter(Boolean).join(" · "),
      body: text,
      bodyFormat: "mono",
    };
  }

  const parsed = parseJsonRecord(text);
  if (!parsed) {
    return {
      tone: event.type === "user" ? "user" : "assistant",
      body: text,
    };
  }

  const payload = getRecord(parsed.payload);
  if (parsed.type === "event_msg" && payload?.type === "user_message") {
    const message = typeof payload.message === "string" ? payload.message : "";
    return message ? { tone: "user", body: message } : null;
  }

  const item = getRecord(parsed.item);
  if (item?.type === "command_execution") {
    const command = typeof item.command === "string" ? item.command : "";
    const output =
      typeof item.aggregated_output === "string"
        ? item.aggregated_output.trim()
        : "";
    const status = typeof item.status === "string" ? item.status : "";
    const exitNumber =
      typeof item.exit_code === "number" ? item.exit_code : undefined;
    const exitCode = exitNumber !== undefined ? `exit ${exitNumber}` : status;
    return {
      tone:
        status === "completed" && exitNumber !== undefined && exitNumber !== 0
          ? "error"
          : "tool",
      title: status === "in_progress" ? "Running command" : "Command finished",
      meta: [command, exitCode].filter(Boolean).join(" · "),
      body:
        output || command || titleFromType(String(parsed.type ?? event.type)),
      bodyFormat: "mono",
    };
  }

  if (parsed.type === "thread.started") {
    const threadId =
      typeof parsed.thread_id === "string" ? parsed.thread_id : "";
    return {
      tone: "system",
      title: "Thread started",
      body: threadId || "Subagent session initialized.",
    };
  }

  if (parsed.type === "turn.started") {
    return {
      tone: "system",
      title: "Turn started",
      body: "Processing prompt.",
    };
  }

  if (parsed.type === "turn.completed") {
    return {
      tone: "system",
      title: "Turn completed",
      body: "Subagent turn finished.",
    };
  }

  const parsedType =
    typeof parsed.type === "string" ? parsed.type : String(event.type);
  return {
    tone: "system",
    title: titleFromType(parsedType),
    body: "Runtime event received.",
  };
}

function toMonitorHistory(events: SubagentLogEvent[]) {
  return events
    .map(toMonitorHistoryItem)
    .filter((item): item is MonitorHistoryItem => item !== null);
}

function MonitorHistoryBody(props: { item: MonitorHistoryItem }) {
  if (props.item.bodyFormat === "mono") {
    return <pre class="canvas-monitor-history-mono">{props.item.body}</pre>;
  }
  return (
    <div
      class="canvas-monitor-history-markdown"
      innerHTML={renderMarkdown(props.item.body, { breaks: true })}
    />
  );
}

function MonitorPanel(props: { agentId: string | null }) {
  const [runs, setRuns] = createSignal<SubagentRun[]>([]);
  const [error, setError] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [expandedRunIds, setExpandedRunIds] = createSignal<Set<string>>(
    new Set()
  );
  const [logsByRunId, setLogsByRunId] = createSignal<
    Record<string, MonitorLogState>
  >({});
  const scrollRefs = new Map<string, HTMLDivElement>();
  const scrollPositions = new Map<string, number>();
  const scopedParent = createMemo(() =>
    props.agentId
      ? `agent-session:${props.agentId}:${getSessionKey(props.agentId)}`
      : undefined
  );

  async function loadRuns() {
    setLoading(true);
    try {
      const data = await fetchRuntimeSubagents();
      setRuns(data.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function refreshMonitor() {
    await loadRuns();
    await Promise.all(
      [...expandedRunIds()].map((runId) => loadRunLogs(runId, false))
    );
  }

  function rememberRunScroll(runId: string) {
    const element = scrollRefs.get(runId);
    if (element) scrollPositions.set(runId, element.scrollTop);
  }

  function restoreRunScroll(runId: string) {
    requestAnimationFrame(() => {
      const element = scrollRefs.get(runId);
      if (!element) return;
      element.scrollTop = scrollPositions.get(runId) ?? element.scrollHeight;
    });
  }

  async function loadRunLogs(runId: string, append = false) {
    const current = logsByRunId()[runId];
    setLogsByRunId((prev) => ({
      ...prev,
      [runId]: {
        cursor: current?.cursor ?? 0,
        events: current?.events ?? [],
        loading: true,
      },
    }));
    try {
      const data = await fetchRuntimeSubagentLogs(
        runId,
        append ? (current?.cursor ?? 0) : 0
      );
      setLogsByRunId((prev) => ({
        ...prev,
        [runId]: {
          cursor: data.cursor,
          events: append
            ? [...(prev[runId]?.events ?? []), ...data.events]
            : data.events,
          loading: false,
        },
      }));
      if (!append) restoreRunScroll(runId);
    } catch (err) {
      setLogsByRunId((prev) => ({
        ...prev,
        [runId]: {
          cursor: current?.cursor ?? 0,
          events: current?.events ?? [],
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        },
      }));
    }
  }

  function toggleRun(runId: string) {
    let shouldLoad = false;
    setExpandedRunIds((current) => {
      const next = new Set(current);
      if (next.has(runId)) {
        rememberRunScroll(runId);
        next.delete(runId);
      } else {
        next.add(runId);
        shouldLoad = true;
      }
      return next;
    });
    if (shouldLoad) void loadRunLogs(runId);
  }

  function forgetRun(runId: string) {
    scrollRefs.delete(runId);
    scrollPositions.delete(runId);
    setExpandedRunIds((current) => {
      const next = new Set(current);
      next.delete(runId);
      return next;
    });
    setLogsByRunId((current) => {
      const next = { ...current };
      delete next[runId];
      return next;
    });
  }

  async function interruptRun(runId: string) {
    const result = await interruptRuntimeSubagent(runId);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await loadRuns();
  }

  async function archiveRun(runId: string) {
    const result = await archiveRuntimeSubagent(runId);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    forgetRun(runId);
    await loadRuns();
  }

  async function deleteRun(run: SubagentRun) {
    if (
      !window.confirm(
        `Kill subagent run ${run.label}? This removes its runtime data.`
      )
    ) {
      return;
    }
    const result = await deleteRuntimeSubagent(run.id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    forgetRun(run.id);
    await loadRuns();
  }

  createEffect(() => {
    scopedParent();
    void loadRuns();
  });

  const unsubscribe = subscribeToSubagentChanges({
    onSubagentChanged: (event) => {
      void loadRuns();
      if (expandedRunIds().has(event.runId)) {
        void loadRunLogs(event.runId, true);
      }
    },
    onError: setError,
  });
  onCleanup(unsubscribe);

  const runningCount = createMemo(
    () => runs().filter((run) => run.status === "running").length
  );

  return (
    <div class="canvas-monitor">
      <header class="canvas-monitor-header">
        <div>
          <h2>Agent Monitor</h2>
          <p>{runningCount()} running</p>
        </div>
        <button
          class="canvas-monitor-refresh"
          onClick={refreshMonitor}
          type="button"
        >
          Refresh
        </button>
      </header>
      <Show when={error()}>
        {(message) => <div class="canvas-monitor-error">{message()}</div>}
      </Show>
      <Show
        when={runs().length > 0}
        fallback={
          <p class="canvas-monitor-empty">
            {loading() ? "Loading subagents..." : "No subagent runs."}
          </p>
        }
      >
        <div class="canvas-monitor-list">
          <For each={runs()}>
            {(run) => (
              <article class="canvas-monitor-run">
                <div class="canvas-monitor-run-head">
                  <button
                    aria-expanded={expandedRunIds().has(run.id)}
                    class="canvas-monitor-run-toggle"
                    onClick={() => toggleRun(run.id)}
                    type="button"
                  >
                    <div class="canvas-monitor-run-main">
                      <div class="canvas-monitor-run-title">
                        <span class={`canvas-monitor-dot ${run.status}`} />
                        <strong>{run.label}</strong>
                        <span>{run.cli}</span>
                      </div>
                      <div class="canvas-monitor-run-meta">
                        <span>{run.status}</span>
                        <span>{formatRuntime(run.startedAt)}</span>
                        <Show when={run.parent}>
                          {(parent) => <span>{parentKey(parent())}</span>}
                        </Show>
                      </div>
                      <Show when={run.latestOutput}>
                        {(latest) => (
                          <p class="canvas-monitor-output">{latest()}</p>
                        )}
                      </Show>
                    </div>
                  </button>
                  <div class="canvas-monitor-run-actions">
                    <Show when={run.status === "running"}>
                      <button
                        aria-label={`Stop ${run.label}`}
                        class="canvas-monitor-icon-action"
                        onClick={(event) => {
                          event.stopPropagation();
                          void interruptRun(run.id);
                        }}
                        title="Stop"
                        type="button"
                      >
                        <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
                          <rect x="7" y="7" width="10" height="10" rx="1" />
                        </svg>
                      </button>
                    </Show>
                    <button
                      aria-label={`Archive ${run.label}`}
                      class="canvas-monitor-icon-action"
                      onClick={(event) => {
                        event.stopPropagation();
                        void archiveRun(run.id);
                      }}
                      title="Archive"
                      type="button"
                    >
                      <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
                        <path d="M3 7h18v13H3z" />
                        <path d="M7 7V4h10v3" />
                        <path d="M7 12h10" />
                      </svg>
                    </button>
                    <button
                      aria-label={`Kill ${run.label}`}
                      class="canvas-monitor-icon-action danger"
                      onClick={(event) => {
                        event.stopPropagation();
                        void deleteRun(run);
                      }}
                      title="Kill"
                      type="button"
                    >
                      <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
                        <path d="M3 6h18" />
                        <path d="M8 6V4h8v2" />
                        <path d="M6 6l1 15h10l1-15" />
                        <path d="M10 11v6M14 11v6" />
                      </svg>
                    </button>
                  </div>
                </div>
                <Show when={expandedRunIds().has(run.id)}>
                  <div class="canvas-monitor-history">
                    <Show when={logsByRunId()[run.id]?.error}>
                      {(message) => (
                        <div class="canvas-monitor-history-error">
                          {message()}
                        </div>
                      )}
                    </Show>
                    <Show
                      when={(logsByRunId()[run.id]?.events.length ?? 0) > 0}
                      fallback={
                        <p class="canvas-monitor-history-empty">
                          {logsByRunId()[run.id]?.loading
                            ? "Loading history..."
                            : "No history yet."}
                        </p>
                      }
                    >
                      <div
                        class="canvas-monitor-history-scroll"
                        onScroll={(event) => {
                          scrollPositions.set(
                            run.id,
                            event.currentTarget.scrollTop
                          );
                        }}
                        ref={(element) => {
                          scrollRefs.set(run.id, element);
                        }}
                      >
                        <For
                          each={toMonitorHistory(
                            logsByRunId()[run.id]?.events ?? []
                          )}
                        >
                          {(item) => (
                            <div
                              class={`canvas-monitor-history-entry ${item.tone}`}
                            >
                              <Show when={item.title}>
                                {(title) => (
                                  <div class="canvas-monitor-history-title">
                                    {title()}
                                  </div>
                                )}
                              </Show>
                              <Show when={item.meta}>
                                {(meta) => (
                                  <div class="canvas-monitor-history-meta">
                                    {meta()}
                                  </div>
                                )}
                              </Show>
                              <MonitorHistoryBody item={item} />
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                </Show>
              </article>
            )}
          </For>
        </div>
      </Show>
      <style>{`
        .canvas-monitor {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .canvas-monitor-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .canvas-monitor h2 {
          margin: 0;
          color: var(--text-primary);
        }
        .canvas-monitor p {
          margin: 0;
          color: var(--text-secondary);
          font-size: 14px;
        }
        .canvas-monitor-refresh {
          border: 1px solid var(--border-default);
          background: var(--surface-secondary);
          color: var(--text-primary);
          border-radius: 6px;
          padding: 7px 10px;
          cursor: pointer;
          font-size: 12px;
        }
        .canvas-monitor-error {
          border: 1px solid rgba(239, 68, 68, 0.35);
          color: #fca5a5;
          border-radius: 6px;
          padding: 8px 10px;
          font-size: 13px;
        }
        .canvas-monitor-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .canvas-monitor-run {
          border: 1px solid var(--border-default);
          border-radius: 8px;
          padding: 12px;
          background: var(--surface-secondary);
        }
        .canvas-monitor-run-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
        }
        .canvas-monitor-run-toggle {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          min-width: 0;
          flex: 1;
          border: 0;
          padding: 0;
          background: transparent;
          color: inherit;
          text-align: left;
          cursor: pointer;
        }
        .canvas-monitor-run-main {
          min-width: 0;
        }
        .canvas-monitor-run-actions {
          display: flex;
          align-items: center;
          gap: 4px;
          flex: 0 0 auto;
          opacity: 0;
          pointer-events: none;
          transition: opacity 120ms ease;
        }
        .canvas-monitor-run:hover .canvas-monitor-run-actions,
        .canvas-monitor-run:focus-within .canvas-monitor-run-actions {
          opacity: 1;
          pointer-events: auto;
        }
        .canvas-monitor-icon-action {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 24px;
          border: 1px solid var(--border-default);
          border-radius: 6px;
          background: rgba(148, 163, 184, 0.08);
          color: var(--text-secondary);
          cursor: pointer;
          padding: 0;
        }
        .canvas-monitor-icon-action:hover {
          color: var(--text-primary);
          background: rgba(148, 163, 184, 0.16);
        }
        .canvas-monitor-icon-action.danger:hover {
          color: #fca5a5;
          border-color: rgba(239, 68, 68, 0.35);
          background: rgba(239, 68, 68, 0.1);
        }
        .canvas-monitor-icon-action svg {
          width: 13px;
          height: 13px;
          stroke: currentColor;
          stroke-width: 2;
          stroke-linecap: round;
          stroke-linejoin: round;
        }
        .canvas-monitor-run-title,
        .canvas-monitor-run-meta {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }
        .canvas-monitor-run-title strong {
          color: var(--text-primary);
          font-size: 14px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .canvas-monitor-run-title span,
        .canvas-monitor-run-meta span {
          color: var(--text-secondary);
          font-size: 12px;
        }
        .canvas-monitor-run-meta {
          margin-top: 5px;
          flex-wrap: wrap;
        }
        .canvas-monitor-output {
          margin-top: 8px !important;
          color: var(--text-primary) !important;
          overflow: hidden;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }
        .canvas-monitor-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--text-secondary);
          flex: 0 0 auto;
        }
        .canvas-monitor-dot.running,
        .canvas-monitor-dot.starting {
          background: #22c55e;
        }
        .canvas-monitor-dot.error {
          background: #ef4444;
        }
        .canvas-monitor-dot.interrupted {
          background: #f59e0b;
        }
        .canvas-monitor-history {
          margin-top: 10px;
          border-top: 1px solid var(--border-default);
          padding-top: 10px;
        }
        .canvas-monitor-history-scroll {
          display: flex;
          flex-direction: column;
          gap: 10px;
          max-height: 360px;
          overflow: auto;
          padding-right: 4px;
        }
        .canvas-monitor-history-entry {
          width: min(100%, 760px);
          border: 1px solid var(--border-default);
          border-radius: 8px;
          padding: 9px 10px;
          background: var(--surface-primary);
        }
        .canvas-monitor-history-entry.user {
          align-self: flex-end;
          background: rgba(59, 130, 246, 0.12);
          border-color: rgba(59, 130, 246, 0.28);
        }
        .canvas-monitor-history-entry.assistant {
          align-self: flex-start;
        }
        .canvas-monitor-history-entry.tool,
        .canvas-monitor-history-entry.system {
          align-self: stretch;
          width: 100%;
          background: rgba(148, 163, 184, 0.08);
        }
        .canvas-monitor-history-entry.error {
          align-self: stretch;
          width: 100%;
          background: rgba(239, 68, 68, 0.1);
          border-color: rgba(239, 68, 68, 0.3);
        }
        .canvas-monitor-history-title {
          color: var(--text-primary);
          font-size: 12px;
          font-weight: 600;
          margin-bottom: 4px;
        }
        .canvas-monitor-history-meta {
          color: var(--text-secondary);
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
            "Liberation Mono", "Courier New", monospace;
          font-size: 11px;
          margin-bottom: 6px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .canvas-monitor-history-markdown {
          color: var(--text-primary);
          font-size: 13px;
          line-height: 1.5;
          overflow-wrap: anywhere;
        }
        .canvas-monitor-history-markdown p,
        .canvas-monitor-history-markdown ul,
        .canvas-monitor-history-markdown ol,
        .canvas-monitor-history-markdown pre {
          margin: 0;
        }
        .canvas-monitor-history-markdown p + p,
        .canvas-monitor-history-markdown p + ul,
        .canvas-monitor-history-markdown p + ol,
        .canvas-monitor-history-markdown ul + p,
        .canvas-monitor-history-markdown ol + p,
        .canvas-monitor-history-markdown pre + p {
          margin-top: 8px;
        }
        .canvas-monitor-history-markdown ul,
        .canvas-monitor-history-markdown ol {
          padding-left: 20px;
        }
        .canvas-monitor-history-markdown li + li {
          margin-top: 4px;
        }
        .canvas-monitor-history-markdown code,
        .canvas-monitor-history-markdown pre,
        .canvas-monitor-history-mono {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
            "Liberation Mono", "Courier New", monospace;
          font-size: 12px;
        }
        .canvas-monitor-history-markdown code {
          border: 1px solid var(--border-default);
          border-radius: 4px;
          background: rgba(148, 163, 184, 0.12);
          padding: 1px 4px;
        }
        .canvas-monitor-history-markdown pre {
          margin-top: 8px;
          border: 1px solid var(--border-default);
          border-radius: 6px;
          background: rgba(148, 163, 184, 0.1);
          padding: 8px;
          overflow: auto;
          white-space: pre;
        }
        .canvas-monitor-history-markdown pre code {
          border: 0;
          background: transparent;
          padding: 0;
        }
        .canvas-monitor-history-mono {
          margin: 0;
          color: var(--text-primary);
          line-height: 1.45;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
        }
        .canvas-monitor-history-entry.system .canvas-monitor-history-markdown,
        .canvas-monitor-history-entry.system .canvas-monitor-history-title {
          color: var(--text-secondary);
        }
        .canvas-monitor-history-entry.error .canvas-monitor-history-mono,
        .canvas-monitor-history-entry.error .canvas-monitor-history-markdown,
        .canvas-monitor-history-entry.error .canvas-monitor-history-title {
          color: #fca5a5;
        }
        .canvas-monitor-history-empty,
        .canvas-monitor-history-error {
          font-size: 13px !important;
        }
        .canvas-monitor-history-error {
          color: #fca5a5 !important;
        }
      `}</style>
    </div>
  );
}
