import { Accessor, Show, createEffect, createSignal } from "solid-js";
import { ActivityFeed } from "./ActivityFeed";
import { AgentChat } from "./AgentChat";

type ContextPanelProps = {
  collapsed: Accessor<boolean>;
  onToggleCollapse: () => void;
  selectedAgent: Accessor<string | null>;
  onClearSelection: () => void;
};

type PanelMode = "feed" | "chat";

export function ContextPanel(props: ContextPanelProps) {
  const [mode, setMode] = createSignal<PanelMode>("feed");

  createEffect(() => {
    if (props.selectedAgent()) {
      setMode("chat");
    }
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
          <ActivityFeed />
        </Show>
        <Show when={mode() === "chat"}>
          <AgentChat agentName={props.selectedAgent()} onBack={handleBack} />
        </Show>
      </div>

      <style>{`
        .context-panel {
          width: 400px;
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
          width: 400px;
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

        .panel-tabs button.active,
        .collapsed-icons button.active {
          background: #2a2a2a;
          color: #fff;
        }

        .panel-content {
          flex: 1;
          min-height: 0;
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
