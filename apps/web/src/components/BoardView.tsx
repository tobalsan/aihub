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
  getSessionKey,
  postAbort,
  streamMessage,
  subscribeToSession,
} from "../api/client";
import type { Agent, FullHistoryMessage } from "../api/types";
import { buildBoardLogs, BoardChatLog } from "./BoardChatRenderer";
import type { BoardLogItem } from "./BoardChatRenderer";
import { ScratchpadEditor } from "./ScratchpadEditor";

// ── Types ───────────────────────────────────────────────────────────

type CanvasPanel =
  | "overview"
  | "projects"
  | "agents"
  | "spec"
  | "monitor";

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
  const [selectedAgentId, setSelectedAgentId] = createSignal<string | null>(null);
  const [canvas, setCanvas] = createSignal<CanvasState>({ panel: "overview" });
  const [chatInput, setChatInput] = createSignal("");
  const [logItems, setLogItems] = createSignal<BoardLogItem[]>([]);
  const [liveText, setLiveText] = createSignal("");
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
    const items = logItems().slice();
    const text = liveText();
    if (text) {
      items.push({ type: "text", role: "assistant", content: text });
    }
    return items;
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
    setLogItems((prev) => [...prev, { type: "text", role: "user", content: text }]);
  }

  function appendAssistantLog(text: string) {
    if (!text) return;
    setLogItems((prev) => [
      ...prev,
      { type: "text", role: "assistant", content: text },
    ]);
  }

  function toolIcon(name: string): "read" | "write" | "bash" | "tool" {
    const key = name.toLowerCase();
    if (key === "read") return "read";
    if (key === "bash" || key === "exec_command") return "bash";
    if (key === "write" || key === "apply_patch") return "write";
    return "tool";
  }

  function summarizeToolTitle(name: string, args: unknown): string {
    const a = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
    const key = name.toLowerCase();
    if (key === "read") return `Read ${String(a.path ?? a.file_path ?? "file")}`;
    if (key === "bash" || key === "exec_command") {
      return `Bash ${String(a.cmd ?? a.command ?? "")}`.trim();
    }
    if (key === "write" || key === "apply_patch") {
      return `Edit ${String(a.path ?? a.file_path ?? "file")}`;
    }
    return name;
  }

  function appendToolLog(name: string, args: unknown) {
    setLogItems((prev) => [
      ...prev,
      {
        type: "tool",
        toolName: name,
        title: summarizeToolTitle(name, args),
        body: "",
        icon: toolIcon(name),
        expanded: false,
      },
    ]);
  }

  function updateToolLog(name: string, content: string) {
    setLogItems((prev) => {
      for (let i = prev.length - 1; i >= 0; i -= 1) {
        const item = prev[i];
        if (item.type === "tool" && item.toolName === name && !item.body) {
          return [
            ...prev.slice(0, i),
            { ...item, body: content },
            ...prev.slice(i + 1),
          ];
        }
      }
      return prev;
    });
  }

  function clearLiveText() {
    setLiveText("");
  }

  function buildHistoryLogItems(messages: FullHistoryMessage[]): BoardLogItem[] {
    return buildBoardLogs(messages);
  }

  function attachSessionSubscription(agentId: string, sessionKey: string) {
    cleanupSubscription();
    stopSubscription = subscribeToSession(agentId, sessionKey, {
      onText(text) {
        if (!text) return;
        setWaitingForFirstText(false);
        setLiveText((prev) => prev + text);
      },
      onToolCall(_id, name, args) {
        appendToolLog(name, args);
      },
      onToolResult(_id, name, content) {
        updateToolLog(name, content);
      },
      onDone() {
        cleanupSubscription();
        clearLiveText();
        setWaitingForFirstText(false);
        setIsStreaming(false);
        void loadHistory(agentId);
        processNextQueuedMessage(agentId);
      },
      onError(error) {
        cleanupSubscription();
        clearLiveText();
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
      if (version !== historyLoadVersion || selectedAgentId() !== agentId) return;

      const historyMessages: FullHistoryMessage[] = history.messages;
      const items = buildHistoryLogItems(historyMessages);

      if (history.isStreaming && history.activeTurn && !stopStream) {
        cleanupSubscription();
        attachSessionSubscription(agentId, sessionKey);
      }

      setLogItems(items);
      setLiveText(history.isStreaming ? history.activeTurn?.text ?? "" : "");
      setIsStreaming(Boolean(history.isStreaming));
      setWaitingForFirstText(
        Boolean(history.isStreaming && !history.activeTurn?.text?.trim())
      );
      scrollToBottom(true);
    } catch (err) {
      if (version !== historyLoadVersion || selectedAgentId() !== agentId) return;
      console.error("[BoardView] failed to load history:", err);
      setLogItems([]);
      clearLiveText();
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
    clearLiveText();
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
    clearLiveText();
    scrollToBottom(true);

    const sessionKey = getSessionKey(agentId);
    stopStream = streamMessage(
      agentId,
      text,
      sessionKey,
      (chunk) => {
        if (!chunk) return;
        setWaitingForFirstText(false);
        setLiveText((prev) => prev + chunk);
      },
      () => {
        cleanupStream();
        clearLiveText();
        setWaitingForFirstText(false);
        setIsStreaming(false);
        if (mode === "queued") {
          activeQueuedMessage = null;
        }
        void loadHistory(agentId);
        processNextQueuedMessage(agentId);
      },
      (error) => {
        cleanupStream();
        clearLiveText();
        setWaitingForFirstText(false);
        setIsStreaming(false);
        if (mode === "queued") {
          activeQueuedMessage = null;
        }
        appendAssistantLog(error);
        processNextQueuedMessage(agentId);
      },
      {
        onToolCall(_id, name, args) {
          appendToolLog(name, args);
        },
        onToolResult(_id, name, content) {
          updateToolLog(name, content);
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
      const partialText = liveText();
      if (partialText) {
        appendAssistantLog(partialText);
      }
      clearLiveText();
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
            <Show when={selectedAgent()?.avatar} fallback={
              <div class="board-chat-agent-avatar board-chat-agent-avatar--default">AI</div>
            }>
              <div class="board-chat-agent-avatar">{selectedAgent()?.avatar}</div>
            </Show>
            <select
              class="board-agent-select"
              value={selectedAgentId() ?? ""}
              onChange={(e) => setSelectedAgentId(e.currentTarget.value)}
            >
              <For each={agents()}>
                {(agent) => (
                  <option value={agent.id}>{agent.name}</option>
                )}
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
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
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
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  <span>You (queued)</span>
                </div>
                <div class="board-msg-content">{message}</div>
              </div>
            )}
          </For>
          <Show when={isStreaming() && waitingForFirstText()}>
            <div class="board-msg board-msg-assistant">
              <div class="board-msg-role">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
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
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
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
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
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
    case "monitor":
      return <MonitorPanel />;
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

function MonitorPanel() {
  return (
    <div class="canvas-monitor">
      <h2>Agent Monitor</h2>
      <p>Running subagents will stream here.</p>
      <style>{`
        .canvas-monitor h2 {
          margin: 0 0 12px;
          color: var(--text-primary);
        }
        .canvas-monitor p {
          color: var(--text-secondary);
          font-size: 14px;
        }
      `}</style>
    </div>
  );
}
