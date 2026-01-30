import { Accessor, For, Show, createEffect, createResource, onCleanup } from "solid-js";
import { fetchAgents, fetchAllSubagents } from "../api/client";
import type { SubagentGlobalListItem } from "../api/types";

type AgentSidebarProps = {
  collapsed: Accessor<boolean>;
  onToggleCollapse: () => void;
  selectedAgent: Accessor<string | null>;
  onSelectAgent: (id: string) => void;
};

function toSubagentId(item: SubagentGlobalListItem): string {
  return `${item.projectId}/${item.cli ?? item.slug}`;
}

export function AgentSidebar(props: AgentSidebarProps) {
  const [agents] = createResource(fetchAgents);
  const [subagents, { refetch }] = createResource(fetchAllSubagents);

  createEffect(() => {
    const interval = setInterval(() => {
      refetch();
    }, 5000);
    onCleanup(() => clearInterval(interval));
  });

  return (
    <aside class="agent-sidebar" classList={{ collapsed: props.collapsed() }}>
      <div class="sidebar-header">
        <button class="collapse-btn" type="button" onClick={props.onToggleCollapse}>
          «
        </button>
      </div>
      <div class="sidebar-content">
        <div class="agent-section">
          <div class="section-title">LEAD AGENTS</div>
          <Show when={agents()}>
            <For each={agents() ?? []}>
              {(agent) => (
                <button
                  class="agent-item"
                  type="button"
                  classList={{ selected: props.selectedAgent() === agent.id }}
                  onClick={() => props.onSelectAgent(agent.id)}
                >
                  <span class="status-dot" />
                  <span class="agent-label">{agent.name}</span>
                </button>
              )}
            </For>
          </Show>
        </div>

        <div class="agent-section">
          <div class="section-title">SUBAGENTS</div>
          <Show when={subagents()}>
            <For each={subagents()?.items ?? []}>
              {(item) => {
                const id = toSubagentId(item);
                return (
                  <button
                    class="agent-item"
                    type="button"
                    classList={{ selected: props.selectedAgent() === id }}
                    onClick={() => props.onSelectAgent(id)}
                  >
                    <span class={`status-dot ${item.status === "running" ? "running" : ""}`} />
                    <span class="agent-label">{id}</span>
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
          transition: width 0.2s ease;
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

        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: #666;
          flex: 0 0 auto;
        }

        .status-dot.running {
          background: #22c55e;
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

        .agent-sidebar.collapsed .agent-item {
          justify-content: center;
          gap: 0;
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
        }
      `}</style>
    </aside>
  );
}
