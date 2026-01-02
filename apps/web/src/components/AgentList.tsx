import { createResource, For, Show } from "solid-js";
import { A } from "@solidjs/router";
import { fetchAgents } from "../api/client";

export function AgentList() {
  const [agents] = createResource(fetchAgents);

  return (
    <div class="agent-list">
      <header class="header">
        <h1>AIHub</h1>
      </header>

      <Show when={agents.loading}>
        <div class="loading">Loading agents...</div>
      </Show>

      <Show when={agents.error}>
        <div class="error">Failed to load agents</div>
      </Show>

      <Show when={agents()}>
        <div class="agents">
          <For each={agents()}>
            {(agent) => (
              <A href={`/chat/${agent.id}`} class="agent-card">
                <div class="agent-name">{agent.name}</div>
                <div class="agent-model">
                  {agent.model.provider}/{agent.model.model}
                </div>
              </A>
            )}
          </For>
        </div>
      </Show>

      <style>{`
        .agent-list {
          height: 100%;
          display: flex;
          flex-direction: column;
        }

        .header {
          padding: 16px;
          border-bottom: 1px solid #222;
        }

        .header h1 {
          font-size: 24px;
          font-weight: 600;
        }

        .loading, .error {
          padding: 24px;
          text-align: center;
          color: #888;
        }

        .error {
          color: #e55;
        }

        .agents {
          flex: 1;
          overflow-y: auto;
          padding: 8px;
        }

        .agent-card {
          display: block;
          width: 100%;
          padding: 16px;
          margin-bottom: 8px;
          background: #1a1a1a;
          border: 1px solid #333;
          border-radius: 12px;
          text-align: left;
          cursor: pointer;
          transition: background 0.2s;
          text-decoration: none;
        }

        .agent-card:hover {
          background: #252525;
        }

        .agent-card:active {
          background: #333;
        }

        .agent-name {
          font-size: 18px;
          font-weight: 500;
          color: #fff;
          margin-bottom: 4px;
        }

        .agent-model {
          font-size: 13px;
          color: #888;
        }
      `}</style>
    </div>
  );
}
