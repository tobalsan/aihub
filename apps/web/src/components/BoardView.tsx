import {
  createSignal,
  createEffect,
  onMount,
  onCleanup,
  createMemo,
  Show,
  For,
} from "solid-js";
import {
  fetchAgents,
  fetchFullHistory,
  fetchRuntimeSubagents,
  getSessionKey,
  interruptRuntimeSubagent,
  postAbort,
  streamMessage,
  subscribeToSubagentChanges,
  subscribeToSession,
} from "../api/client";
import type { ActiveTurn } from "../api/client";
import type {
  Agent,
  FullHistoryMessage,
  FullToolResultMessage,
} from "../api/types";
import type { SubagentRun } from "@aihub/shared/types";
import { buildBoardLogs, BoardChatLog } from "./BoardChatRenderer";
import type { BoardLogItem } from "./BoardChatRenderer";
import { ScratchpadEditor } from "./ScratchpadEditor";

// ── Types ───────────────────────────────────────────────────────────

type CanvasPanel = "overview" | "projects" | "agents" | "spec" | "monitor";

interface CanvasState {
  panel: CanvasPanel;
  props?: Record<string, unknown>;
}

// ── API helpers ─────────────────────────────────────────────────────

const API_BASE = "/api/board";

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
    null
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

  let messagesEl: HTMLDivElement | undefined;
  let inputEl: HTMLTextAreaElement | undefined;
  let stopStream: (() => void) | null = null;
  let stopSubscription: (() => void) | null = null;
  let historyLoadVersion = 0;
  let activeQueuedMessage: string | null = null;

  const selectedAgent = createMemo(() =>
    agents().find((a) => a.id === selectedAgentId())
  );
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

  function appendUserLog(text: string) {
    setLogItems((prev) => [
      ...prev,
      { type: "text", role: "user", content: text },
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
      if (list.length > 0 && !selectedAgentId()) {
        setSelectedAgentId(list[0].id);
      }
    } catch (err) {
      console.error("[BoardView] failed to load agents:", err);
    }
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
    mode: "normal" | "queued"
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
      }
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

  function handleSend() {
    const agentId = selectedAgentId();
    const text = chatInput().trim();
    if (!agentId || !text) return;

    setChatInput("");
    resetInputHeight();

    if (isStreaming()) {
      setQueuedMessages((prev) => [...prev, text]);
      setStickToBottom(true);
      scrollToBottom(true);
      return;
    }

    appendUserLog(text);
    sendStreamMessage(agentId, text, "normal");
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
      handleSend();
    }
  }

  function handleInputChange(e: Event) {
    const target = e.currentTarget as HTMLTextAreaElement;
    setChatInput(target.value);
    // Auto-resize
    target.style.height = "auto";
    target.style.height = Math.min(target.scrollHeight, 160) + "px";
  }

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div class="board">
      {/* Left pane: Chat */}
      <div class="board-chat">
        <div class="board-chat-header">
          <div class="board-chat-agent-info">
            <Show
              when={selectedAgent()?.avatar}
              fallback={
                <div class="board-chat-agent-avatar board-chat-agent-avatar--default">
                  AI
                </div>
              }
            >
              <div class="board-chat-agent-avatar">
                {selectedAgent()?.avatar}
              </div>
            </Show>
            <select
              class="board-agent-select"
              value={selectedAgentId() ?? ""}
              onChange={(e) => setSelectedAgentId(e.currentTarget.value)}
            >
              <For each={agents()}>
                {(agent) => <option value={agent.id}>{agent.name}</option>}
              </For>
            </select>
          </div>
        </div>

        <div
          class="board-chat-messages"
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
          <div class="board-chat-input-wrapper">
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
                  onClick={handleSend}
                  type="button"
                  disabled={!chatInput().trim()}
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

        .board-chat-input {
          flex: 1;
          padding: 12px 4px 12px 16px;
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
  switch (props.state.panel) {
    case "overview":
      return <OverviewPanel />;
    case "projects":
      return <ProjectsPanel />;
    case "agents":
    case "monitor":
      return <MonitorPanel agentId={props.agentId} />;
    default:
      return <OverviewPanel />;
  }
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
          max-width: 600px;
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
  return (
    <div class="canvas-projects">
      <h2>Projects</h2>
      <p>Project list will appear here — wired to the projects store.</p>
      <style>{`
        .canvas-projects h2 {
          margin: 0 0 12px;
          color: var(--text-primary);
        }
        .canvas-projects p {
          color: var(--text-secondary);
          font-size: 14px;
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

function MonitorPanel(props: { agentId: string | null }) {
  const [runs, setRuns] = createSignal<SubagentRun[]>([]);
  const [error, setError] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);
  const scopedParent = createMemo(() =>
    props.agentId
      ? `agent-session:${props.agentId}:${getSessionKey(props.agentId)}`
      : undefined
  );

  async function loadRuns() {
    setLoading(true);
    try {
      const parent = scopedParent();
      const data = await fetchRuntimeSubagents(
        parent ? { parent } : { status: "running" }
      );
      setRuns(data.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function interruptRun(runId: string) {
    const result = await interruptRuntimeSubagent(runId);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await loadRuns();
  }

  createEffect(() => {
    scopedParent();
    void loadRuns();
  });

  const unsubscribe = subscribeToSubagentChanges({
    onSubagentChanged: (event) => {
      const parent = scopedParent();
      if (!parent || parentKey(event.parent) === parent) void loadRuns();
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
        <button class="canvas-monitor-refresh" onClick={loadRuns} type="button">
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
            {loading() ? "Loading subagents..." : "No active subagents."}
          </p>
        }
      >
        <div class="canvas-monitor-list">
          <For each={runs()}>
            {(run) => (
              <article class="canvas-monitor-run">
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
                <Show when={run.status === "running"}>
                  <button
                    class="canvas-monitor-stop"
                    onClick={() => void interruptRun(run.id)}
                    type="button"
                  >
                    Stop
                  </button>
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
        .canvas-monitor-refresh,
        .canvas-monitor-stop {
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
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          border: 1px solid var(--border-default);
          border-radius: 8px;
          padding: 12px;
          background: var(--surface-secondary);
        }
        .canvas-monitor-run-main {
          min-width: 0;
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
      `}</style>
    </div>
  );
}
