import { Router, Route, useParams, useLocation } from "@solidjs/router";
import {
  Show,
  Suspense,
  createEffect,
  lazy,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";
import { fetchAgents, getSessionKey, subscribeToSession } from "./api/client";
import type { Agent } from "./api/types";
import { AgentList } from "./components/AgentList";
import { AgentSidebar } from "./components/AgentSidebar";
import { ChatView } from "./components/ChatView";
import { QuickChatFAB } from "./components/QuickChatFAB";
import { QuickChatOverlay } from "./components/QuickChatOverlay";
import {
  capabilitiesReady,
  isComponentEnabled,
  loadCapabilities,
} from "./lib/capabilities";

const LazyAreasOverview = lazy(() =>
  import("./components/AreasOverview").then((mod) => ({
    default: mod.AreasOverview,
  }))
);
const LazyConversationsPage = lazy(() =>
  import("./components/conversations/ConversationsPage").then((mod) => ({
    default: mod.ConversationsPage,
  }))
);
const LazyProjectsBoard = lazy(() =>
  import("./components/ProjectsBoard").then((mod) => ({
    default: mod.ProjectsBoard,
  }))
);
const LazyProjectDetailPage = lazy(() =>
  import("./components/project/ProjectDetailPage").then((mod) => ({
    default: mod.ProjectDetailPage,
  }))
);

const QUICK_CHAT_LAST_AGENT_KEY = "aihub:quick-chat-last-agent";

function readQuickChatAgentId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(QUICK_CHAT_LAST_AGENT_KEY);
}

function pickDefaultQuickAgentId(agents: Agent[]): string | null {
  if (agents.length === 0) return null;
  const lead =
    agents.find(
      (agent) =>
        agent.id.toLowerCase().includes("lead") ||
        agent.name.toLowerCase().includes("lead")
    ) ?? agents[0];
  return lead.id;
}

function Layout(props: { children?: JSX.Element }) {
  const [quickChatOpen, setQuickChatOpen] = createSignal(false);
  const [quickChatHasUnread, setQuickChatHasUnread] = createSignal(false);
  const [quickChatMobile, setQuickChatMobile] = createSignal(false);
  const [quickChatAgentId, setQuickChatAgentId] = createSignal<string | null>(
    readQuickChatAgentId()
  );
  const [agents] = createResource(fetchAgents);
  const quickChatAgents = createMemo(() => agents() ?? []);
  const selectedQuickChatAgent = createMemo(
    () =>
      quickChatAgents().find((agent) => agent.id === quickChatAgentId()) ?? null
  );
  const quickChatFabLabel = createMemo(
    () => selectedQuickChatAgent()?.name ?? "Lead agent"
  );

  // Set document title based on dev mode
  onMount(() => {
    if (import.meta.env.VITE_AIHUB_DEV === "true") {
      const port = import.meta.env.VITE_AIHUB_UI_PORT ?? "?";
      document.title = `[DEV :${port}] AIHub`;
    }
    void loadCapabilities().catch(() => undefined);
  });

  onMount(() => {
    const media = window.matchMedia("(max-width: 768px)");
    const update = (matches: boolean) => setQuickChatMobile(matches);
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
    const list = quickChatAgents();
    if (list.length === 0) return;
    const current = quickChatAgentId();
    if (current && list.some((agent) => agent.id === current)) return;
    const next = pickDefaultQuickAgentId(list);
    setQuickChatAgentId(next);
  });

  createEffect(() => {
    const agentId = quickChatAgentId();
    if (typeof window === "undefined") return;
    if (agentId) {
      localStorage.setItem(QUICK_CHAT_LAST_AGENT_KEY, agentId);
    } else {
      localStorage.removeItem(QUICK_CHAT_LAST_AGENT_KEY);
    }
  });

  createEffect(() => {
    if (!quickChatOpen()) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setQuickChatOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  const location = useLocation();
  const isOnChatPage = createMemo(() => location.pathname.startsWith("/chat/") || location.pathname.startsWith("/agents"));

  createEffect(() => {
    if (quickChatOpen()) setQuickChatHasUnread(false);
  });

  createEffect(() => {
    if (isOnChatPage() && quickChatOpen()) setQuickChatOpen(false);
  });

  createEffect(() => {
    const agentId = quickChatAgentId();
    if (!agentId) return;
    const cleanup = subscribeToSession(agentId, getSessionKey(agentId), {
      onHistoryUpdated: () => {
        if (!quickChatOpen()) {
          setQuickChatHasUnread(true);
        }
      },
    });
    onCleanup(cleanup);
  });

  return (
    <>
      <Show when={capabilitiesReady()} fallback={<AppBootSplash />}>
        <div class="app">{props.children}</div>
      </Show>
      <Show when={!isOnChatPage()}>
      <QuickChatOverlay
        open={quickChatOpen()}
        mobile={quickChatMobile()}
        agents={quickChatAgents()}
        selectedAgentId={quickChatAgentId()}
        onSelectAgent={(agentId) => {
          setQuickChatAgentId(agentId);
          setQuickChatHasUnread(false);
        }}
        onMinimize={() => setQuickChatOpen(false)}
        onClose={() => setQuickChatOpen(false)}
      />
      <QuickChatFAB
        open={quickChatOpen}
        hasUnread={quickChatHasUnread}
        agentLabel={quickChatFabLabel}
        onToggle={() => {
          setQuickChatOpen((prev) => {
            const next = !prev;
            if (next) setQuickChatHasUnread(false);
            return next;
          });
        }}
      />
      </Show>
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

function AppBootSplash() {
  return <div class="app" />;
}

function ComponentUnavailable(props: { component: string }) {
  return (
    <LeftNavShell>
      <div class="component-unavailable">
        <h1>Component not available</h1>
        <p>
          <code>{props.component}</code> is disabled in this AIHub config.
        </p>
      </div>
      <style>{`
        .component-unavailable {
          height: 100%;
          display: grid;
          place-items: center;
          padding: 32px;
          text-align: center;
          color: var(--text-secondary);
        }

        .component-unavailable h1 {
          margin: 0 0 8px;
          color: var(--text-primary);
        }

        .component-unavailable p {
          margin: 0;
        }
      `}</style>
    </LeftNavShell>
  );
}

function ProjectsRouteShell() {
  if (!isComponentEnabled("projects")) {
    return <ComponentUnavailable component="projects" />;
  }

  const params = useParams();
  const showDetail = createMemo(
    () => typeof params.id === "string" && params.id.length > 0
  );
  return (
    <LeftNavShell>
      <Suspense>
        <div class="projects-route-shell">
          <LazyProjectsBoard withSidebar={false} />
          <Show when={showDetail()}>
            <div class="projects-route-detail-layer">
              <LazyProjectDetailPage />
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
      </Suspense>
    </LeftNavShell>
  );
}

function AreasOverviewRouteShell() {
  if (!isComponentEnabled("projects")) {
    return <AgentsRouteShell />;
  }

  return (
    <LeftNavShell>
      <Suspense>
        <LazyAreasOverview />
      </Suspense>
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
        onToggleCollapse={() =>
          setSidebarCollapsed((prev) => {
            const next = !prev;
            localStorage.setItem(SIDEBAR_KEY, String(next));
            return next;
          })
        }
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
  if (!isComponentEnabled("conversations")) {
    return <ComponentUnavailable component="conversations" />;
  }

  return (
    <LeftNavShell>
      <Suspense>
        <LazyConversationsPage />
      </Suspense>
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
      <Route path="/" component={AreasOverviewRouteShell} />
      <Route path="/agents" component={AgentsRouteShell} />
      <Route path="/chat/:agentId/:view?" component={ChatRouteShell} />
      <Route path="/conversations" component={ConversationsRouteShell} />
      <Route path="/projects/:id?" component={ProjectsRouteShell} />
    </Router>
  );
}
