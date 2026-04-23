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
  fetchSimpleHistory,
  getSessionKey,
  postAbort,
  streamMessage,
  subscribeToSession,
} from "../api/client";
import type { Agent, SimpleHistoryMessage } from "../api/types";

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

type BoardMessage = {
  role: "user" | "assistant";
  content: string;
};

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
  const [messages, setMessages] = createSignal<BoardMessage[]>([]);
  const [isStreaming, setIsStreaming] = createSignal(false);
  const [waitingForFirstText, setWaitingForFirstText] = createSignal(false);
  const [stickToBottom, setStickToBottom] = createSignal(true);

  let messagesEl: HTMLDivElement | undefined;
  let inputEl: HTMLTextAreaElement | undefined;
  let stopStream: (() => void) | null = null;
  let stopSubscription: (() => void) | null = null;
  let historyLoadVersion = 0;

  const selectedAgent = createMemo(() =>
    agents().find((a) => a.id === selectedAgentId())
  );

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

  function toBoardMessages(history: SimpleHistoryMessage[]): BoardMessage[] {
    return history.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));
  }

  function appendAssistantText(text: string) {
    if (!text) return;
    setMessages((prev) => {
      const next = prev.slice();
      const last = next[next.length - 1];
      if (last?.role === "assistant") {
        next[next.length - 1] = {
          ...last,
          content: `${last.content}${text}`,
        };
        return next;
      }
      next.push({ role: "assistant", content: text });
      return next;
    });
  }

  function setAssistantMessage(content: string) {
    setMessages((prev) => {
      const next = prev.slice();
      const last = next[next.length - 1];
      if (last?.role === "assistant") {
        next[next.length - 1] = { ...last, content };
        return next;
      }
      next.push({ role: "assistant", content });
      return next;
    });
  }

  function removeEmptyTrailingAssistant() {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role !== "assistant" || last.content.trim()) return prev;
      return prev.slice(0, -1);
    });
  }

  function attachSessionSubscription(agentId: string, sessionKey: string) {
    cleanupSubscription();
    stopSubscription = subscribeToSession(agentId, sessionKey, {
      onText(text) {
        if (!text) return;
        setWaitingForFirstText(false);
        appendAssistantText(text);
      },
      onDone() {
        cleanupSubscription();
        setWaitingForFirstText(false);
        setIsStreaming(false);
        void loadHistory(agentId);
      },
      onError(error) {
        cleanupSubscription();
        setWaitingForFirstText(false);
        setIsStreaming(false);
        setAssistantMessage(error);
      },
    });
  }

  async function loadHistory(agentId: string) {
    const version = ++historyLoadVersion;
    const sessionKey = getSessionKey(agentId);

    try {
      const history = await fetchSimpleHistory(agentId, sessionKey);
      if (version !== historyLoadVersion || selectedAgentId() !== agentId) return;

      const nextMessages = toBoardMessages(history.messages);
      if (history.isStreaming && history.activeTurn) {
        const { userText, text } = history.activeTurn;
        const last = nextMessages[nextMessages.length - 1];
        if (
          userText &&
          (last?.role !== "user" || last.content !== userText)
        ) {
          nextMessages.push({ role: "user", content: userText });
        }
        nextMessages.push({ role: "assistant", content: text });
      }

      setMessages(nextMessages);
      setIsStreaming(Boolean(history.isStreaming && history.activeTurn));
      setWaitingForFirstText(
        Boolean(
          history.isStreaming &&
            history.activeTurn &&
            !history.activeTurn.text.trim()
        )
      );

      cleanupSubscription();
      if (history.isStreaming && history.activeTurn) {
        attachSessionSubscription(agentId, sessionKey);
      }
      scrollToBottom(true);
    } catch (err) {
      if (version !== historyLoadVersion || selectedAgentId() !== agentId) return;
      console.error("[BoardView] failed to load history:", err);
      setMessages([]);
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
    messages();
    waitingForFirstText();
    scrollToBottom();
  });

  createEffect(() => {
    const agentId = selectedAgentId();
    cleanupLiveConnections();
    historyLoadVersion += 1;
    setMessages([]);
    setIsStreaming(false);
    setWaitingForFirstText(false);
    setStickToBottom(true);
    if (!agentId) return;
    void loadHistory(agentId);
  });

  function handleSend() {
    const agentId = selectedAgentId();
    const text = chatInput().trim();
    if (!agentId || !text || isStreaming()) return;

    cleanupSubscription();
    setMessages((prev) => [
      ...prev,
      { role: "user", content: text },
      { role: "assistant", content: "" },
    ]);
    setChatInput("");
    setIsStreaming(true);
    setWaitingForFirstText(true);
    setStickToBottom(true);
    scrollToBottom(true);

    resetInputHeight();

    const sessionKey = getSessionKey(agentId);
    stopStream = streamMessage(
      agentId,
      text,
      sessionKey,
      (chunk) => {
        setWaitingForFirstText(false);
        appendAssistantText(chunk);
      },
      () => {
        cleanupStream();
        setWaitingForFirstText(false);
        setIsStreaming(false);
        void loadHistory(agentId);
      },
      (error) => {
        cleanupStream();
        setWaitingForFirstText(false);
        setIsStreaming(false);
        setAssistantMessage(error);
      }
    );
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
      setIsStreaming(false);
      setWaitingForFirstText(false);
      removeEmptyTrailingAssistant();
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
          <Show when={messages().length === 0 && !isStreaming()}>
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
          <For each={messages()}>
            {(msg, index) => {
              const content = () => {
                if (msg.content) return msg.content;
                if (
                  msg.role === "assistant" &&
                  index() === messages().length - 1 &&
                  isStreaming() &&
                  waitingForFirstText()
                ) {
                  return "Thinking...";
                }
                return "";
              };

              return (
              <div class={`board-msg board-msg-${msg.role}`}>
                <div class="board-msg-role">
                  <Show when={msg.role === "assistant"} fallback={
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  }>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
                  </Show>
                  <span>{msg.role === "user" ? "You" : selectedAgent()?.name ?? "Agent"}</span>
                </div>
                <Show when={content()}>
                  <div class="board-msg-content">{content()}</div>
                </Show>
              </div>
              );
            }}
          </For>
        </div>

        <div class="board-chat-input-area">
          <div class="board-chat-input-wrapper">
            <textarea
              class="board-chat-input"
              ref={inputEl}
              placeholder={isStreaming() ? "Agent is responding..." : "Ask anything..."}
              value={chatInput()}
              onInput={handleInputChange}
              onKeyDown={handleKeyDown}
              disabled={isStreaming()}
              rows={1}
            />
            <button
              class="board-chat-send"
              onClick={() => (isStreaming() ? handleAbort() : handleSend())}
              type="button"
              disabled={!isStreaming() && !chatInput().trim()}
              aria-label={isStreaming() ? "Stop response" : "Send message"}
            >
              <Show
                when={isStreaming()}
                fallback={
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                }
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="6" width="12" height="12" rx="1" />
                </svg>
              </Show>
            </button>
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
          border-color: var(--border-accent, var(--text-accent));
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
          line-height: 1.65;
          white-space: pre-wrap;
          word-break: break-word;
          color: var(--text-primary);
        }

        .board-msg-user .board-msg-content {
          padding: 10px 14px;
          border-radius: 12px;
          border-top-right-radius: 4px;
          background: var(--bg-accent);
          color: var(--text-on-accent);
        }

        .board-msg-assistant .board-msg-content {
          padding: 0;
          background: transparent;
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
          border-color: var(--border-accent, var(--text-accent));
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
          background: var(--text-accent, var(--bg-accent));
          color: white;
          cursor: pointer;
          transition: opacity 0.15s, transform 0.15s;
          flex-shrink: 0;
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
          outline: 2px solid var(--text-accent, var(--bg-accent));
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
          color: var(--text-accent);
          border-bottom-color: var(--text-accent);
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
      <p class="canvas-overview-subtitle">Board is ready. Start a conversation to begin.</p>
      <div class="canvas-overview-placeholder">
        <p>🚧 Canvas panels will populate as you interact with agents.</p>
      </div>
      <style>{`
        .canvas-overview {
          max-width: 600px;
        }
        .canvas-overview h1 {
          margin: 0 0 8px;
          font-size: 22px;
          color: var(--text-primary);
        }
        .canvas-overview-subtitle {
          margin: 0 0 24px;
          color: var(--text-secondary);
          font-size: 14px;
        }
        .canvas-overview-placeholder {
          padding: 20px;
          border: 1px dashed var(--border-default);
          border-radius: 8px;
          color: var(--text-secondary);
          font-size: 14px;
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
