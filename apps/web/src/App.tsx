import { Router, Route, useParams, useLocation, useNavigate } from "@solidjs/router";
import {
  Show,
  Suspense,
  createEffect,
  on,
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
  capabilities,
  isExtensionEnabled,
  loadCapabilities,
} from "./lib/capabilities";
import {
  sidebarCollapsed,
  setSidebarCollapsedPersistent,
  toggleSidebarCollapsed,
  toggleZenMode,
  zenMode,
} from "./lib/layout";

const LazyAreasOverview = lazy(() =>
  import("./components/AreasOverview").then((mod) => ({
    default: mod.AreasOverview,
  }))
);
const LazyBoardView = lazy(() =>
  import("./components/BoardView").then((mod) => ({
    default: mod.BoardView,
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
const LazySliceDetailPage = lazy(() =>
  import("./components/SliceDetailPage").then((mod) => ({
    default: mod.SliceDetailPage,
  }))
);
const LazyBoardProjectDetailPage = lazy(() =>
  import("./components/board/BoardProjectDetailPage").then((mod) => ({
    default: mod.BoardProjectDetailPage,
  }))
);
const LazyAuthGuard = lazy(() => import("./auth/AuthGuard"));
const LazyLoginPage = lazy(() => import("./pages/Login"));
const LazyAdminUsersPage = lazy(() => import("./pages/admin/Users"));
const LazyAdminAgentsPage = lazy(
  () => import("./pages/admin/AgentAssignments")
);

const basePath = import.meta.env.BASE_URL?.replace(/\/+$/, "") ?? "";

function stripBase(pathname: string): string {
  if (basePath && pathname.startsWith(basePath)) {
    return pathname.slice(basePath.length) || "/";
  }
  return pathname;
}

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
  const location = useLocation();
  const isLoginPage = createMemo(() => stripBase(location.pathname).startsWith("/login"));
  const canLoadQuickChatAgents = createMemo(
    () =>
      capabilitiesReady() &&
      !isLoginPage() &&
      (!capabilities.multiUser || Boolean(capabilities.user))
  );
  const [quickChatOpen, setQuickChatOpen] = createSignal(false);
  const [quickChatHasUnread, setQuickChatHasUnread] = createSignal(false);
  const [quickChatMobile, setQuickChatMobile] = createSignal(false);
  const [quickChatAgentId, setQuickChatAgentId] = createSignal<string | null>(
    readQuickChatAgentId()
  );
  const [agents] = createResource(canLoadQuickChatAgents, async (enabled) =>
    enabled ? fetchAgents() : []
  );
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

  const isOnChatPage = createMemo(() => {
    const p = stripBase(location.pathname);
    return p.startsWith("/chat/") || p.startsWith("/agents");
  });

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

  createEffect(() => {
    if (isLoginPage()) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "b" && !event.shiftKey) {
        event.preventDefault();
        toggleSidebarCollapsed();
        return;
      }
      if (key === "z" && event.shiftKey) {
        event.preventDefault();
        toggleZenMode();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  return (
    <>
      <Show when={capabilitiesReady()} fallback={<AppBootSplash />}>
        <div class="app" classList={{ "zen-mode": zenMode() }}>
          {props.children}
        </div>
      </Show>
      <Show when={canLoadQuickChatAgents() && !isOnChatPage()}>
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

        .app.zen-mode {
          background: var(--bg-base);
        }
      `}</style>
    </>
  );
}

function AppBootSplash() {
  return <div class="app" />;
}

function ExtensionUnavailable(props: { extension: string }) {
  return (
    <LeftNavShell>
      <div class="component-unavailable">
        <h1>Component not available</h1>
        <p>
          <code>{props.extension}</code> is disabled in this AIHub config.
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

function GuardedRoute(props: { children?: JSX.Element }) {
  return (
    <Show when={capabilities.multiUser} fallback={props.children}>
      <Suspense fallback={<AppBootSplash />}>
        <LazyAuthGuard>{props.children}</LazyAuthGuard>
      </Suspense>
    </Show>
  );
}

function ProjectsRouteShell() {
  if (!isExtensionEnabled("projects")) {
    return <ExtensionUnavailable extension="projects" />;
  }

  const params = useParams();
  const showDetail = createMemo(
    () => typeof params.id === "string" && params.id.length > 0
  );
  return (
    <LeftNavShell>
      <Suspense>
        <div class="projects-route-shell">
          <LazyProjectsBoard
            withSidebar={false}
            suspendProjectRealtime={showDetail()}
          />
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
              inset: 0 480px 0 0;
              z-index: 20;
            }

            @media (max-width: 1399px) {
              .projects-route-detail-layer {
                inset: 0 50px 0 0;
              }
            }

            @media (max-width: 768px) {
              .projects-route-detail-layer {
                inset: 0;
              }
            }
          `}</style>
        </div>
      </Suspense>
    </LeftNavShell>
  );
}

function BoardRouteShell() {
  return (
    <LeftNavShell>
      <Suspense>
        <LazyBoardView />
      </Suspense>
    </LeftNavShell>
  );
}

// Home route registry: maps extension IDs to lazy-loaded components.
// Extensions register here — no gateway or App code needs to know about them.
const HOME_REGISTRY: Record<string, () => JSX.Element> = {
  board: () => <BoardRouteShell />,
  projects: () => <AreasOverviewRouteShell />,
};

function HomeRoute() {
  const home = capabilities.home;
  const fallback = () => <AgentsRouteShell />;
  if (typeof home === "string" && home in HOME_REGISTRY) {
    return HOME_REGISTRY[home]();
  }
  if (isExtensionEnabled("projects")) return <AreasOverviewRouteShell />;
  return fallback();
}

function AreasOverviewRouteShell() {
  if (!isExtensionEnabled("projects")) {
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

  createEffect(on(isMobile, (mobile) => {
    if (mobile) setSidebarCollapsedPersistent(true);
  }, { defer: true }));

  return (
    <div class="left-nav-shell" classList={{ "zen-mode": zenMode() }}>
      <Show when={!zenMode()}>
        <AgentSidebar
          collapsed={sidebarCollapsed}
          onToggleCollapse={toggleSidebarCollapsed}
        />
      </Show>
      <Show when={isMobile() && !zenMode()}>
        <button
          class="mobile-sidebar-toggle"
          type="button"
          onClick={toggleSidebarCollapsed}
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
          overscroll-behavior: contain;
        }

        .left-nav-main {
          flex: 1;
          min-width: 0;
          min-height: 0;
          overflow: hidden;
        }

        .left-nav-shell.zen-mode .left-nav-main {
          width: 100%;
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

function AgentsRouteShell() {
  return (
    <LeftNavShell>
      <AgentList />
    </LeftNavShell>
  );
}

function BoardProjectDetailRouteShell() {
  if (!isExtensionEnabled("projects")) {
    return <ExtensionUnavailable extension="projects" />;
  }
  return (
    <LeftNavShell>
      <Suspense>
        <LazyBoardProjectDetailPage />
      </Suspense>
    </LeftNavShell>
  );
}

function SliceDetailRouteShell() {
  if (!isExtensionEnabled("projects")) {
    return <ExtensionUnavailable extension="projects" />;
  }
  return (
    <LeftNavShell>
      <Suspense>
        <LazySliceDetailPage />
      </Suspense>
    </LeftNavShell>
  );
}

/**
 * Flat /slices/:sliceId redirect — looks up the slice detail page.
 * Slice IDs encode project ID (PRO-XXX-Snn), so we parse it.
 */
function FlatSliceRedirect() {
  const params = useParams<{ sliceId: string }>();
  const navigate = useNavigate();
  const sliceId = () => params.sliceId ?? "";
  const projectId = createMemo(() => {
    const m = sliceId().match(/^(PRO-\d+)-S\d+$/);
    return m ? m[1] : "";
  });
  createEffect(() => {
    const pid = projectId();
    const sid = sliceId();
    if (pid && sid) {
      navigate(
        `/projects/${encodeURIComponent(pid)}/slices/${encodeURIComponent(sid)}`,
        { replace: true }
      );
    }
  });
  return <div class="app" />;
}

function ChatRouteShell() {
  return (
    <LeftNavShell>
      <ChatView />
    </LeftNavShell>
  );
}

function LoginRoute() {
  return (
    <Suspense fallback={<AppBootSplash />}>
      <LazyLoginPage />
    </Suspense>
  );
}

function AdminUsersRouteShell() {
  return (
    <LeftNavShell>
      <Suspense>
        <LazyAdminUsersPage />
      </Suspense>
    </LeftNavShell>
  );
}

function AdminAgentsRouteShell() {
  return (
    <LeftNavShell>
      <Suspense>
        <LazyAdminAgentsPage />
      </Suspense>
    </LeftNavShell>
  );
}

export default function App() {
  const base = import.meta.env.BASE_URL;
  return (
    <Router root={Layout} base={base}>
      <Route path="/login" component={LoginRoute} />
      <Route
        path="/"
        component={() => (
          <GuardedRoute>
            <HomeRoute />
          </GuardedRoute>
        )}
      />
      <Route
        path="/agents"
        component={() => (
          <GuardedRoute>
            <AgentsRouteShell />
          </GuardedRoute>
        )}
      />
      <Route
        path="/chat/:agentId/:view?"
        component={() => (
          <GuardedRoute>
            <ChatRouteShell />
          </GuardedRoute>
        )}
      />
      <Route
        path="/board"
        component={() => (
          <GuardedRoute>
            <BoardRouteShell />
          </GuardedRoute>
        )}
      />
      <Route
        path="/board/projects/:projectId"
        component={() => (
          <GuardedRoute>
            <BoardProjectDetailRouteShell />
          </GuardedRoute>
        )}
      />
      <Route
        path="/projects/:id?"
        component={() => (
          <GuardedRoute>
            <ProjectsRouteShell />
          </GuardedRoute>
        )}
      />
      <Route
        path="/projects/:projectId/slices/:sliceId"
        component={() => (
          <GuardedRoute>
            <SliceDetailRouteShell />
          </GuardedRoute>
        )}
      />
      <Route
        path="/slices/:sliceId"
        component={() => (
          <GuardedRoute>
            <FlatSliceRedirect />
          </GuardedRoute>
        )}
      />
      <Route
        path="/admin/users"
        component={() => (
          <GuardedRoute>
            <AdminUsersRouteShell />
          </GuardedRoute>
        )}
      />
      <Route
        path="/admin/agents"
        component={() => (
          <GuardedRoute>
            <AdminAgentsRouteShell />
          </GuardedRoute>
        )}
      />
    </Router>
  );
}
