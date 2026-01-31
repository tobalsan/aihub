import { Accessor, Show, createEffect, createMemo, createResource, createSignal, onMount } from "solid-js";
import { ActivityFeed } from "./ActivityFeed";
import { AgentChat } from "./AgentChat";
import { fetchAgents, fetchAllSubagents } from "../api/client";

type ContextPanelProps = {
  collapsed: Accessor<boolean>;
  onToggleCollapse: () => void;
  selectedAgent: Accessor<string | null>;
  onSelectAgent: (id: string) => void;
  onClearSelection: () => void;
  onOpenProject: (id: string) => void;
};

type PanelMode = "feed" | "chat";

export function ContextPanel(props: ContextPanelProps) {
  const [mode, setMode] = createSignal<PanelMode>("feed");
  const [agents] = createResource(fetchAgents);
  const [subagents] = createResource(fetchAllSubagents);
  const storageKey = "aihub:context-panel:mode";

  const agentType = createMemo(() => {
    const selected = props.selectedAgent();
    if (!selected) return null;
    if (selected.startsWith("PRO-")) return "subagent" as const;
    return "lead" as const;
  });

  const subagentInfo = createMemo(() => {
    const selected = props.selectedAgent();
    if (!selected || !selected.startsWith("PRO-")) return undefined;
    const [projectId, token] = selected.split("/");
    if (!projectId || !token) return undefined;
    const items = subagents()?.items ?? [];
    const match = items.find(
      (item) => item.projectId === projectId && (item.slug === token || item.cli === token)
    );
    if (!match) {
      const projectItems = items.filter((item) => item.projectId === projectId);
      if (projectItems.length === 1) {
        return { projectId, slug: projectItems[0].slug, cli: projectItems[0].cli, status: projectItems[0].status };
      }
    }
    return { projectId, slug: match?.slug ?? token, cli: match?.cli, status: match?.status };
  });

  const agentName = createMemo(() => {
    const selected = props.selectedAgent();
    if (!selected) return null;
    if (selected.startsWith("PRO-")) {
      const [projectId, token] = selected.split("/");
      const match = subagents()?.items.find(
        (item) => item.projectId === projectId && (item.slug === token || item.cli === token)
      );
      return `${projectId}/${match?.cli ?? token}`;
    }
    const match = agents()?.find((agent) => agent.id === selected);
    return match?.name ?? selected;
  });

  createEffect(() => {
    if (props.selectedAgent()) {
      setMode("chat");
    }
  });

  onMount(() => {
    const saved = localStorage.getItem(storageKey);
    if (saved === "feed" || saved === "chat") {
      setMode(saved);
    }
  });

  createEffect(() => {
    localStorage.setItem(storageKey, mode());
  });

  const expandAndShow = (nextMode: PanelMode) => {
    if (props.collapsed()) {
      props.onToggleCollapse();
    }
    setMode(nextMode);
  };

  const handleBack = () => {
    props.onClearSelection();
    setMode("feed");
  };

  return (
    <aside class="context-panel" classList={{ collapsed: props.collapsed() }}>
      <div class="panel-header">
        <button class="collapse-btn" type="button" onClick={props.onToggleCollapse}>
          »
        </button>
        <div class="panel-tabs">
          <button
            type="button"
            classList={{ active: mode() === "feed" }}
            onClick={() => setMode("feed")}
          >
            Feed
          </button>
          <button
            type="button"
            classList={{ active: mode() === "chat" }}
            onClick={() => setMode("chat")}
          >
            Chat
          </button>
        </div>
      </div>

      <div class="collapsed-icons">
        <button
          type="button"
          classList={{ active: mode() === "feed" }}
          onClick={() => expandAndShow("feed")}
          title="Activity Feed"
        >
          📋
        </button>
        <button
          type="button"
          classList={{ active: mode() === "chat" }}
          onClick={() => expandAndShow("chat")}
          title="Chat"
        >
          💬
        </button>
      </div>

      <div class="panel-content">
        <Show when={mode() === "feed"}>
          <ActivityFeed onSelectAgent={props.onSelectAgent} onOpenProject={props.onOpenProject} />
        </Show>
        <Show when={mode() === "chat"}>
          <AgentChat
            agentId={agentType() === "lead" ? props.selectedAgent() : null}
            agentName={agentName()}
            agentType={agentType()}
            subagentInfo={subagentInfo()}
            onBack={handleBack}
          />
        </Show>
      </div>

      <style>{`
        .context-panel {
          width: 520px;
          background: #1a1a1a;
          border-left: 1px solid #2a2a2a;
          display: flex;
          flex-direction: column;
          transition: width 0.2s ease;
          overflow: hidden;
        }

        .context-panel.collapsed {
          width: 50px;
        }

        .context-panel.collapsed:hover {
          width: 520px;
        }

        .panel-header {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 16px;
          border-bottom: 1px solid #2a2a2a;
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

        .panel-tabs {
          display: flex;
          gap: 8px;
        }

        .panel-tabs button,
        .collapsed-icons button {
          background: none;
          color: #666;
          padding: 8px 12px;
          border-radius: 6px;
          border: none;
          cursor: pointer;
        }

        .panel-tabs button:focus-visible,
        .collapsed-icons button:focus-visible {
          outline: 2px solid rgba(59, 130, 246, 0.6);
          outline-offset: 2px;
        }

        .panel-tabs button.active,
        .collapsed-icons button.active {
          background: #2a2a2a;
          color: #fff;
        }

        .panel-content {
          flex: 1;
          min-height: 0;
          transition: opacity 0.2s ease;
        }

        .collapsed-icons {
          display: none;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          padding: 16px 0;
        }

        .context-panel.collapsed .panel-header,
        .context-panel.collapsed .panel-content {
          opacity: 0;
          pointer-events: none;
        }

        .context-panel.collapsed .collapsed-icons {
          display: flex;
        }

        .context-panel.collapsed:hover .panel-header,
        .context-panel.collapsed:hover .panel-content {
          opacity: 1;
          pointer-events: auto;
        }

        .context-panel.collapsed:hover .collapsed-icons {
          display: none;
        }

        @media (max-width: 1399px) {
          .context-panel {
            width: 50px;
            min-width: 50px;
          }

          .context-panel:hover {
            width: 400px;
            min-width: 400px;
          }

          .context-panel .panel-header,
          .context-panel .panel-content {
            opacity: 0;
            pointer-events: none;
          }

          .context-panel .collapsed-icons {
            display: flex;
          }

          .context-panel:hover .panel-header,
          .context-panel:hover .panel-content {
            opacity: 1;
            pointer-events: auto;
          }

          .context-panel:hover .collapsed-icons {
            display: none;
          }

          .app-layout.left-collapsed .context-panel:not(.collapsed) {
            width: 400px;
            min-width: 400px;
          }

          .app-layout.left-collapsed .context-panel:not(.collapsed) .panel-header,
          .app-layout.left-collapsed .context-panel:not(.collapsed) .panel-content {
            opacity: 1;
            pointer-events: auto;
          }

          .app-layout.left-collapsed .context-panel:not(.collapsed) .collapsed-icons {
            display: none;
          }
        }

        @media (max-width: 768px) {
          .context-panel {
            display: none !important;
          }
        }
      `}</style>
    </aside>
  );
}
