import { createSignal, createEffect, createResource, createMemo, For, onCleanup, Show } from "solid-js";
import { useParams, useNavigate, A } from "@solidjs/router";
import { streamMessage, getSessionKey, fetchSimpleHistory, fetchFullHistory, fetchAgent } from "../api/client";
import type {
  Message,
  HistoryViewMode,
  FullHistoryMessage,
  ContentBlock,
  ModelMeta,
  ActiveToolCall,
} from "../api/types";

// Threshold for auto-collapsing content
const COLLAPSE_THRESHOLD = 200;

function isLongContent(content: string): boolean {
  return content.length > COLLAPSE_THRESHOLD;
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
}) {
  const shouldCollapse = props.defaultCollapsed ?? isLongContent(props.content);
  const [collapsed, setCollapsed] = createSignal(shouldCollapse);

  return (
    <div class={`collapsible-block ${props.isError ? "error" : ""}`}>
      <button class="collapse-header" onClick={() => setCollapsed(!collapsed())}>
        <span class="collapse-icon">{collapsed() ? "▶" : "▼"}</span>
        <span class="collapse-title">{props.title}</span>
        {collapsed() && <span class="collapse-hint">{props.content.slice(0, 50)}...</span>}
      </button>
      <Show when={!collapsed()}>
        <div class={`collapse-content ${props.mono ? "mono" : ""}`}>{props.content}</div>
      </Show>
    </div>
  );
}

// Render content blocks for full mode
function ContentBlocks(props: { blocks: ContentBlock[] }) {
  return (
    <div class="content-blocks">
      <For each={props.blocks}>
        {(block) => {
          if (block.type === "text") {
            return <div class="block-text">{block.text}</div>;
          }
          if (block.type === "thinking") {
            return (
              <CollapsibleBlock
                title="Thinking"
                content={block.thinking}
                defaultCollapsed={true}
              />
            );
          }
          if (block.type === "toolCall") {
            const argsStr = formatJson(block.arguments);
            return (
              <CollapsibleBlock
                title={`Tool: ${block.name}`}
                content={argsStr}
                defaultCollapsed={isLongContent(argsStr)}
                mono={true}
              />
            );
          }
          return null;
        }}
      </For>
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
            <span class="tool-icon">{tool.status === "running" ? "⟳" : tool.status === "error" ? "✗" : "✓"}</span>
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
  const [fullMessages, setFullMessages] = createSignal<FullHistoryMessage[]>([]);
  const [input, setInput] = createSignal("");
  const [isStreaming, setIsStreaming] = createSignal(false);
  const [streamingText, setStreamingText] = createSignal("");
  const [activeTools, setActiveTools] = createSignal<ActiveToolCall[]>([]);
  const [loading, setLoading] = createSignal(true);

  let messagesEndRef: HTMLDivElement | undefined;
  let cleanup: (() => void) | null = null;

  const sessionKey = () => getSessionKey(params.agentId);

  const scrollToBottom = () => {
    messagesEndRef?.scrollIntoView({ behavior: "smooth" });
  };

  // Load history based on view mode
  const loadHistory = async (mode: HistoryViewMode) => {
    setLoading(true);
    if (mode === "full") {
      const history = await fetchFullHistory(params.agentId, sessionKey());
      setFullMessages(history);
    } else {
      const history = await fetchSimpleHistory(params.agentId, sessionKey());
      setSimpleMessages(
        history.map((h) => ({
          id: crypto.randomUUID(),
          role: h.role,
          content: h.content,
          timestamp: h.timestamp,
        }))
      );
    }
    setLoading(false);
  };

  // Load history when agent is loaded or view mode changes
  createEffect(() => {
    const mode = viewMode(); // track viewMode
    if (agent()) loadHistory(mode);
  });

  createEffect(() => {
    simpleMessages();
    fullMessages();
    streamingText();
    activeTools();
    scrollToBottom();
  });

  onCleanup(() => {
    cleanup?.();
  });

  const handleViewChange = (mode: HistoryViewMode) => {
    if (mode !== viewMode()) {
      const path = mode === "full"
        ? `/chat/${params.agentId}/full`
        : `/chat/${params.agentId}`;
      navigate(path, { replace: true });
    }
  };

  const handleSend = () => {
    const text = input().trim();
    if (!text || isStreaming() || loading()) return;

    // Add user message to simple view
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      timestamp: Date.now(),
    };
    setSimpleMessages((prev) => [...prev, userMsg]);

    // Add to full view too
    setFullMessages((prev) => [
      ...prev,
      { role: "user", content: [{ type: "text", text }], timestamp: Date.now() },
    ]);

    setInput("");
    setIsStreaming(true);
    setStreamingText("");
    setActiveTools([]);

    cleanup = streamMessage(
      params.agentId,
      text,
      sessionKey(),
      (chunk) => {
        setStreamingText((prev) => prev + chunk);
      },
      () => {
        // Add assistant message
        const content = streamingText();
        setSimpleMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: "assistant", content, timestamp: Date.now() },
        ]);
        setFullMessages((prev) => [
          ...prev,
          { role: "assistant", content: [{ type: "text", text: content }], timestamp: Date.now() },
        ]);
        setStreamingText("");
        setActiveTools([]);
        setIsStreaming(false);
        cleanup = null;
      },
      (error) => {
        const content = `Error: ${error}`;
        setSimpleMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: "assistant", content, timestamp: Date.now() },
        ]);
        setStreamingText("");
        setActiveTools([]);
        setIsStreaming(false);
        cleanup = null;
      },
      {
        onToolStart: (toolName) => {
          setActiveTools((prev) => [
            ...prev,
            { id: crypto.randomUUID(), toolName, status: "running" },
          ]);
        },
        onToolEnd: (toolName, isError) => {
          setActiveTools((prev) =>
            prev.map((t) =>
              t.toolName === toolName && t.status === "running"
                ? { ...t, status: isError ? "error" : "done" }
                : t
            )
          );
        },
      }
    );
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div class="chat-view">
      <header class="header">
        <A href="/" class="back-btn" aria-label="Go back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </A>
        <div class="agent-info">
          <div class="agent-name">{agent()?.name ?? "Loading..."}</div>
          <div class="agent-status">
            <span class="status-dot" classList={{ active: isStreaming() }} />
            <span class="status-text">{isStreaming() ? "thinking" : "online"}</span>
          </div>
        </div>
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

      <div class="messages">
        <Show when={viewMode() === "simple"}>
          <For each={simpleMessages()}>
            {(msg) => (
              <div class={`message ${msg.role}`}>
                <div class="content">{msg.content}</div>
              </div>
            )}
          </For>
        </Show>

        <Show when={viewMode() === "full"}>
          <For each={fullMessages()}>
            {(msg) => {
              if (msg.role === "user") {
                const textContent = msg.content
                  .filter((b): b is { type: "text"; text: string } => b.type === "text")
                  .map((b) => b.text)
                  .join("\n");
                return (
                  <div class="message user">
                    <div class="content">{textContent}</div>
                  </div>
                );
              }
              if (msg.role === "assistant") {
                return (
                  <div class="message assistant full-message">
                    <ContentBlocks blocks={msg.content} />
                    {msg.meta && <ModelMetaDisplay meta={msg.meta} />}
                  </div>
                );
              }
              if (msg.role === "toolResult") {
                const textContent = msg.content
                  .filter((b): b is { type: "text"; text: string } => b.type === "text")
                  .map((b) => b.text)
                  .join("\n");
                return (
                  <div class={`message tool-result ${msg.isError ? "error" : ""}`}>
                    <CollapsibleBlock
                      title={`${msg.isError ? "✗" : "✓"} ${msg.toolName}`}
                      content={textContent || "(no output)"}
                      defaultCollapsed={isLongContent(textContent)}
                      isError={msg.isError}
                      mono={true}
                    />
                    {msg.details?.diff && (
                      <CollapsibleBlock
                        title="Diff"
                        content={msg.details.diff}
                        defaultCollapsed={true}
                        mono={true}
                      />
                    )}
                  </div>
                );
              }
              return null;
            }}
          </For>
        </Show>

        {isStreaming() && !streamingText() && (
          <div class="message assistant thinking">
            <div class="thinking-dots">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}

        <Show when={viewMode() === "full" && activeTools().length > 0}>
          <ActiveToolIndicator tools={activeTools()} />
        </Show>

        {streamingText() && (
          <div class="message assistant streaming">
            <div class="content">{streamingText()}</div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div class="input-area">
        <div class="input-wrapper">
          <textarea
            class="input"
            placeholder="Message..."
            value={input()}
            onInput={(e) => setInput(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            disabled={isStreaming()}
            rows={1}
          />
        </div>
        <button
          class="send-btn"
          onClick={handleSend}
          disabled={!input().trim() || isStreaming() || loading()}
          aria-label="Send message"
        >
          <svg class="send-icon" width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      </div>

      <style>{`
        .chat-view {
          --accent: #6366f1;
          --accent-glow: rgba(99, 102, 241, 0.4);
          --surface-0: #09090b;
          --surface-1: #18181b;
          --surface-2: #27272a;
          --surface-3: #3f3f46;
          --text-primary: #fafafa;
          --text-secondary: #a1a1aa;
          --text-muted: #52525b;
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

        /* Content blocks */
        .content-blocks {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .block-text {
          white-space: pre-wrap;
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
          gap: 12px;
          padding: 16px 20px 24px;
          background: var(--surface-0);
          border-top: 1px solid var(--surface-2);
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
          resize: none;
          outline: none;
          font-family: inherit;
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
      `}</style>
    </div>
  );
}
