import { Router, Route, useParams } from "@solidjs/router";
import { Show, createMemo, onMount, type JSX } from "solid-js";
import { AgentList } from "./components/AgentList";
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
    <div class="projects-route-shell">
      <ProjectsBoard />
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
  );
}

export default function App() {
  const base = import.meta.env.BASE_URL;
  return (
    <Router root={Layout} base={base}>
      <Route path="/" component={ProjectsBoard} />
      <Route path="/agents" component={AgentList} />
      <Route path="/chat/:agentId/:view?" component={ChatView} />
      <Route path="/conversations" component={ConversationsPage} />
      <Route path="/projects/:id?" component={ProjectsRouteShell} />
    </Router>
  );
}
