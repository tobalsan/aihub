import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import { A } from "@solidjs/router";
import { fetchPool } from "../api";
import {
  assignPoolToTeam,
  fetchForks,
  fetchPoolActions,
  fetchTeams,
  reassignFork,
  type AgentFork,
  type PoolCatalogEntry,
  type Team,
} from "../api/teams";
import { useSession } from "../auth/client";

function isEmoji(str: string): boolean {
  return /^\p{Emoji}/u.test(str) && str.length <= 4;
}

const STAFF_ROLES = ["admin", "superadmin"];

function hasAdminRole(role: string | string[] | null | undefined): boolean {
  if (Array.isArray(role)) return role.some((r) => STAFF_ROLES.includes(r));
  return typeof role === "string" && STAFF_ROLES.includes(role);
}

function AssignToTeam(props: {
  poolId: string;
  teams: Team[];
  fork: AgentFork | undefined;
  onChanged: () => void;
}) {
  const [selected, setSelected] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const currentTeam = createMemo(() =>
    props.fork?.teamId
      ? props.teams.find((team) => team.id === props.fork?.teamId)
      : undefined
  );

  const handleAssign = async () => {
    const teamId = selected();
    if (!teamId || busy()) return;
    setBusy(true);
    setError(null);
    try {
      // An existing fork moves teams (reassign); a never-forked pool agent
      // forks on first assignment.
      if (props.fork) {
        await reassignFork(props.poolId, teamId);
      } else {
        await assignPoolToTeam(props.poolId, teamId);
      }
      setSelected("");
      props.onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to assign.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="catalog-assign">
      <Show when={currentTeam()}>
        {(team) => (
          <div class="catalog-assign__current">
            Assigned to <strong>{team().name}</strong>
          </div>
        )}
      </Show>
      <select
        class="catalog-assign__select"
        value={selected()}
        disabled={busy() || props.teams.length === 0}
        onChange={(event) => setSelected(event.currentTarget.value)}
      >
        <option value="">
          {props.fork ? "Move to team…" : "Assign to team…"}
        </option>
        <For each={props.teams}>
          {(team) => (
            <Show when={team.id !== props.fork?.teamId}>
              <option value={team.id}>{team.name}</option>
            </Show>
          )}
        </For>
      </select>
      {/* Reassigning an already-forked agent moves its single fork away from
          the previous team — warn before the move. */}
      <Show when={props.fork && props.fork.teamId && selected()}>
        <p class="catalog-assign__warning">
          ⚠ This will move the agent from{" "}
          <strong>{currentTeam()?.name ?? "its current team"}</strong>.
        </p>
      </Show>
      <button
        type="button"
        class="catalog-assign__button"
        disabled={busy() || !selected()}
        onClick={() => void handleAssign()}
      >
        {props.fork ? "Move" : "Assign"}
      </button>
      <Show when={error()}>
        {(message) => <p class="catalog-assign__error">{message()}</p>}
      </Show>
    </div>
  );
}

export function AgentCatalog() {
  const [agents] = createResource(fetchPool);
  const session = useSession();
  const isAdmin = createMemo(() =>
    hasAdminRole(
      (session().data?.user as { role?: string | string[] } | undefined)?.role
    )
  );
  const [teams] = createResource(() => (isAdmin() ? fetchTeams() : Promise.resolve([] as Team[])));
  const [forks, { refetch: refetchForks }] = createResource(() =>
    isAdmin() ? fetchForks() : Promise.resolve([] as AgentFork[])
  );
  // The per-user action state for every pool card, resolved by the gateway
  // (chat / assign_to_team / none). Refetched alongside forks so an admin's
  // assign/reassign immediately updates the resolved action.
  const [actions, { refetch: refetchActions }] = createResource(fetchPoolActions);
  const forkByPool = createMemo(() => {
    const map = new Map<string, AgentFork>();
    for (const fork of forks() ?? []) map.set(fork.sourcePoolId, fork);
    return map;
  });
  const actionByPool = createMemo(() => {
    const map = new Map<string, PoolCatalogEntry>();
    for (const entry of actions() ?? []) map.set(entry.poolId, entry);
    return map;
  });
  const refresh = () => {
    void refetchForks();
    void refetchActions();
  };

  return (
    <div class="agent-catalog">
      <h1 class="catalog-heading">Agents</h1>

      <Show when={agents.loading}>
        <div class="loading">Loading agents...</div>
      </Show>

      <Show when={agents.error}>
        <div class="error">Failed to load agents</div>
      </Show>

      <Show when={agents()}>
        <div class="catalog-grid">
          <For each={agents()}>
            {(agent) => (
              <div class="catalog-card">
                <Show when={agent.avatar}>
                  {(avatar) => (
                    <div class="catalog-avatar">
                      {isEmoji(avatar()) ? (
                        <span class="avatar-emoji">{avatar()}</span>
                      ) : (
                        <img src={avatar()} alt={agent.name} class="avatar-img" />
                      )}
                    </div>
                  )}
                </Show>
                <div class="catalog-name">{agent.name}</div>
                <Show when={agent.role}>
                  <div class="catalog-role">{agent.role}</div>
                </Show>
                <Show when={agent.description}>
                  <div class="catalog-description">{agent.description}</div>
                </Show>
                <div class="catalog-divider" />
                {(() => {
                  const entry = actionByPool().get(agent.id);
                  // Chat: a fork exists and this user can chat it (member or
                  // staff). Route to the fork agent id, never the pool id.
                  return (
                    <Show
                      when={entry?.action === "chat"}
                      fallback={
                        <Show
                          when={entry?.action === "none"}
                          fallback={null}
                        >
                          <span class="catalog-unavailable">
                            Not available
                          </span>
                        </Show>
                      }
                    >
                      <A
                        href={`/chat/${entry?.chatAgentId ?? agent.id}`}
                        class="catalog-chat-link"
                      >
                        Chat
                      </A>
                    </Show>
                  );
                })()}
                {/* Admins keep the assign/reassign flow: "Assign to team" for
                    a not-yet-forked pool agent, "Move to team…" once forked. */}
                <Show when={isAdmin()}>
                  <AssignToTeam
                    poolId={agent.id}
                    teams={teams() ?? []}
                    fork={forkByPool().get(agent.id)}
                    onChanged={refresh}
                  />
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>

      <style>{`
        .agent-catalog {
          padding: 24px;
        }

        .catalog-heading {
          font-size: 24px;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: 20px;
        }

        .loading, .error {
          padding: 24px;
          text-align: center;
          color: var(--text-tertiary);
        }

        .error {
          color: #e55;
        }

        .catalog-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 16px;
        }

        .catalog-card {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          height: 100%;
          padding: 20px 16px;
          background: var(--bg-surface);
          border: 1px solid var(--scrollbar-thumb);
          border-radius: 12px;
        }

        .catalog-avatar {
          width: calc(100% + 32px);
          aspect-ratio: 1 / 1;
          border-radius: 12px 12px 0 0;
          background: var(--bg-raised);
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          margin: -20px -16px 12px -16px;
        }

        .avatar-emoji {
          font-size: 96px;
          line-height: 1;
        }

        .avatar-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .catalog-name {
          font-size: 16px;
          font-weight: 700;
          color: var(--text-primary);
        }

        .catalog-role {
          font-size: 13px;
          color: var(--text-tertiary);
          margin-top: 2px;
        }

        .catalog-description {
          font-size: 12px;
          color: var(--text-tertiary);
          margin-top: 6px;
        }

        .catalog-divider {
          width: 100%;
          height: 1px;
          background: var(--border-default);
          margin: 14px 0;
          margin-top: auto;
        }

        .catalog-chat-link {
          display: inline-block;
          padding: 8px 20px;
          border-radius: 8px;
          background: var(--bg-raised);
          color: var(--text-primary);
          text-decoration: none;
          font-size: 14px;
          font-weight: 500;
          transition: background 0.2s ease;
        }

        .catalog-chat-link:hover {
          background: var(--border-default);
        }

        .catalog-unavailable {
          display: inline-block;
          padding: 8px 20px;
          font-size: 13px;
          color: var(--text-tertiary);
          font-style: italic;
        }

        .catalog-assign {
          width: 100%;
          margin-top: 12px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .catalog-assign__current {
          font-size: 12px;
          color: var(--text-tertiary);
        }

        .catalog-assign__select {
          width: 100%;
          padding: 6px 8px;
          border-radius: 6px;
          border: 1px solid var(--border-default);
          background: var(--bg-raised);
          color: var(--text-primary);
          font-size: 13px;
        }

        .catalog-assign__warning {
          font-size: 12px;
          color: #d97706;
          margin: 0;
        }

        .catalog-assign__button {
          width: 100%;
          padding: 6px 12px;
          border-radius: 6px;
          border: none;
          background: var(--accent, #3b82f6);
          color: #fff;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
        }

        .catalog-assign__button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .catalog-assign__error {
          font-size: 12px;
          color: #e55;
          margin: 0;
        }

        @media (max-width: 768px) {
          .catalog-grid {
            grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
          }
        }
      `}</style>
    </div>
  );
}
