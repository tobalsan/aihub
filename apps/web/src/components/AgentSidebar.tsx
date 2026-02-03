import { Accessor, For, Show, createEffect, createResource, createSignal, onCleanup } from "solid-js";
import { fetchAgents, fetchAllSubagents, fetchAgentStatuses, subscribeToStatus } from "../api/client";
import type { SubagentGlobalListItem } from "../api/types";

type AgentSidebarProps = {
  collapsed: Accessor<boolean>;
  onToggleCollapse: () => void;
  selectedAgent: Accessor<string | null>;
  onSelectAgent: (id: string) => void;
};

function toSubagentId(item: SubagentGlobalListItem): string {
  return `${item.projectId}/${item.slug}`;
}

function toSubagentLabel(item: SubagentGlobalListItem): string {
  return `${item.projectId}/${item.cli ?? item.slug}`;
}

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export function AgentSidebar(props: AgentSidebarProps) {
  const [agents] = createResource(fetchAgents);
  const [subagents, { refetch }] = createResource(fetchAllSubagents);

  // Real-time status tracking
  const [statuses, setStatuses] = createSignal<Record<string, "streaming" | "idle">>({});

  // Fetch initial statuses on mount
  createEffect(() => {
    fetchAgentStatuses().then((res) => {
      setStatuses(res.statuses);
    });
  });

  // Subscribe to real-time status updates
  createEffect(() => {
    const unsubscribe = subscribeToStatus({
      onStatus: (agentId, status) => {
        setStatuses((prev) => ({ ...prev, [agentId]: status }));
      },
    });
    onCleanup(unsubscribe);
  });

  // Poll subagents (they have their own status tracking)
  createEffect(() => {
    const interval = setInterval(() => {
      refetch();
    }, 5000);
    onCleanup(() => clearInterval(interval));
  });

  const getAgentStatus = (agentId: string) =>
    statuses()[agentId] === "streaming" ? "running" : "idle";

  return (
    <aside class="agent-sidebar" classList={{ collapsed: props.collapsed() }}>
      <div class="sidebar-header">
        <Show when={import.meta.env.VITE_AIHUB_DEV === "true"}>
          <span class="dev-badge">DEV</span>
        </Show>
        <button class="collapse-btn" type="button" onClick={props.onToggleCollapse}>
          «
        </button>
      </div>
      <div class="sidebar-content">
        <div class="agent-section">
          <div class="section-title">LEAD AGENTS</div>
          <Show when={agents()}>
            <For each={agents() ?? []}>
              {(agent) => {
                // Use a getter function for reactivity
                const isRunning = () => getAgentStatus(agent.id) === "running";
                return (
                  <button
                    class="agent-item"
                    type="button"
                    classList={{ selected: props.selectedAgent() === agent.id }}
                    onClick={() => props.onSelectAgent(agent.id)}
                  >
                    <span class="agent-avatar" classList={{ running: isRunning() }}>
                      {getInitials(agent.name)}
                    </span>
                    <span class="agent-label">{agent.name}</span>
                    <span class="status-pill" classList={{ working: isRunning(), idle: !isRunning() }}>
                      {isRunning() ? "WORKING" : "IDLE"}
                    </span>
                  </button>
                );
              }}
            </For>
          </Show>
        </div>

        <div class="agent-section">
          <div class="section-title">SUBAGENTS</div>
          <Show when={subagents()}>
            <For each={subagents()?.items ?? []}>
              {(item) => {
                const id = toSubagentId(item);
                const label = toSubagentLabel(item);
                const initials = getInitials(item.cli ?? item.slug);
                const isRunning = item.status === "running";
                return (
                  <button
                    class="agent-item"
                    type="button"
                    classList={{ selected: props.selectedAgent() === id }}
                    onClick={() => props.onSelectAgent(id)}
                  >
                    <span class={`agent-avatar ${isRunning ? "running" : ""}`}>
                      {initials}
                    </span>
                    <span class="agent-label">{label}</span>
                    <span class={`status-pill ${isRunning ? "working" : "idle"}`}>
                      {isRunning ? "WORKING" : "IDLE"}
                    </span>
                  </button>
                );
              }}
            </For>
          </Show>
        </div>
      </div>

      <style>{`
        .agent-sidebar {
          width: 250px;
          background: #1a1a1a;
          border-right: 1px solid #2a2a2a;
          display: flex;
          flex-direction: column;
          transition: width 0.2s ease, box-shadow 0.2s ease;
          overflow: hidden;
        }

        .agent-sidebar.collapsed {
          width: 50px;
        }

        .agent-sidebar.collapsed:hover {
          width: 250px;
        }

        .sidebar-header {
          padding: 12px 10px;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .dev-badge {
          background: #f59e0b;
          color: #fff;
          font-size: 10px;
          font-weight: 700;
          padding: 2px 6px;
          border-radius: 4px;
          letter-spacing: 0.05em;
        }

        .collapse-btn {
          margin-left: auto;
        }

        .collapse-btn {
          width: 28px;
          height: 28px;
          border-radius: 6px;
          border: 1px solid #2a2a2a;
          background: #1a1a1a;
          color: #e6e6e6;
          cursor: pointer;
        }

        .collapse-btn:focus-visible {
          outline: 2px solid rgba(59, 130, 246, 0.6);
          outline-offset: 2px;
        }

        .sidebar-content {
          padding: 0 10px 12px;
          display: flex;
          flex-direction: column;
          gap: 16px;
          overflow: auto;
        }

        .agent-section {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .section-title {
          font-size: 11px;
          color: #666;
          letter-spacing: 0.5px;
          transition: opacity 0.2s ease, max-height 0.2s ease;
          max-height: 16px;
          overflow: hidden;
        }

        .agent-item {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 6px 8px;
          border-radius: 8px;
          border: none;
          background: transparent;
          color: #fff;
          cursor: pointer;
          text-align: left;
        }

        .agent-item:hover,
        .agent-item.selected {
          background: #2a2a2a;
        }

        .agent-item:focus-visible {
          outline: 2px solid rgba(59, 130, 246, 0.5);
          outline-offset: 2px;
        }

        .agent-avatar {
          width: 28px;
          height: 28px;
          border-radius: 6px;
          background: #3a3a3a;
          flex: 0 0 auto;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: 600;
          color: #ccc;
          letter-spacing: 0.02em;
          transition: background 0.2s ease;
        }

        .agent-avatar.running {
          background: #166534;
          color: #a7f3d0;
        }

        .status-pill {
          margin-left: auto;
          padding: 2px 6px;
          border-radius: 999px;
          font-size: 9px;
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          flex: 0 0 auto;
          border: 1px solid transparent;
        }

        .status-pill.idle {
          background: #242424;
          color: #9ca3af;
          border-color: #303030;
        }

        .status-pill.working {
          background: #bbf7d0;
          color: #065f46;
          border-color: #86efac;
        }

        .agent-label {
          font-size: 14px;
          color: #fff;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 160px;
          transition: opacity 0.2s ease, max-width 0.2s ease;
        }

        .agent-sidebar.collapsed .section-title {
          opacity: 0;
          max-height: 0;
        }

        .agent-sidebar.collapsed .agent-label {
          opacity: 0;
          max-width: 0;
        }

        .agent-sidebar.collapsed .status-pill {
          display: none;
        }

        .agent-sidebar.collapsed .agent-item {
          justify-content: center;
          gap: 0;
          padding: 4px;
        }

        .agent-sidebar.collapsed:hover .section-title {
          opacity: 1;
          max-height: 16px;
        }

        .agent-sidebar.collapsed:hover .agent-label {
          opacity: 1;
          max-width: 160px;
        }

        .agent-sidebar.collapsed:hover .agent-item {
          justify-content: flex-start;
          gap: 10px;
          padding: 6px 8px;
        }

        .agent-sidebar.collapsed:hover .status-pill {
          display: block;
        }

        @media (max-width: 768px) {
          .agent-sidebar {
            position: fixed;
            top: 0;
            left: 0;
            height: 100vh;
            z-index: 850;
            box-shadow: 12px 0 24px rgba(0, 0, 0, 0.35);
            transform: translateX(0);
            transition: transform 0.2s ease, width 0.2s ease, box-shadow 0.2s ease;
          }

          .agent-sidebar.collapsed {
            transform: translateX(-100%);
            box-shadow: none;
          }

          .agent-sidebar.collapsed:hover {
            transform: translateX(-100%);
            width: 50px;
          }
        }
      `}</style>
    </aside>
  );
}
