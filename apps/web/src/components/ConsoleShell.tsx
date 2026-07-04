import type { JSX } from "solid-js";
import { A, useLocation } from "@solidjs/router";
import SidebarAccountPanel from "../auth/SidebarAccountPanel";

const basePath = import.meta.env.BASE_URL?.replace(/\/+$/, "") ?? "";

/** Strip the Vite base prefix from a router pathname. */
function stripBase(pathname: string): string {
  if (basePath && pathname.startsWith(basePath)) {
    return pathname.slice(basePath.length) || "/";
  }
  return pathname;
}

export function ConsoleShell(props: { children?: JSX.Element }) {
  const location = useLocation();

  return (
    <div class="console-shell">
      <aside class="console-rail">
        <A href="/" class="console-brand">Yoplai</A>
        <nav class="console-nav" aria-label="Primary">
          <A
            href="/agents"
            class="console-nav-link"
            classList={{
              active: stripBase(location.pathname).startsWith("/agents"),
            }}
          >
            Agents
          </A>
          <A
            href="/teams"
            class="console-nav-link"
            classList={{
              active: stripBase(location.pathname).startsWith("/teams"),
            }}
          >
            Teams
          </A>
        </nav>
        <div class="console-rail-footer">
          <SidebarAccountPanel collapsed={() => false} />
        </div>
      </aside>
      <main class="console-main">{props.children}</main>
      <style>{`
        .console-shell {
          height: 100%;
          width: 100%;
          display: flex;
          min-height: 0;
        }

        .console-rail {
          width: 220px;
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          background: var(--bg-surface);
          border-right: 1px solid var(--border-default);
          padding: 16px 12px;
        }

        .console-brand {
          display: block;
          font-size: 18px;
          font-weight: 700;
          color: var(--text-primary);
          text-decoration: none;
          padding: 0 6px 16px;
        }

        .console-nav {
          display: flex;
          flex-direction: column;
          gap: 4px;
          flex: 1;
        }

        .console-nav-link {
          display: block;
          padding: 8px 10px;
          border-radius: 8px;
          color: var(--text-secondary);
          text-decoration: none;
          font-size: 14px;
          transition: background 0.2s ease, color 0.2s ease;
        }

        .console-nav-link:hover {
          background: var(--bg-raised);
          color: var(--text-primary);
        }

        .console-nav-link.active {
          background: var(--border-default);
          color: var(--text-primary);
          font-weight: 600;
        }

        .console-rail-footer {
          padding-top: 8px;
          border-top: 1px solid var(--border-default);
        }

        .console-main {
          flex: 1;
          min-width: 0;
          min-height: 0;
          overflow-y: auto;
          overscroll-behavior: contain;
        }

        @media (max-width: 768px) {
          .console-shell {
            flex-direction: column;
          }

          .console-rail {
            width: 100%;
            flex-direction: row;
            align-items: center;
            border-right: none;
            border-bottom: 1px solid var(--border-default);
            padding: 8px 12px;
          }

          .console-brand {
            padding: 0 12px 0 0;
          }

          .console-nav {
            flex-direction: row;
          }

          .console-rail-footer {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}
