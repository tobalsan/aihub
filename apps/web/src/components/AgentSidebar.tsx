import { Accessor, createResource, For, Show } from "solid-js";
import { A, useLocation } from "@solidjs/router";
import { theme, toggleTheme } from "../theme";
import { fetchProjects } from "../api/client";
import type { ProjectListItem } from "../api/types";

type AgentSidebarProps = {
  collapsed: Accessor<boolean>;
  onToggleCollapse: () => void;
};

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function AgentSidebar(props: AgentSidebarProps) {
  const location = useLocation();
  const [projects] = createResource(fetchProjects);

  const recentProjects = (): ProjectListItem[] => {
    const all = projects() ?? [];
    return [...all]
      .sort((a, b) => {
        const at = new Date(a.frontmatter.created as string || 0).getTime();
        const bt = new Date(b.frontmatter.created as string || 0).getTime();
        return bt - at;
      })
      .slice(0, 5);
  };

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
      <Show when={recentProjects().length > 0}>
        <div class="sidebar-recent">
          <div class="sidebar-recent-label">Recent</div>
          <For each={recentProjects()}>
            {(p) => (
              <A
                href={`/projects/${p.id}`}
                class="recent-project-link"
                classList={{ active: location.pathname === `/projects/${p.id}` }}
              >
                <span class="recent-project-title">{p.title}</span>
                <span class="recent-project-time">
                  {p.frontmatter.created ? relativeTime(p.frontmatter.created as string) : ""}
                </span>
              </A>
            )}
          </For>
        </div>
      </Show>
      <div class="sidebar-footer">
        <button
          class="theme-toggle"
          type="button"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme() === "dark" ? "light" : "dark"} mode`}
        >
          <Show
            when={theme() === "dark"}
            fallback={
              <svg class="theme-icon" viewBox="0 0 20 20" fill="currentColor">
                <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
              </svg>
            }
          >
            <svg class="theme-icon" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clip-rule="evenodd" />
            </svg>
          </Show>
          <span class="theme-label">{theme() === "dark" ? "Light" : "Dark"}</span>
        </button>
      </div>

      <style>{`
        .agent-sidebar {
          width: 250px;
          background: var(--bg-surface);
          border-right: 1px solid var(--border-default);
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
          border: 1px solid var(--border-default);
          background: var(--bg-surface);
          color: var(--text-primary);
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

        .sidebar-recent {
          margin-top: auto;
          padding: 8px 10px 8px;
          border-top: 1px solid var(--border-default);
        }

        .sidebar-recent-label {
          font-size: 11px;
          font-weight: 600;
          color: var(--text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          padding: 0 10px 6px;
          white-space: nowrap;
        }

        .recent-project-link {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 5px 10px;
          border-radius: 6px;
          color: var(--text-secondary);
          text-decoration: none;
          font-size: 13px;
          line-height: 1.3;
          transition: background 0.15s ease, color 0.15s ease;
          white-space: nowrap;
        }

        .recent-project-link:hover {
          background: var(--bg-raised);
          color: var(--text-primary);
        }

        .recent-project-link.active {
          background: var(--border-default);
          color: var(--text-primary);
        }

        .recent-project-title {
          overflow: hidden;
          text-overflow: ellipsis;
          min-width: 0;
        }

        .recent-project-time {
          flex-shrink: 0;
          font-size: 11px;
          color: var(--text-secondary);
          opacity: 0.7;
        }

        .sidebar-footer {
          padding: 8px 10px 10px;
          border-top: 1px solid var(--border-default);
        }

        .theme-toggle {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          padding: 8px 10px;
          border-radius: 8px;
          border: none;
          background: transparent;
          color: var(--text-secondary);
          cursor: pointer;
          font-size: 14px;
          line-height: 1.2;
          transition: background 0.2s ease, color 0.2s ease;
          white-space: nowrap;
        }

        .theme-toggle:hover {
          background: var(--bg-raised);
          color: var(--text-primary);
        }

        .theme-icon {
          width: 16px;
          height: 16px;
          flex-shrink: 0;
        }

        .sidebar-logo {
          display: inline-block;
          color: var(--text-primary);
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
          color: var(--text-secondary);
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
          color: var(--text-secondary);
          text-decoration: none;
          font-size: 14px;
          line-height: 1.2;
          transition: background 0.2s ease, color 0.2s ease;
          white-space: nowrap;
        }

        .nav-link:hover {
          background: var(--bg-raised);
          color: var(--text-primary);
        }

        .nav-link.active {
          background: var(--border-default);
          color: var(--text-primary);
        }

        .agent-sidebar.collapsed .dev-badge,
        .agent-sidebar.collapsed .sidebar-logo,
        .agent-sidebar.collapsed .nav-link,
        .agent-sidebar.collapsed .theme-label,
        .agent-sidebar.collapsed .sidebar-footer,
        .agent-sidebar.collapsed .sidebar-recent {
          opacity: 0;
          pointer-events: none;
        }

        .agent-sidebar.collapsed .sidebar-logo {
          transform: scale(0.98);
        }

        .agent-sidebar.collapsed:hover .dev-badge,
        .agent-sidebar.collapsed:hover .sidebar-logo,
        .agent-sidebar.collapsed:hover .nav-link,
        .agent-sidebar.collapsed:hover .theme-label,
        .agent-sidebar.collapsed:hover .sidebar-footer,
        .agent-sidebar.collapsed:hover .sidebar-recent {
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
            box-shadow: 12px 0 24px var(--shadow-md);
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
