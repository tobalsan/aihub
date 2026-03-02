import {
  Accessor,
  For,
  Show,
  createEffect,
  createResource,
  createSignal,
  onCleanup,
} from "solid-js";
import {
  fetchAgents,
  fetchAllSubagents,
  fetchAgentStatuses,
  subscribeToStatus,
} from "../api/client";
import type { SubagentGlobalListItem } from "../api/types";

type AgentDirectoryProps = {
  selectedAgent: Accessor<string | null>;
  onSelectAgent: (id: string) => void;
};

function toSubagentId(item: SubagentGlobalListItem): string {
  return `${item.projectId}/${item.slug}`;
}

function toSubagentLabel(item: SubagentGlobalListItem): string {
  return `${item.projectId}/${item.cli ?? item.slug}`;
}

function statusRank(status: SubagentGlobalListItem["status"]): number {
  if (status === "running") return 3;
  if (status === "error") return 2;
  if (status === "replied") return 1;
  return 0;
}

function dominantStatus(...statuses: Array<SubagentGlobalListItem["status"]>) {
  return statuses.reduce((best, next) =>
    statusRank(next) > statusRank(best) ? next : best
  );
}

function mergeRalphRows(
  items: SubagentGlobalListItem[]
): SubagentGlobalListItem[] {
  const grouped = new Map<
    string,
    { supervisor?: SubagentGlobalListItem; worker?: SubagentGlobalListItem }
  >();
  const passthrough: SubagentGlobalListItem[] = [];

  for (const item of items) {
    if (!item.groupKey) {
      passthrough.push(item);
      continue;
    }
    const current = grouped.get(item.groupKey) ?? {};
    if (item.role === "supervisor") current.supervisor = item;
    else if (item.role === "worker") current.worker = item;
    else passthrough.push(item);
    grouped.set(item.groupKey, current);
  }

  const merged: SubagentGlobalListItem[] = [];
  for (const entry of grouped.values()) {
    if (entry.supervisor) {
      if (entry.worker) {
        merged.push({
          ...entry.supervisor,
          status: dominantStatus(entry.supervisor.status, entry.worker.status),
        });
      } else {
        merged.push(entry.supervisor);
      }
      continue;
    }
    if (entry.worker) merged.push(entry.worker);
  }

  return [...passthrough, ...merged];
}

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export function AgentDirectory(props: AgentDirectoryProps) {
  const [agents] = createResource(fetchAgents);
  const [subagents, { refetch }] = createResource(fetchAllSubagents);
  const [statuses, setStatuses] = createSignal<
    Record<string, "streaming" | "idle">
  >({});

  createEffect(() => {
    fetchAgentStatuses().then((res) => {
      setStatuses(res.statuses);
    });
  });

  createEffect(() => {
    const unsubscribe = subscribeToStatus({
      onStatus: (agentId, status) => {
        setStatuses((prev) => ({ ...prev, [agentId]: status }));
      },
    });
    onCleanup(unsubscribe);
  });

  createEffect(() => {
    const interval = setInterval(() => {
      refetch();
    }, 5000);
    onCleanup(() => clearInterval(interval));
  });

  const getAgentStatus = (agentId: string) =>
    statuses()[agentId] === "streaming" ? "running" : "idle";

  return (
    <div class="agent-directory">
      <div class="agent-section">
        <div class="section-title">LEAD AGENTS</div>
        <Show when={agents()}>
          <For each={agents() ?? []}>
            {(agent) => {
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
                  <span
                    class="status-pill"
                    classList={{ working: isRunning(), idle: !isRunning() }}
                  >
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
          <For each={mergeRalphRows(subagents()?.items ?? [])}>
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

      <style>{`
        .agent-directory {
          height: 100%;
          padding: 14px 12px;
          display: flex;
          flex-direction: column;
          gap: 14px;
          overflow: auto;
        }

        .agent-section {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .section-title {
          font-size: 11px;
          color: var(--text-muted);
          letter-spacing: 0.5px;
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
          color: var(--text-primary);
          cursor: pointer;
          text-align: left;
        }

        .agent-item:hover,
        .agent-item.selected {
          background: var(--bg-raised);
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
          color: var(--text-secondary);
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
          background: var(--bg-raised);
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
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 240px;
        }
      `}</style>
    </div>
  );
}
