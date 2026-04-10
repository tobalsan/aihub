import {
  Accessor,
  Suspense,
  Show,
  lazy,
} from "solid-js";
import { A, useLocation } from "@solidjs/router";
import { theme, toggleTheme } from "../theme";
import { capabilities, isComponentEnabled } from "../lib/capabilities";

type AgentSidebarProps = {
  collapsed: Accessor<boolean>;
  onToggleCollapse: () => void;
};

const LazySidebarAccountPanel = lazy(
  () => import("../auth/SidebarAccountPanel")
);

function hasAdminRole(role: string | string[] | null | undefined): boolean {
  if (Array.isArray(role)) return role.includes("admin");
  return role === "admin";
}

const basePath = import.meta.env.BASE_URL?.replace(/\/+$/, "") ?? "";

/** Strip the Vite base prefix from a router pathname. */
function stripBase(pathname: string): string {
  if (basePath && pathname.startsWith(basePath)) {
    return pathname.slice(basePath.length) || "/";
  }
  return pathname;
}

export function AgentSidebar(props: AgentSidebarProps) {
  const location = useLocation();

  return (
    <aside class="agent-sidebar" classList={{ collapsed: props.collapsed() }}>
      <div class="sidebar-header">
        <A class="sidebar-logo" href="/">
          <span class="logo-full">AIHub</span>
          <span class="logo-short">AI</span>
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
          <Show when={isComponentEnabled("projects")}>
            <A
              href="/projects"
              class="nav-link"
              classList={{
                active: stripBase(location.pathname).startsWith("/projects"),
              }}
            >
              <span class="nav-full">Projects</span>
              <span class="nav-short">Pr</span>
            </A>
          </Show>
          <Show when={isComponentEnabled("conversations")}>
            <A
              href="/conversations"
              class="nav-link"
              classList={{
                active: stripBase(location.pathname).startsWith(
                  "/conversations"
                ),
              }}
            >
              <span class="nav-full">Conversations</span>
              <span class="nav-short">Co</span>
            </A>
          </Show>
          <A
            href="/agents"
            class="nav-link"
            classList={{
              active:
                stripBase(location.pathname).startsWith("/agents") ||
                stripBase(location.pathname).startsWith("/chat"),
            }}
          >
            <span class="nav-full">Agents</span>
            <span class="nav-short">Ag</span>
          </A>
          <Show
            when={
              capabilities.multiUser && hasAdminRole(capabilities.user?.role)
            }
          >
            <A
              href="/admin/users"
              class="nav-link"
              classList={{
                active: stripBase(location.pathname).startsWith("/admin/"),
              }}
            >
              <span class="nav-full">Admin</span>
              <span class="nav-short">Ad</span>
            </A>
          </Show>
        </nav>
      </div>
      <div class="sidebar-footer">
        <Show when={capabilities.multiUser}>
          <Suspense>
            <LazySidebarAccountPanel collapsed={props.collapsed} />
          </Suspense>
        </Show>
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
              <path
                fill-rule="evenodd"
                d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z"
                clip-rule="evenodd"
              />
            </svg>
          </Show>
          <span class="theme-label">
            {theme() === "dark" ? "Light" : "Dark"}
          </span>
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
          flex: 1;
          padding: 8px 10px 14px;
          display: flex;
          flex-direction: column;
          gap: 16px;
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

        /* Collapsed/expanded toggle for dual-content elements */
        .logo-short,
        .nav-short {
          display: none;
        }

        .agent-sidebar.collapsed .logo-full,
        .agent-sidebar.collapsed .nav-full,
        .agent-sidebar.collapsed .dev-badge,
        .agent-sidebar.collapsed .collapse-btn,
        .agent-sidebar.collapsed .theme-label,
        .agent-sidebar.collapsed .sidebar-recent {
          display: none;
        }

        .agent-sidebar.collapsed .logo-short,
        .agent-sidebar.collapsed .nav-short {
          display: inline;
        }

        .agent-sidebar.collapsed .nav-link {
          text-align: center;
          padding: 8px 4px;
          font-weight: 600;
          font-size: 13px;
        }

        .agent-sidebar.collapsed .theme-toggle {
          justify-content: center;
        }

        /* Hover to expand: restore full content */
        .agent-sidebar.collapsed:hover .logo-full,
        .agent-sidebar.collapsed:hover .nav-full,
        .agent-sidebar.collapsed:hover .dev-badge,
        .agent-sidebar.collapsed:hover .collapse-btn,
        .agent-sidebar.collapsed:hover .theme-label,
        .agent-sidebar.collapsed:hover .sidebar-recent {
          display: revert;
        }

        .agent-sidebar.collapsed:hover .logo-short,
        .agent-sidebar.collapsed:hover .nav-short {
          display: none;
        }

        .agent-sidebar.collapsed:hover .nav-link {
          text-align: unset;
          padding: 8px 10px;
          font-weight: unset;
          font-size: 14px;
        }

        .agent-sidebar.collapsed:hover .theme-toggle {
          justify-content: unset;
        }

        @media (max-width: 768px) {
          .agent-sidebar {
            position: fixed;
            top: 0;
            left: 0;
            height: 100%;
            height: 100dvh;
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
