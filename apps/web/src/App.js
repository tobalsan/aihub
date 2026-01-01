import { createSignal, Show } from "solid-js";
import { AgentList } from "./components/AgentList";
import { ChatView } from "./components/ChatView";
export default function App() {
    const [selectedAgent, setSelectedAgent] = createSignal(null);
    return (<div class="app">
      <Show when={selectedAgent()} fallback={<AgentList onSelect={setSelectedAgent}/>}>
        <ChatView agent={selectedAgent()} onBack={() => setSelectedAgent(null)}/>
      </Show>

      <style>{`
        .app {
          height: 100%;
          display: flex;
          flex-direction: column;
          max-width: 600px;
          margin: 0 auto;
        }
      `}</style>
    </div>);
}
//# sourceMappingURL=App.js.map