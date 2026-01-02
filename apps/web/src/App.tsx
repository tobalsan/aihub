import { Router, Route } from "@solidjs/router";
import { AgentList } from "./components/AgentList";
import { ChatView } from "./components/ChatView";

function Layout(props: { children?: any }) {
  return (
    <>
      <div class="app">{props.children}</div>
      <style>{`
        .app {
          height: 100%;
          display: flex;
          flex-direction: column;
          max-width: 600px;
          margin: 0 auto;
        }
      `}</style>
    </>
  );
}

export default function App() {
  return (
    <Router root={Layout}>
      <Route path="/" component={AgentList} />
      <Route path="/chat/:agentId/:view?" component={ChatView} />
    </Router>
  );
}
