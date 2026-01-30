import { Show } from "solid-js";

type AgentChatProps = {
  agentName: string | null;
  onBack: () => void;
};

export function AgentChat(props: AgentChatProps) {
  return (
    <div class="agent-chat">
      <div class="chat-header">
        <button class="back-btn" type="button" onClick={props.onBack}>
          ←
        </button>
        <h3>{props.agentName ?? "Select an agent"}</h3>
      </div>

      <div class="chat-messages">
        <Show when={!props.agentName}>
          <div class="chat-empty">Select an agent to chat</div>
        </Show>
        <Show when={props.agentName}>
          <div class="chat-empty">Chat will be connected in Phase 4</div>
        </Show>
      </div>

      <div class="chat-input">
        <input
          type="text"
          placeholder="Type a message..."
          disabled={!props.agentName}
        />
        <button type="button" disabled={!props.agentName}>
          Send
        </button>
      </div>

      <style>{`
        .agent-chat {
          display: flex;
          flex-direction: column;
          height: 100%;
        }

        .chat-header {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 16px;
          border-bottom: 1px solid #2a2a2a;
        }

        .chat-header h3 {
          margin: 0;
          font-size: 14px;
          font-weight: 600;
        }

        .back-btn {
          background: none;
          border: none;
          color: #888;
          font-size: 16px;
          cursor: pointer;
        }

        .back-btn:hover {
          color: #fff;
        }

        .chat-messages {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
          display: flex;
        }

        .chat-empty {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #666;
          font-size: 14px;
          text-align: center;
        }

        .chat-input {
          display: flex;
          gap: 8px;
          padding: 16px;
          border-top: 1px solid #2a2a2a;
        }

        .chat-input input {
          flex: 1;
          background: #0a0a0a;
          border: 1px solid #2a2a2a;
          border-radius: 8px;
          padding: 10px 14px;
          color: #fff;
          font-size: 13px;
          outline: none;
        }

        .chat-input input:focus {
          border-color: #444;
        }

        .chat-input input:disabled {
          opacity: 0.5;
        }

        .chat-input button {
          background: #3b82f6;
          border: none;
          border-radius: 8px;
          padding: 10px 16px;
          color: #fff;
          font-size: 13px;
          cursor: pointer;
        }

        .chat-input button:hover {
          background: #2563eb;
        }

        .chat-input button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}
