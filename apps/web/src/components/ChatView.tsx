import { createSignal, createEffect, For, onCleanup } from "solid-js";
import { streamMessage } from "../api/client";
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

  let messagesEndRef: HTMLDivElement | undefined;
  let inputRef: HTMLTextAreaElement | undefined;
  let cleanup: (() => void) | null = null;

  const sessionId = `web:${props.agent.id}:${Date.now()}`;

  const scrollToBottom = () => {
    messagesEndRef?.scrollIntoView({ behavior: "smooth" });
  };

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
    if (!text || isStreaming()) return;

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
      sessionId,
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
        <button class="back-btn" onClick={props.onBack}>
          ←
        </button>
        <div class="agent-info">
          <div class="agent-name">{props.agent.name}</div>
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

        {streamingText() && (
          <div class="message assistant streaming">
            <div class="content">{streamingText()}</div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div class="input-area">
        <textarea
          ref={inputRef}
          class="input"
          placeholder="Type a message..."
          value={input()}
          onInput={(e) => setInput(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          disabled={isStreaming()}
          rows={1}
        />
        <button
          class="send-btn"
          onClick={handleSend}
          disabled={!input().trim() || isStreaming()}
        >
          ↑
        </button>
      </div>

      <style>{`
        .chat-view {
          height: 100%;
          display: flex;
          flex-direction: column;
        }

        .header {
          display: flex;
          align-items: center;
          padding: 12px 16px;
          border-bottom: 1px solid #222;
          gap: 12px;
        }

        .back-btn {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: #222;
          border: none;
          color: #fff;
          font-size: 20px;
          cursor: pointer;
        }

        .back-btn:hover {
          background: #333;
        }

        .agent-name {
          font-size: 17px;
          font-weight: 500;
        }

        .messages {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .message {
          max-width: 85%;
          padding: 10px 14px;
          border-radius: 16px;
          line-height: 1.4;
          white-space: pre-wrap;
          word-wrap: break-word;
        }

        .message.user {
          align-self: flex-end;
          background: #0066ff;
          color: #fff;
        }

        .message.assistant {
          align-self: flex-start;
          background: #222;
          color: #fff;
        }

        .message.streaming .content::after {
          content: "▌";
          animation: blink 1s infinite;
        }

        @keyframes blink {
          50% { opacity: 0; }
        }

        .input-area {
          display: flex;
          gap: 8px;
          padding: 12px 16px;
          border-top: 1px solid #222;
          background: #0a0a0a;
        }

        .input {
          flex: 1;
          padding: 10px 14px;
          border-radius: 20px;
          background: #1a1a1a;
          border: 1px solid #333;
          color: #fff;
          font-size: 16px;
          resize: none;
          outline: none;
          font-family: inherit;
        }

        .input:focus {
          border-color: #0066ff;
        }

        .input:disabled {
          opacity: 0.6;
        }

        .send-btn {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: #0066ff;
          border: none;
          color: #fff;
          font-size: 20px;
          cursor: pointer;
          flex-shrink: 0;
        }

        .send-btn:hover:not(:disabled) {
          background: #0055dd;
        }

        .send-btn:disabled {
          background: #333;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}
