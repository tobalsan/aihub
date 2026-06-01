import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import type { Component } from "solid-js";
import { LeftNavShell } from "../../components/LeftNavShell";
import {
  fetchOrchestratorHealth,
  fetchOrchestratorLogs,
  fetchOrchestratorRun,
  fetchOrchestratorRuns,
  fetchOrchestratorWorkflow,
  interruptOrchestratorRun,
  killOrchestratorRun,
  type OrchestratorClaim,
  type OrchestratorEvent,
  type OrchestratorHealth,
  type OrchestratorLogEvent,
  type OrchestratorRun,
  type OrchestratorWorkflow,
} from "../../api/orchestrator";
import { subscribeToRealtime } from "../../api/realtime-client";

function runIssueId(run: OrchestratorRun | OrchestratorClaim): string {
  return String(run.issueId ?? run.issue_id ?? run.identifier ?? "");
}

function runId(run: OrchestratorRun | OrchestratorClaim): string {
  return String(run.runId ?? run.run_id ?? run.issueId ?? run.issue_id ?? "");
}

function dateLabel(value: unknown): string {
  if (typeof value !== "string" || !value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function statusLabel(health?: OrchestratorHealth): string {
  if (!health) return "loading";
  return health.status === "ok" ? "online" : health.status;
}

function repoFromRun(run?: OrchestratorRun | OrchestratorClaim): string | undefined {
  return typeof run?.repo === "string" ? run.repo : undefined;
}

function eventPayload(event: OrchestratorEvent): string {
  if (typeof event.payload !== "string") return JSON.stringify(event, null, 2);
  try {
    return JSON.stringify(JSON.parse(event.payload), null, 2);
  } catch {
    return event.payload;
  }
}

function logLine(event: OrchestratorLogEvent): string {
  const prefix = [event.timestamp, event.type].filter(Boolean).join(" ");
  const text = typeof event.text === "string" ? event.text : JSON.stringify(event);
  return prefix ? `${prefix} ${text}` : text;
}

function OrchestratorDashboard(): ReturnType<Component> {
  const [health, setHealth] = createSignal<OrchestratorHealth>();
  const [active, setActive] = createSignal<OrchestratorClaim[]>([]);
  const [recent, setRecent] = createSignal<OrchestratorRun[]>([]);
  const [selected, setSelected] = createSignal<OrchestratorRun | OrchestratorClaim>();
  const [workflow, setWorkflow] = createSignal<OrchestratorWorkflow>();
  const [events, setEvents] = createSignal<OrchestratorEvent[]>([]);
  const [logs, setLogs] = createSignal<OrchestratorLogEvent[]>([]);
  const [logCursor, setLogCursor] = createSignal(0);
  const [tab, setTab] = createSignal<"logs" | "events" | "workflow" | "chat">("logs");
  const [error, setError] = createSignal<string>();

  const selectedKey = () => {
    const run = selected();
    return run ? runId(run) || runIssueId(run) : "";
  };

  const load = async () => {
    try {
      const [nextHealth, runs] = await Promise.all([
        fetchOrchestratorHealth(),
        fetchOrchestratorRuns(),
      ]);
      setHealth(nextHealth);
      setActive(runs.active ?? []);
      setRecent(runs.recent ?? []);
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const loadSelected = async () => {
    const key = selectedKey();
    if (!key) return;
    try {
      const [detail, nextWorkflow] = await Promise.all([
        fetchOrchestratorRun(key),
        fetchOrchestratorWorkflow(repoFromRun(selected())),
      ]);
      setEvents(detail.events ?? []);
      setWorkflow(nextWorkflow);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const loadLogs = async () => {
    const key = selectedKey();
    if (!key) return;
    try {
      const response = await fetchOrchestratorLogs(key, logCursor());
      setLogCursor(response.cursor ?? logCursor());
      if (response.events?.length) {
        setLogs((current) => [...current, ...response.events]);
      }
    } catch (err) {
      setLogs((current) => [
        ...current,
        { type: "error", text: err instanceof Error ? err.message : String(err) },
      ]);
    }
  };

  createEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    const unsubscribe = subscribeToRealtime({
      interests: [{ type: "orchestrator" }],
      onEvent: () => {
        void load();
        void loadSelected();
      },
      onReconnect: () => void load(),
    });
    onCleanup(() => {
      window.clearInterval(timer);
      unsubscribe();
    });
  });

  createEffect(() => {
    selectedKey();
    setEvents([]);
    setLogs([]);
    setLogCursor(0);
    void loadSelected();
  });

  createEffect(() => {
    if (!selectedKey() || tab() !== "logs") return;
    void loadLogs();
    const timer = window.setInterval(() => void loadLogs(), 1500);
    onCleanup(() => window.clearInterval(timer));
  });

  createEffect(() => {
    if (!selectedKey() || tab() !== "events") return;
    void loadSelected();
    const timer = window.setInterval(() => void loadSelected(), 3000);
    onCleanup(() => window.clearInterval(timer));
  });

  const interrupt = async (id: string) => {
    await interruptOrchestratorRun(id);
    await load();
    await loadSelected();
  };

  const kill = async (id: string) => {
    await killOrchestratorRun(id);
    await load();
    setSelected(undefined);
  };

  return (
    <div style={{ padding: "24px", display: "grid", gap: "16px" }}>
      <header style={{ display: "flex", "justify-content": "space-between", gap: "12px", "align-items": "center" }}>
        <div>
          <h1 style={{ margin: 0 }}>Orchestrator</h1>
          <p style={{ margin: "6px 0 0", color: "var(--text-muted)" }}>
            Linear runtime. {statusLabel(health())}. Last tick {dateLabel(health()?.lastTickAt)}.
          </p>
        </div>
        <div style={{ display: "flex", gap: "12px", "align-items": "center" }}>
          <span>Rate limit: {health()?.rateLimitRemaining ?? "—"}</span>
          <span>Active: {health()?.activeClaims ?? active().length}</span>
          <button onClick={() => void load()}>Refresh</button>
        </div>
      </header>

      <Show when={error()}>
        <div style={{ color: "var(--danger)", border: "1px solid var(--danger)", padding: "10px", "border-radius": "8px" }}>
          {error()}
        </div>
      </Show>

      <section style={{ border: "1px solid var(--border)", "border-radius": "12px", padding: "16px" }}>
        <h2 style={{ margin: "0 0 12px" }}>Active runs</h2>
        <div style={{ display: "grid", "grid-template-columns": "repeat(auto-fit, minmax(260px, 1fr))", gap: "12px" }}>
          <Show when={active().length} fallback={<p style={{ color: "var(--text-muted)" }}>No active claims.</p>}>
            <For each={active()}>
              {(claim) => {
                const issueId = runIssueId(claim);
                const id = runId(claim) || issueId;
                return (
                  <article style={{ border: "1px solid var(--border)", "border-radius": "10px", padding: "12px", display: "grid", gap: "8px" }}>
                    <strong>{issueId || id}</strong>
                    <span style={{ color: "var(--text-muted)", "word-break": "break-all" }}>{id}</span>
                    <div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}>
                      <button onClick={() => setSelected(claim)}>Open</button>
                      <button onClick={() => void interrupt(id)}>Interrupt</button>
                      <button onClick={() => void kill(id)}>Kill</button>
                    </div>
                  </article>
                );
              }}
            </For>
          </Show>
        </div>
      </section>

      <section style={{ border: "1px solid var(--border)", "border-radius": "12px", padding: "16px", overflow: "auto" }}>
        <h2 style={{ margin: "0 0 12px" }}>Recent runs</h2>
        <table style={{ width: "100%", "border-collapse": "collapse" }}>
          <thead>
            <tr style={{ "text-align": "left" }}>
              <th>Issue</th>
              <th>Run</th>
              <th>Repo</th>
              <th>Started</th>
              <th>Outcome</th>
              <th>Exit</th>
            </tr>
          </thead>
          <tbody>
            <For each={recent()}>
              {(run) => (
                <tr onClick={() => setSelected(run)} style={{ cursor: "pointer", "border-top": "1px solid var(--border)" }}>
                  <td>{run.identifier ?? runIssueId(run)}</td>
                  <td style={{ "word-break": "break-all" }}>{runId(run)}</td>
                  <td>{run.repo ?? "—"}</td>
                  <td>{dateLabel(run.startedAt ?? run.started_at)}</td>
                  <td>{run.outcome ?? (run.finished_at || run.finishedAt ? "finished" : "running")}</td>
                  <td>{run.exitCode ?? run.exit_code ?? "—"}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </section>

      <Show when={selected()}>
        {(run) => {
          const key = () => runId(run()) || runIssueId(run());
          return (
            <aside style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "min(620px, 100vw)", background: "var(--bg)", border: "1px solid var(--border)", padding: "18px", "box-shadow": "0 0 40px rgba(0,0,0,.35)", "z-index": 30, overflow: "auto" }}>
              <div style={{ display: "flex", "justify-content": "space-between", gap: "12px" }}>
                <div>
                  <h2 style={{ margin: 0 }}>{runIssueId(run()) || key()}</h2>
                  <p style={{ margin: "6px 0 0", color: "var(--text-muted)", "word-break": "break-all" }}>{key()}</p>
                </div>
                <button onClick={() => setSelected(undefined)}>Close</button>
              </div>
              <nav style={{ display: "flex", gap: "8px", margin: "18px 0", "flex-wrap": "wrap" }}>
                <For each={["logs", "events", "workflow", "chat"] as const}>
                  {(item) => <button aria-pressed={tab() === item} onClick={() => setTab(item)}>{item}</button>}
                </For>
              </nav>
              <Show when={tab() === "logs"}>
                <pre style={{ "white-space": "pre-wrap" }}>
                  <Show when={logs().length} fallback="No logs yet.">
                    {logs().map(logLine).join("\n")}
                  </Show>
                </pre>
              </Show>
              <Show when={tab() === "events"}>
                <div style={{ display: "grid", gap: "10px" }}>
                  <Show when={events().length} fallback={<p style={{ color: "var(--text-muted)" }}>No events yet.</p>}>
                    <For each={events()}>
                      {(event) => (
                        <article style={{ border: "1px solid var(--border)", "border-radius": "8px", padding: "10px" }}>
                          <strong>{event.type ?? "event"}</strong>
                          <span style={{ color: "var(--text-muted)", "margin-left": "8px" }}>{dateLabel(event.created_at)}</span>
                          <pre style={{ "white-space": "pre-wrap", margin: "8px 0 0" }}>{eventPayload(event)}</pre>
                        </article>
                      )}
                    </For>
                  </Show>
                </div>
              </Show>
              <Show when={tab() === "workflow"}>
                <div style={{ display: "grid", gap: "12px" }}>
                  <p style={{ color: "var(--text-muted)", margin: 0 }}>
                    {workflow()?.path ?? "fallback workflow"} · {workflow()?.sha ?? "no sha"}
                  </p>
                  <h3>Frontmatter</h3>
                  <pre style={{ "white-space": "pre-wrap" }}>{JSON.stringify(workflow()?.frontmatter ?? {}, null, 2)}</pre>
                  <h3>Body</h3>
                  <pre style={{ "white-space": "pre-wrap" }}>{workflow()?.body ?? ""}</pre>
                </div>
              </Show>
              <Show when={tab() === "chat"}>
                <div style={{ display: "grid", gap: "10px" }}>
                  <Show when={events().length} fallback={<p style={{ color: "var(--text-muted)" }}>No event stream yet.</p>}>
                    <For each={events()}>
                      {(event) => (
                        <article style={{ border: "1px solid var(--border)", "border-radius": "8px", padding: "10px" }}>
                          <strong>{event.type ?? "event"}</strong>
                          <pre style={{ "white-space": "pre-wrap", margin: "8px 0 0" }}>{eventPayload(event)}</pre>
                        </article>
                      )}
                    </For>
                  </Show>
                </div>
              </Show>
            </aside>
          );
        }}
      </Show>
    </div>
  );
}

function OrchestratorRouteShell() {
  return (
    <LeftNavShell>
      <OrchestratorDashboard />
    </LeftNavShell>
  );
}

export const webRouteExtension: {
  extensionId: string;
  routes: { path: string; component: Component }[];
} = {
  extensionId: "orchestrator",
  routes: [{ path: "/orchestrator", component: OrchestratorRouteShell }],
};
