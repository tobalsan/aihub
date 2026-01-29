import { Router, Route } from "@solidjs/router";
import { AgentList } from "./components/AgentList";
import { ChatView } from "./components/ChatView";
import { ProjectsBoard } from "./components/ProjectsBoard";

function Layout(props: { children?: any }) {
  return (
    <>
      <div class="app">{props.children}</div>
      <style>{`
        .app {
          height: 100%;
          display: flex;
          flex-direction: column;
          max-width: 1024px;
          margin: 0 auto;
        }
      `}</style>
    </>
  );
}

export default function App() {
  const base = import.meta.env.BASE_URL;
  return (
    <Router root={Layout} base={base}>
      <Route path="/" component={AgentList} />
      <Route path="/chat/:agentId/:view?" component={ChatView} />
      <Route path="/projects" component={ProjectsBoard} />
      <Route path="/projects/:id" component={ProjectsBoard} />
    </Router>
  );
}
