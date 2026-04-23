import {
  createSignal,
  createEffect,
  onMount,
  onCleanup,
  createMemo,
  Show,
  For,
  type JSX,
} from "solid-js";
import { fetchAgents, fetchCapabilities } from "../api/client";
import type { Agent } from "../api/types";

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
  const [messages, setMessages] = createSignal<Array<{ role: string; content: string }>>([]);

  const selectedAgent = createMemo(() =>
    agents().find((a) => a.id === selectedAgentId())
  );

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
  });

  // ── Chat ──────────────────────────────────────────────────────────

  function handleSend() {
    const text = chatInput().trim();
    if (!text) return;
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setChatInput("");

    // TODO: wire to actual agent chat API
    setMessages((prev) => [
      ...prev,
      { role: "assistant", content: `Echo: ${text}` },
    ]);
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div class="board">
      {/* Left pane: Chat */}
      <div class="board-chat">
        <div class="board-chat-header">
          <select
            class="board-agent-select"
            value={selectedAgentId() ?? ""}
            onChange={(e) => setSelectedAgentId(e.currentTarget.value)}
          >
            <For each={agents()}>
              {(agent) => (
                <option value={agent.id}>
                  {agent.avatar ? `${agent.avatar} ` : ""}
                  {agent.name}
                </option>
              )}
            </For>
          </select>
        </div>

        <div class="board-chat-messages">
          <For each={messages()}>
            {(msg) => (
              <div class={`board-msg board-msg-${msg.role}`}>
                <div class="board-msg-content">{msg.content}</div>
              </div>
            )}
          </For>
          <Show when={messages().length === 0}>
            <div class="board-chat-empty">
              <p>Select an agent and start chatting.</p>
            </div>
          </Show>
        </div>

        <div class="board-chat-input-area">
          <textarea
            class="board-chat-input"
            placeholder="Message..."
            value={chatInput()}
            onInput={(e) => setChatInput(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            rows={2}
          />
          <button class="board-chat-send" onClick={handleSend} type="button">
            Send
          </button>
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

        .board-chat {
          width: 420px;
          min-width: 320px;
          max-width: 50%;
          display: flex;
          flex-direction: column;
          border-right: 1px solid var(--border-default);
          background: var(--bg-base);
        }

        .board-chat-header {
          padding: 12px 16px;
          border-bottom: 1px solid var(--border-default);
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .board-agent-select {
          flex: 1;
          padding: 6px 10px;
          border-radius: 6px;
          border: 1px solid var(--border-default);
          background: var(--bg-surface);
          color: var(--text-primary);
          font-size: 14px;
        }

        .board-chat-messages {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .board-chat-empty {
          flex: 1;
          display: grid;
          place-items: center;
          color: var(--text-secondary);
          font-size: 14px;
        }

        .board-msg {
          max-width: 85%;
          padding: 10px 14px;
          border-radius: 12px;
          font-size: 14px;
          line-height: 1.5;
          white-space: pre-wrap;
          word-break: break-word;
        }

        .board-msg-user {
          align-self: flex-end;
          background: var(--bg-accent);
          color: var(--text-on-accent);
          border-bottom-right-radius: 4px;
        }

        .board-msg-assistant {
          align-self: flex-start;
          background: var(--bg-surface);
          color: var(--text-primary);
          border: 1px solid var(--border-default);
          border-bottom-left-radius: 4px;
        }

        .board-chat-input-area {
          padding: 12px 16px;
          border-top: 1px solid var(--border-default);
          display: flex;
          gap: 8px;
          align-items: flex-end;
        }

        .board-chat-input {
          flex: 1;
          padding: 8px 12px;
          border-radius: 8px;
          border: 1px solid var(--border-default);
          background: var(--bg-surface);
          color: var(--text-primary);
          font-size: 14px;
          font-family: inherit;
          resize: none;
        }

        .board-chat-input:focus {
          outline: none;
          border-color: var(--border-accent);
        }

        .board-chat-send {
          padding: 8px 16px;
          border-radius: 8px;
          border: none;
          background: var(--bg-accent);
          color: var(--text-on-accent);
          font-size: 14px;
          cursor: pointer;
          font-weight: 500;
        }

        .board-chat-send:hover {
          opacity: 0.9;
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
