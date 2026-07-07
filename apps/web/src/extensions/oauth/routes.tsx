import { createSignal, createEffect, For, Show, onCleanup } from "solid-js";
import type { Component } from "solid-js";
import { LeftNavShell } from "../../components/LeftNavShell";
import { fetchAgents } from "../../api/agents";
import type { Agent } from "../../api/types";

type OAuthStatus = {
  connected: boolean;
  provider: string;
  account?: string;
  scopes?: string[];
  connectedAt?: number;
};

const PROVIDER = "google";
const PROVIDER_LABEL = "Google Drive";

async function fetchOAuthStatus(
  agentId: string,
  provider = PROVIDER
): Promise<OAuthStatus> {
  const res = await fetch(
    `/api/oauth/${provider}/status?agent=${encodeURIComponent(agentId)}`
  );
  if (!res.ok) return { connected: false, provider };
  return (await res.json()) as OAuthStatus;
}

async function disconnectOAuth(agentId: string, provider = PROVIDER): Promise<void> {
  await fetch(
    `/api/oauth/${provider}/disconnect?agent=${encodeURIComponent(agentId)}`,
    { method: "POST" }
  );
}

function OAuthConnectPage(): ReturnType<Component> {
  const [agents, setAgents] = createSignal<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = createSignal<string>("");
  const [status, setStatus] = createSignal<OAuthStatus>();
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string>();

  createEffect(() => {
    void fetchAgents()
      .then((list) => {
        setAgents(list);
        if (!selectedAgent() && list.length > 0) setSelectedAgent(list[0].id);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : String(err))
      );
  });

  const refreshStatus = async () => {
    const agentId = selectedAgent();
    if (!agentId) return;
    setLoading(true);
    try {
      setStatus(await fetchOAuthStatus(agentId));
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  // Refresh status when the selected agent changes, and again when the popup
  // signals completion (postMessage) or the window regains focus.
  createEffect(() => {
    selectedAgent();
    void refreshStatus();
  });

  createEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (
        event.data &&
        typeof event.data === "object" &&
        event.data.type === "aihub-oauth"
      ) {
        void refreshStatus();
      }
    };
    const onFocus = () => void refreshStatus();
    window.addEventListener("message", onMessage);
    window.addEventListener("focus", onFocus);
    onCleanup(() => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("focus", onFocus);
    });
  });

  const connect = () => {
    const agentId = selectedAgent();
    if (!agentId) return;
    const url = `/api/oauth/${PROVIDER}/authorize?agent=${encodeURIComponent(agentId)}`;
    window.open(url, "aihub-oauth", "width=520,height=640");
  };

  const disconnect = async () => {
    const agentId = selectedAgent();
    if (!agentId) return;
    await disconnectOAuth(agentId);
    await refreshStatus();
  };

  return (
    <LeftNavShell>
      <div class="oauth-root">
        <style>{OAUTH_STYLES}</style>
        <header class="oauth-header">
          <h1>Connections</h1>
          <p>Connect external accounts per agent. Tokens are scoped to the agent workspace.</p>
        </header>

        <Show when={error()}>
          <div class="oauth-error">{error()}</div>
        </Show>

        <div class="oauth-agent-row">
          <label for="oauth-agent">Agent</label>
          <select
            id="oauth-agent"
            value={selectedAgent()}
            onChange={(e) => setSelectedAgent(e.currentTarget.value)}
          >
            <For each={agents()}>
              {(agent) => <option value={agent.id}>{agent.name ?? agent.id}</option>}
            </For>
          </select>
        </div>

        <section class="oauth-card">
          <div class="oauth-card-head">
            <div class="oauth-provider">
              <span class="oauth-provider-name">{PROVIDER_LABEL}</span>
              <Show
                when={status()?.connected}
                fallback={<span class="oauth-badge oauth-badge-off">Not connected</span>}
              >
                <span class="oauth-badge oauth-badge-on">Connected</span>
              </Show>
            </div>
            <Show
              when={status()?.connected}
              fallback={
                <button class="oauth-btn oauth-btn-primary" disabled={!selectedAgent()} onClick={connect}>
                  Connect Google Drive
                </button>
              }
            >
              <div class="oauth-actions">
                <button class="oauth-btn" onClick={() => void refreshStatus()}>Refresh</button>
                <button class="oauth-btn oauth-btn-danger" onClick={() => void disconnect()}>Disconnect</button>
              </div>
            </Show>
          </div>

          <Show when={status()?.connected}>
            <div class="oauth-connected-detail">
              <Show when={status()?.account}>
                <div class="oauth-account">
                  <span class="oauth-account-label">Connected as</span>
                  <span class="oauth-account-value">{status()!.account}</span>
                </div>
              </Show>
            </div>
          </Show>

          <Show when={loading() && !status()}>
            <div class="oauth-quiet">Checking connection…</div>
          </Show>
        </section>
      </div>
    </LeftNavShell>
  );
}

const OAUTH_STYLES = `
.oauth-root { max-width: 720px; margin: 0 auto; padding: 32px 24px; }
.oauth-header h1 { margin: 0 0 6px; font-size: 22px; color: var(--text-primary); }
.oauth-header p { margin: 0 0 24px; color: var(--text-secondary); font-size: 14px; }
.oauth-error { margin-bottom: 16px; padding: 10px 14px; border-radius: 10px;
  background: color-mix(in srgb, #ef4444 10%, transparent);
  border: 1px solid color-mix(in srgb, #ef4444 40%, transparent); color: var(--text-primary); font-size: 13px; }
.oauth-agent-row { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
.oauth-agent-row label { font-size: 13px; color: var(--text-secondary); font-weight: 600; }
.oauth-agent-row select { padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border-default);
  background: var(--bg-surface); color: var(--text-primary); font-size: 14px; min-width: 200px; }
.oauth-card { border: 1px solid var(--border-default); border-radius: 14px; background: var(--bg-surface); padding: 20px; }
.oauth-card-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.oauth-provider { display: flex; align-items: center; gap: 12px; }
.oauth-provider-name { font-size: 16px; font-weight: 600; color: var(--text-primary); }
.oauth-badge { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; padding: 3px 8px; border-radius: 999px; }
.oauth-badge-on { color: #137333; background: color-mix(in srgb, #137333 12%, transparent); }
.oauth-badge-off { color: var(--text-secondary); background: color-mix(in srgb, var(--text-secondary) 12%, transparent); }
.oauth-actions { display: flex; gap: 8px; }
.oauth-btn { padding: 8px 14px; border-radius: 8px; border: 1px solid var(--border-default);
  background: var(--bg-base); color: var(--text-primary); font-size: 13px; cursor: pointer; }
.oauth-btn:hover { border-color: color-mix(in srgb, var(--text-primary) 18%, var(--border-default)); }
.oauth-btn-primary { background: #1a73e8; border-color: #1a73e8; color: #fff; }
.oauth-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.oauth-btn-danger { color: #c5221f; }
.oauth-connected-detail { margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border-default); }
.oauth-account { display: flex; flex-direction: column; gap: 2px; }
.oauth-account-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-secondary); }
.oauth-account-value { font-size: 15px; color: var(--text-primary); font-weight: 500; }
.oauth-quiet { margin-top: 12px; color: var(--text-secondary); font-size: 13px; }
`;

export const webRouteExtension = {
  extensionId: "googleDrive",
  routes: [{ path: "/connections", component: OAuthConnectPage }],
};
