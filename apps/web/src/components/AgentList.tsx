import { createResource, For, Show } from "solid-js";
import { A } from "@solidjs/router";
import { fetchAgents } from "../api/client";

function shortenPath(path: string): string {
  const home = path.match(/^\/Users\/[^/]+/)?.[0];
  if (home) return path.replace(home, "~");
  return path;
}

export function AgentList() {
  const [agents] = createResource(fetchAgents);

  return (
    <div class="agent-list">
      <header class="header">
        <A class="home-link" href="/projects">AIHub</A>
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
                <div class="agent-meta">
                  <span class="agent-model">
                    {agent.model.provider}/{agent.model.model}
                  </span>
                  {agent.workspace && (
                    <span class="agent-workspace">{shortenPath(agent.workspace)}</span>
                  )}
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
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px;
          border-bottom: 1px solid #222;
        }

        .header h1 {
          font-size: 24px;
          font-weight: 600;
        }

        .home-link {
          font-size: 24px;
          font-weight: 600;
          color: #fff;
          text-decoration: none;
        }

        .home-link:hover {
          color: #e5e7eb;
        }

        .taskboard-btn {
          width: 40px;
          height: 40px;
          border-radius: 8px;
          background: #1a1a1a;
          border: 1px solid #333;
          color: #888;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
        }

        .taskboard-btn:hover {
          background: #252525;
          color: #fff;
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

        .agent-meta {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .agent-model {
          font-size: 13px;
          color: #888;
        }

        .agent-workspace {
          font-size: 12px;
          color: #666;
          font-family: monospace;
        }
      `}</style>
    </div>
  );
}
