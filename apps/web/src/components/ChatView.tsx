import { createSignal, createEffect, createResource, createMemo, For, onCleanup, Show } from "solid-js";
import { useParams, useNavigate, A } from "@solidjs/router";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { streamMessage, getSessionKey, fetchSimpleHistory, fetchFullHistory, fetchAgent, subscribeToSession, type DoneMeta } from "../api/client";
import type {
  Message,
  HistoryViewMode,
  FullHistoryMessage,
  FullToolResultMessage,
  ContentBlock,
  ModelMeta,
  ActiveToolCall,
  ThinkLevel,
} from "../api/types";

// Threshold for auto-collapsing content
const COLLAPSE_THRESHOLD = 200;

const timestampFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function formatTimestamp(timestamp: number): string {
  return timestampFormatter.format(new Date(timestamp));
}

// Render markdown to sanitized HTML
function renderMarkdown(content: string): string {
  const html = marked.parse(content, { breaks: true, async: false }) as string;
  return DOMPurify.sanitize(html);
}

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

// Extract text from content block, handling nested structures from older history
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
      <button class="collapse-header" onClick={() => setCollapsed(!collapsed())}>
        <span class="collapse-icon">{collapsed() ? "▶" : "▼"}</span>
        <span class="collapse-title">{props.title}</span>
        {collapsed() && <span class="collapse-hint">{props.content.slice(0, 50)}...</span>}
      </button>
      <Show when={!collapsed()}>
        <div class={`collapse-content ${props.mono ? "mono" : ""}`}>{props.content}</div>
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
            return <div class="block-text markdown-content" innerHTML={renderMarkdown(block.text)} />;
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
  const [thinkingLevel, setThinkingLevel] = createSignal<ThinkLevel | undefined>();
  const [pendingThinkLevel, setPendingThinkLevel] = createSignal<ThinkLevel | null>(null);
  const [input, setInput] = createSignal("");
  const [isStreaming, setIsStreaming] = createSignal(false);
  const [streamingThinking, setStreamingThinking] = createSignal("");
  const [streamingThinkingAt, setStreamingThinkingAt] = createSignal<number | null>(null);
  const [streamingToolCalls, setStreamingToolCalls] = createSignal<Array<{ id: string; name: string; arguments: unknown; status: "running" | "done" | "error"; timestamp: number }>>([]);
  const [streamingText, setStreamingText] = createSignal("");
  const [streamingTextAt, setStreamingTextAt] = createSignal<number | null>(null);
  const [streamingStartedAt, setStreamingStartedAt] = createSignal<number | null>(null);
  const [activeTools, setActiveTools] = createSignal<ActiveToolCall[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [pendingHistoryRefresh, setPendingHistoryRefresh] = createSignal(false);
  const [pendingQueuedMessages, setPendingQueuedMessages] = createSignal<Array<{ text: string; timestamp: number }>>([]);

  let messagesEndRef: HTMLDivElement | undefined;
  let messagesContainerRef: HTMLDivElement | undefined;
  let textareaRef: HTMLTextAreaElement | undefined;
  let cleanup: (() => void) | null = null;
  let subscriptionCleanup: (() => void) | null = null;

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

  // Load history based on view mode
  const loadHistory = async (mode: HistoryViewMode) => {
    setLoading(true);
    if (mode === "full") {
      const res = await fetchFullHistory(params.agentId, sessionKey());
      const pending = pendingQueuedMessages();
      const merged = pending.length
        ? [
            ...res.messages,
            ...pending.map((msg) => ({
              role: "user" as const,
              content: [{ type: "text" as const, text: msg.text }],
              timestamp: msg.timestamp,
            })),
          ]
        : res.messages;
      setFullMessages(merged);
      if (res.thinkingLevel) setThinkingLevel(res.thinkingLevel);
    } else {
      const res = await fetchSimpleHistory(params.agentId, sessionKey());
      const base = res.messages.map((h) => ({
        id: crypto.randomUUID(),
        role: h.role,
        content: h.content,
        timestamp: h.timestamp,
      }));
      const pending = pendingQueuedMessages();
      const merged = pending.length
        ? [
            ...base,
            ...pending.map((msg) => ({
              id: crypto.randomUUID(),
              role: "user" as const,
              content: msg.text,
              timestamp: msg.timestamp,
            })),
          ]
        : base;
      setSimpleMessages(merged);
      if (res.thinkingLevel) setThinkingLevel(res.thinkingLevel);
    }
    setLoading(false);
  };

  // Load history when agent is loaded or view mode changes
  // Skip if streaming - the user message was already added locally and server data is stale
  createEffect(() => {
    const mode = viewMode(); // track viewMode
    if (agent() && !isStreaming()) loadHistory(mode);
  });

  // Subscribe to live updates for background runs
  createEffect(() => {
    const agentId = params.agentId;
    const key = sessionKey();
    if (!agentId) return;

    subscriptionCleanup?.();
    subscriptionCleanup = subscribeToSession(agentId, key, {
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

  createEffect(() => {
    simpleMessages();
    fullMessages();
    streamingText();
    activeTools();
    scrollToBottom();
  });

  onCleanup(() => {
    cleanup?.();
    subscriptionCleanup?.();
  });

  const handleViewChange = (mode: HistoryViewMode) => {
    if (mode !== viewMode()) {
      const path = mode === "full"
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
    streamingText() || streamingThinking() || streamingToolCalls().length > 0;

  const handleSend = () => {
    const text = input().trim();
    if (!text || loading()) return;

    const levelToSend = pendingThinkLevel() ?? thinkingLevel();
    const currentAgent = agent();
    const queueMode = currentAgent?.queueMode ?? "queue";

    // Add user message to both views
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      timestamp: Date.now(),
    };
    setSimpleMessages((prev) => [...prev, userMsg]);
    setFullMessages((prev) => [
      ...prev,
      { role: "user", content: [{ type: "text", text }], timestamp: Date.now() },
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
        setPendingQueuedMessages((prev) => [...prev, { text, timestamp: Date.now() }]);
      }
      let queuedText = "";
      let queuedThinking = "";
      const queuedToolCalls: Array<{ id: string; name: string; arguments: unknown; status: "running" | "done" | "error"; timestamp: number }> = [];

      // Send queued message with minimal handlers (queue ack doesn't affect streaming state)
      const queueCleanup = streamMessage(
        params.agentId,
        text,
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
            setPendingQueuedMessages((prev) => (prev.length ? prev.slice(0, -1) : prev));
          }

          const blocks: ContentBlock[] = [];
          if (queuedThinking) {
            blocks.push({ type: "thinking", thinking: queuedThinking });
          }
          for (const tc of queuedToolCalls) {
            blocks.push({ type: "toolCall", id: tc.id, name: tc.name, arguments: tc.arguments });
          }
          if (queuedText) {
            blocks.push({ type: "text", text: queuedText });
          }

          if (queuedText || queuedThinking || queuedToolCalls.length > 0) {
            setSimpleMessages((prev) => [
              ...prev,
              { id: crypto.randomUUID(), role: "assistant", content: queuedText, timestamp: Date.now() },
            ]);
            setFullMessages((prev) => [
              ...prev,
              { role: "assistant", content: blocks.length > 0 ? blocks : [{ type: "text", text: queuedText }], timestamp: Date.now() },
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
            { id: crypto.randomUUID(), role: "assistant", content, timestamp: Date.now() },
          ]);
          if (queueCleanup) queueCleanup();
        },
        {
          onThinking: (chunk) => {
            queuedThinking += chunk;
          },
          onToolCall: (id, name, args) => {
            queuedToolCalls.push({ id, name, arguments: args, status: "running", timestamp: Date.now() });
          },
          onToolEnd: (toolName, isError) => {
            for (const tc of queuedToolCalls) {
              if (tc.name === toolName && tc.status === "running") {
                tc.status = isError ? "error" : "done";
              }
            }
          },
          onSessionReset: () => {
            // Queued /new or /reset triggered - clear messages and streaming state
            setSimpleMessages([]);
            setFullMessages([]);
            resetStreamingState();
            setPendingQueuedMessages([]);
            if (cleanup) {
              cleanup();
              cleanup = null;
            }
          },
        },
        levelToSend || undefined
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
    setStreamingTextAt(null);
    setActiveTools([]);

    cleanup = streamMessage(
      params.agentId,
      text,
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

        // Add assistant message - build content blocks from streaming state
        const content = streamingText();
        const blocks: ContentBlock[] = [];
        const thinkingContent = streamingThinking();
        if (thinkingContent) {
          blocks.push({ type: "thinking", thinking: thinkingContent });
        }
        for (const tc of streamingToolCalls()) {
          blocks.push({ type: "toolCall", id: tc.id, name: tc.name, arguments: tc.arguments });
        }
        if (content) {
          blocks.push({ type: "text", text: content });
        }

        // Only add assistant message if there's actual content
        if (content || thinkingContent || streamingToolCalls().length > 0) {
          setSimpleMessages((prev) => [
            ...prev,
            { id: crypto.randomUUID(), role: "assistant", content, timestamp: Date.now() },
          ]);
          setFullMessages((prev) => [
            ...prev,
            { role: "assistant", content: blocks.length > 0 ? blocks : [{ type: "text", text: content }], timestamp: Date.now() },
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
          { id: crypto.randomUUID(), role: "assistant", content, timestamp: Date.now() },
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
            { id, name, arguments: args, status: "running", timestamp: Date.now() },
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
        onSessionReset: () => {
          // Clear messages when session resets (e.g., /new command)
          setSimpleMessages([]);
          setFullMessages([]);
          setPendingQueuedMessages([]);
        },
      },
      levelToSend || undefined
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
        <A href="/agents" class="back-btn" aria-label="Go back">
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
        <A
          class="taskboard-btn"
          href="/projects"
          aria-label="Open taskboard"
          title="Tasks (Cmd+K)"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
          </svg>
        </A>
        <Show when={isOAuth()}>
          <select
            class="think-dropdown"
            value={pendingThinkLevel() ?? thinkingLevel() ?? ""}
            onChange={(e) => {
              const val = e.currentTarget.value;
              setPendingThinkLevel(val ? val as ThinkLevel : null);
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

      <div class="messages" ref={messagesContainerRef} onScroll={handleScroll}>
        <Show when={viewMode() === "simple"}>
          <For each={simpleMessages()}>
            {(msg) => (
              <div class={`message ${msg.role}`}>
                {msg.role === "assistant" ? (
                  <div class="content markdown-content" innerHTML={renderMarkdown(msg.content)} />
                ) : (
                  <div class="content">{msg.content}</div>
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
                  .filter((b): b is { type: "text"; text: string } => b.type === "text")
                  .map((b) => b.text)
                  .join("\n");
                return (
                  <div class="message user">
                    <div class="content">{textContent}</div>
                    <div class="message-time">{formatTimestamp(msg.timestamp)}</div>
                  </div>
                );
              }
              if (msg.role === "assistant") {
                return (
                  <div class="message assistant full-message">
                    <ContentBlocks blocks={msg.content} timestamp={msg.timestamp} toolResultsMap={toolResultsMap()} />
                    {msg.meta && <ModelMetaDisplay meta={msg.meta} />}
                    <div class="message-time">{formatTimestamp(msg.timestamp)}</div>
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
        <Show when={viewMode() === "full" && isStreaming() && (streamingThinking() || streamingToolCalls().length > 0 || streamingText())}>
          <div class="message assistant full-message streaming">
            <div class="content-blocks">
              {streamingThinking() && (
                <CollapsibleBlock
                  title="Thinking"
                  content={streamingThinking()}
                  defaultCollapsed={false}
                  timestamp={streamingThinkingAt() ?? streamingStartedAt() ?? undefined}
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
                <div class="block-text markdown-content" innerHTML={renderMarkdown(streamingText())} />
              )}
            </div>
            {streamingStartedAt() && (
              <div class="message-time">{formatTimestamp(streamingStartedAt()!)}</div>
            )}
          </div>
        </Show>

        {/* Streaming content in simple mode - just text */}
        <Show when={viewMode() === "simple" && isStreaming() && streamingText()}>
          <div class="message assistant streaming">
            <div class="content markdown-content" innerHTML={renderMarkdown(streamingText())} />
            {(streamingTextAt() || streamingStartedAt()) && (
              <div class="message-time">
                {formatTimestamp((streamingTextAt() ?? streamingStartedAt()) as number)}
              </div>
            )}
          </div>
        </Show>

        {/* Thinking dots when waiting (nothing received yet) */}
        {isStreaming() && !streamingThinking() && streamingToolCalls().length === 0 && !streamingText() && (
          <div class="message assistant thinking">
            <div class="thinking-dots">
              <span />
              <span />
              <span />
            </div>
            {streamingStartedAt() && (
              <div class="message-time">{formatTimestamp(streamingStartedAt()!)}</div>
            )}
          </div>
        )}

        {/* Keep ActiveToolIndicator for simple mode compatibility */}
        <Show when={viewMode() === "simple" && activeTools().length > 0}>
          <ActiveToolIndicator tools={activeTools()} />
        </Show>

        <div ref={messagesEndRef} />
      </div>

      <div class="input-area">
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
        <button
          class="send-btn"
          onClick={handleSend}
          disabled={!input().trim() || loading()}
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
          line-height: 1.5;
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
          margin: 0.4em 0;
          padding-left: 1.25em;
        }

        .markdown-content li {
          margin: 0.15em 0;
        }

        .markdown-content li p {
          margin: 0;
        }

        .markdown-content a {
          color: var(--accent);
          text-decoration: none;
        }

        .markdown-content a:hover {
          text-decoration: underline;
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
          border: 1px solid #2a2a2a;
        }

        .markdown-content th {
          background: #1a1a1a;
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
      `}</style>
    </div>
  );
}
