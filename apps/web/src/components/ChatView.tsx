import { createSignal, createEffect, For, onCleanup, onMount } from "solid-js";
import { streamMessage, getSessionKey, fetchHistory } from "../api/client";
import type { Agent, Message } from "../api/types";

type Props = {
  agent: Agent;
  onBack: () => void;
};

export function ChatView(props: Props) {
  const [messages, setMessages] = createSignal<Message[]>([]);
  const [input, setInput] = createSignal("");
  const [isStreaming, setIsStreaming] = createSignal(false);
  const [streamingText, setStreamingText] = createSignal("");
  const [loading, setLoading] = createSignal(true);

  let messagesEndRef: HTMLDivElement | undefined;
  let inputRef: HTMLTextAreaElement | undefined;
  let cleanup: (() => void) | null = null;

  // Use persistent sessionKey (default "main") instead of ephemeral sessionId
  const sessionKey = getSessionKey(props.agent.id);

  const scrollToBottom = () => {
    messagesEndRef?.scrollIntoView({ behavior: "smooth" });
  };

  // Load history on mount
  onMount(async () => {
    const history = await fetchHistory(props.agent.id, sessionKey);
    if (history.length > 0) {
      setMessages(
        history.map((h) => ({
          id: crypto.randomUUID(),
          role: h.role,
          content: h.content,
          timestamp: h.timestamp,
        }))
      );
    }
    setLoading(false);
  });

  createEffect(() => {
    messages();
    streamingText();
    scrollToBottom();
  });

  onCleanup(() => {
    cleanup?.();
  });

  const handleSend = () => {
    const text = input().trim();
    if (!text || isStreaming() || loading()) return;

    // Add user message
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsStreaming(true);
    setStreamingText("");

    // Stream response
    cleanup = streamMessage(
      props.agent.id,
      text,
      sessionKey,
      (chunk) => {
        setStreamingText((prev) => prev + chunk);
      },
      () => {
        // Add assistant message
        const assistantMsg: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: streamingText(),
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
        setStreamingText("");
        setIsStreaming(false);
        cleanup = null;
      },
      (error) => {
        // Add error message
        const errorMsg: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `Error: ${error}`,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, errorMsg]);
        setStreamingText("");
        setIsStreaming(false);
        cleanup = null;
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
        <button class="back-btn" onClick={props.onBack} aria-label="Go back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>
        <div class="agent-info">
          <div class="agent-name">{props.agent.name}</div>
          <div class="agent-status">
            <span class="status-dot" classList={{ active: isStreaming() }} />
            <span class="status-text">{isStreaming() ? "thinking" : "online"}</span>
          </div>
        </div>
      </header>

      <div class="messages">
        <For each={messages()}>
          {(msg) => (
            <div class={`message ${msg.role}`}>
              <div class="content">{msg.content}</div>
            </div>
          )}
        </For>

        {isStreaming() && !streamingText() && (
          <div class="message assistant thinking">
            <div class="thinking-dots">
              <span />
              <span />
              <span />
            </div>
          </div>
        )}

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
            ref={inputRef}
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
            <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
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
          backdrop-filter: blur(12px);
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
        }

        .back-btn:hover {
          background: var(--surface-2);
          color: var(--text-primary);
          border-color: var(--surface-3);
        }

        .back-btn:active {
          transform: scale(0.95);
        }

        .agent-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .agent-name {
          font-size: 16px;
          font-weight: 600;
          color: var(--text-primary);
          letter-spacing: -0.01em;
        }

        .agent-status {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .status-dot {
          width: 6px;
          height: 6px;
          background: #22c55e;
          border-radius: 50%;
          box-shadow: 0 0 8px rgba(34, 197, 94, 0.5);
        }

        .status-dot.active {
          background: var(--accent);
          box-shadow: 0 0 8px var(--accent-glow);
          animation: pulse-dot 2s ease-in-out infinite;
        }

        @keyframes pulse-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        .status-text {
          font-size: 12px;
          color: var(--text-muted);
          text-transform: lowercase;
          letter-spacing: 0.02em;
        }

        .messages {
          flex: 1;
          overflow-y: auto;
          padding: 24px 20px;
          display: flex;
          flex-direction: column;
          gap: 16px;
          scroll-behavior: smooth;
        }

        .messages::-webkit-scrollbar {
          width: 6px;
        }

        .messages::-webkit-scrollbar-track {
          background: transparent;
        }

        .messages::-webkit-scrollbar-thumb {
          background: var(--surface-2);
          border-radius: 3px;
        }

        .messages::-webkit-scrollbar-thumb:hover {
          background: var(--surface-3);
        }

        .message {
          max-width: 80%;
          padding: 12px 16px;
          border-radius: var(--radius-md);
          line-height: 1.5;
          white-space: pre-wrap;
          word-wrap: break-word;
          font-size: 15px;
          animation: message-in 0.3s ease-out;
        }

        @keyframes message-in {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .message.user {
          align-self: flex-end;
          background: var(--user-bg);
          color: #fff;
          border-bottom-right-radius: 6px;
          box-shadow: 0 4px 16px rgba(99, 102, 241, 0.2);
        }

        .message.assistant {
          align-self: flex-start;
          background: var(--surface-1);
          color: var(--text-primary);
          border: 1px solid var(--surface-2);
          border-bottom-left-radius: 6px;
        }

        .message.streaming .content::after {
          content: "";
          display: inline-block;
          width: 2px;
          height: 1em;
          background: var(--accent);
          margin-left: 2px;
          vertical-align: text-bottom;
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

        .thinking-dots span:nth-child(2) {
          animation-delay: 0.15s;
        }

        .thinking-dots span:nth-child(3) {
          animation-delay: 0.3s;
        }

        @keyframes thinking {
          0%, 80%, 100% {
            opacity: 0.3;
            transform: scale(0.85);
          }
          40% {
            opacity: 1;
            transform: scale(1);
          }
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
          position: relative;
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
          line-height: 1.4;
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
          position: relative;
          overflow: hidden;
        }

        .send-btn:not(:disabled) {
          background: var(--accent);
          color: #fff;
          box-shadow: 0 4px 16px var(--accent-glow);
        }

        .send-btn:not(:disabled):hover {
          transform: scale(1.05);
          box-shadow: 0 6px 24px var(--accent-glow);
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
