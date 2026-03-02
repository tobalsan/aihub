import { Accessor, Show } from "solid-js";
import { A, useLocation } from "@solidjs/router";

type AgentSidebarProps = {
  collapsed: Accessor<boolean>;
  onToggleCollapse: () => void;
};

export function AgentSidebar(props: AgentSidebarProps) {
  const location = useLocation();

  return (
    <aside class="agent-sidebar" classList={{ collapsed: props.collapsed() }}>
      <div class="sidebar-header">
        <A class="sidebar-logo" href="/projects">
          AIHub
        </A>
        <Show when={import.meta.env.VITE_AIHUB_DEV === "true"}>
          <span class="dev-badge">DEV</span>
        </Show>
        <button
          class="collapse-btn"
          type="button"
          onClick={props.onToggleCollapse}
        >
          «
        </button>
      </div>
      <div class="sidebar-content">
        <nav class="sidebar-nav" aria-label="Primary">
          <A
            href="/projects"
            class="nav-link"
            classList={{ active: location.pathname.startsWith("/projects") }}
          >
            Projects
          </A>
          <A
            href="/conversations"
            class="nav-link"
            classList={{
              active: location.pathname.startsWith("/conversations"),
            }}
          >
            Conversations
          </A>
          <A
            href="/agents"
            class="nav-link"
            classList={{
              active:
                location.pathname.startsWith("/agents") ||
                location.pathname.startsWith("/chat"),
            }}
          >
            Chats
          </A>
        </nav>
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
          padding: 10px 10px;
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
          transition: opacity 0.2s ease;
        }

        .collapse-btn {
          margin-left: auto;
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
          padding: 8px 10px 14px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .sidebar-logo {
          display: inline-block;
          color: #fff;
          text-decoration: none;
          font-size: 20px;
          font-weight: 600;
          line-height: 1.1;
          letter-spacing: 0.02em;
          transition: opacity 0.2s ease, transform 0.2s ease;
          transform-origin: left center;
          white-space: nowrap;
        }

        .sidebar-logo:hover {
          color: #e5e7eb;
        }

        .sidebar-nav {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .nav-link {
          display: block;
          padding: 8px 10px;
          border-radius: 8px;
          color: #b6b6b6;
          text-decoration: none;
          font-size: 14px;
          line-height: 1.2;
          transition: background 0.2s ease, color 0.2s ease;
          white-space: nowrap;
        }

        .nav-link:hover {
          background: #242424;
          color: #f0f0f0;
        }

        .nav-link.active {
          background: #2a2a2a;
          color: #fff;
        }

        .agent-sidebar.collapsed .dev-badge,
        .agent-sidebar.collapsed .sidebar-logo,
        .agent-sidebar.collapsed .nav-link {
          opacity: 0;
          pointer-events: none;
        }

        .agent-sidebar.collapsed .sidebar-logo {
          transform: scale(0.98);
        }

        .agent-sidebar.collapsed:hover .dev-badge,
        .agent-sidebar.collapsed:hover .sidebar-logo,
        .agent-sidebar.collapsed:hover .nav-link {
          opacity: 1;
          pointer-events: auto;
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
