import { Router, Route, useParams } from "@solidjs/router";
import {
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";
import { AgentList } from "./components/AgentList";
import { AgentSidebar } from "./components/AgentSidebar";
import { ChatView } from "./components/ChatView";
import { ConversationsPage } from "./components/conversations/ConversationsPage";
import { ProjectsBoard } from "./components/ProjectsBoard";
import { ProjectDetailPage } from "./components/project/ProjectDetailPage";

function Layout(props: { children?: JSX.Element }) {
  // Set document title based on dev mode
  onMount(() => {
    if (import.meta.env.VITE_AIHUB_DEV === "true") {
      const port = import.meta.env.VITE_AIHUB_UI_PORT ?? "?";
      document.title = `[DEV :${port}] AIHub`;
    }
  });

  return (
    <>
      <div class="app">{props.children}</div>
      <style>{`
        .app {
          height: 100%;
          display: flex;
          flex-direction: column;
          width: 100%;
        }
      `}</style>
    </>
  );
}

function ProjectsRouteShell() {
  const params = useParams();
  const showDetail = createMemo(
    () => typeof params.id === "string" && params.id.length > 0
  );
  return (
    <LeftNavShell>
      <div class="projects-route-shell">
        <ProjectsBoard withSidebar={false} />
        <Show when={showDetail()}>
          <div class="projects-route-detail-layer">
            <ProjectDetailPage />
          </div>
        </Show>
        <style>{`
          .projects-route-shell {
            height: 100%;
            position: relative;
          }

          .projects-route-detail-layer {
            position: absolute;
            inset: 0;
            z-index: 20;
          }
        `}</style>
      </div>
    </LeftNavShell>
  );
}

function LeftNavShell(props: { children?: JSX.Element }) {
  const SIDEBAR_KEY = "aihub:sidebar-collapsed";
  const [sidebarCollapsed, setSidebarCollapsed] = createSignal(
    localStorage.getItem(SIDEBAR_KEY) === "true"
  );
  const [isMobile, setIsMobile] = createSignal(false);

  onMount(() => {
    const media = window.matchMedia("(max-width: 768px)");
    const update = (matches: boolean) => setIsMobile(matches);
    update(media.matches);
    const handler = (event: MediaQueryListEvent) => update(event.matches);
    if (media.addEventListener) {
      media.addEventListener("change", handler);
      onCleanup(() => media.removeEventListener("change", handler));
    } else {
      media.addListener(handler);
      onCleanup(() => media.removeListener(handler));
    }
  });

  createEffect(() => {
    if (isMobile()) setSidebarCollapsed(true);
  });

  return (
    <div class="left-nav-shell">
      <AgentSidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((prev) => {
          const next = !prev;
          localStorage.setItem(SIDEBAR_KEY, String(next));
          return next;
        })}
      />
      <Show when={isMobile()}>
        <button
          class="mobile-sidebar-toggle"
          type="button"
          onClick={() => setSidebarCollapsed((prev) => !prev)}
          aria-label="Toggle sidebar"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M3 12h18M3 6h18M3 18h18" />
          </svg>
        </button>
      </Show>
      <div class="left-nav-main">{props.children}</div>
      <style>{`
        .left-nav-shell {
          height: 100%;
          display: flex;
          width: 100%;
          position: relative;
          min-height: 0;
        }

        .left-nav-main {
          flex: 1;
          min-width: 0;
          min-height: 0;
        }

        .left-nav-shell .mobile-sidebar-toggle {
          position: fixed;
          top: 14px;
          left: 12px;
          z-index: 900;
          width: 40px;
          height: 40px;
          border-radius: 10px;
          border: 1px solid var(--border-default);
          background: var(--bg-surface);
          color: var(--text-secondary);
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .left-nav-shell .mobile-sidebar-toggle svg {
          width: 18px;
          height: 18px;
        }

        @media (min-width: 769px) {
          .left-nav-shell .mobile-sidebar-toggle {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}

function ConversationsRouteShell() {
  return (
    <LeftNavShell>
      <ConversationsPage />
    </LeftNavShell>
  );
}

function AgentsRouteShell() {
  return (
    <LeftNavShell>
      <AgentList />
    </LeftNavShell>
  );
}

function ChatRouteShell() {
  return (
    <LeftNavShell>
      <ChatView />
    </LeftNavShell>
  );
}

export default function App() {
  const base = import.meta.env.BASE_URL;
  return (
    <Router root={Layout} base={base}>
      <Route path="/" component={ProjectsBoard} />
      <Route path="/agents" component={AgentsRouteShell} />
      <Route path="/chat/:agentId/:view?" component={ChatRouteShell} />
      <Route path="/conversations" component={ConversationsRouteShell} />
      <Route path="/projects/:id?" component={ProjectsRouteShell} />
    </Router>
  );
}
