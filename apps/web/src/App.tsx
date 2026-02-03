import { Router, Route } from "@solidjs/router";
import { onMount } from "solid-js";
import { AgentList } from "./components/AgentList";
import { ChatView } from "./components/ChatView";
import { ProjectsBoard } from "./components/ProjectsBoard";

function Layout(props: { children?: any }) {
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

export default function App() {
  const base = import.meta.env.BASE_URL;
  return (
    <Router root={Layout} base={base}>
      <Route path="/" component={ProjectsBoard} />
      <Route path="/agents" component={AgentList} />
      <Route path="/chat/:agentId/:view?" component={ChatView} />
      <Route path="/projects" component={ProjectsBoard} />
      <Route path="/projects/:id" component={ProjectsBoard} />
    </Router>
  );
}
