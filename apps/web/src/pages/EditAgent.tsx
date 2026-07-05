import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  Show,
} from "solid-js";
import { A, useNavigate, useParams } from "@solidjs/router";
import { fetchPool } from "../api";
import {
  assignPoolToTeam,
  fetchForks,
  fetchTeams,
  reassignFork,
  type AgentFork,
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

// Team assignment for the edit page: assign a never-forked pool agent to a
// team, or move an already-forked agent between teams. Reuses the same
// admin-guarded fork APIs the catalog cards used before this control moved here.
function TeamAssignment(props: {
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
    <section class="edit-agent-team">
      <h2 class="edit-agent-section-title">Team assignment</h2>
      <Show
        when={currentTeam()}
        fallback={
          <div class="edit-agent-team-current">Not assigned to a team.</div>
        }
      >
        {(team) => (
          <div class="edit-agent-team-current">
            Assigned to <strong>{team().name}</strong>
          </div>
        )}
      </Show>
      <select
        class="edit-agent-team-select"
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
        <p class="edit-agent-team-warning">
          ⚠ This will move the agent from{" "}
          <strong>{currentTeam()?.name ?? "its current team"}</strong>.
        </p>
      </Show>
      <button
        type="button"
        class="edit-agent-team-button"
        disabled={busy() || !selected()}
        onClick={() => void handleAssign()}
      >
        {props.fork ? "Move" : "Assign"}
      </button>
      <Show when={error()}>
        {(message) => <p class="edit-agent-team-error">{message()}</p>}
      </Show>
    </section>
  );
}

export function EditAgent() {
  const params = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const session = useSession();
  const isAdmin = createMemo(() =>
    hasAdminRole(
      (session().data?.user as { role?: string | string[] } | undefined)?.role
    )
  );

  // Admin-gated page: bounce non-admins home once the session has resolved.
  createEffect(() => {
    if (session().isPending) return;
    if (!isAdmin()) void navigate("/", { replace: true });
  });

  const [agents] = createResource(() =>
    isAdmin() ? fetchPool() : Promise.resolve([])
  );
  const agent = createMemo(() =>
    (agents() ?? []).find((candidate) => candidate.id === params.agentId)
  );

  const [teams] = createResource(() =>
    isAdmin() ? fetchTeams() : Promise.resolve([] as Team[])
  );
  const [forks, { refetch: refetchForks }] = createResource(() =>
    isAdmin() ? fetchForks() : Promise.resolve([] as AgentFork[])
  );
  const fork = createMemo(() =>
    (forks() ?? []).find((entry) => entry.sourcePoolId === params.agentId)
  );

  return (
    <Show when={isAdmin()}>
      <div class="edit-agent">
        <A href="/agents" class="edit-agent-back">
          ← Back to agents
        </A>

        <Show when={agents.loading}>
          <div class="loading">Loading agent…</div>
        </Show>

        <Show when={!agents.loading && !agent()}>
          <div class="error">Agent not found.</div>
        </Show>

        <Show when={agent()}>
          {(current) => (
            <div class="edit-agent-header">
              <Show when={current().avatar}>
                {(avatar) => (
                  <div class="edit-agent-avatar">
                    {isEmoji(avatar()) ? (
                      <span class="avatar-emoji">{avatar()}</span>
                    ) : (
                      <img
                        src={avatar()}
                        alt={current().name}
                        class="avatar-img"
                      />
                    )}
                  </div>
                )}
              </Show>
              <div class="edit-agent-identity">
                <h1 class="edit-agent-name">{current().name}</h1>
                <Show when={current().role}>
                  <div class="edit-agent-role">{current().role}</div>
                </Show>
              </div>
            </div>
          )}
        </Show>

        <Show when={agent()}>
          <TeamAssignment
            poolId={params.agentId}
            teams={teams() ?? []}
            fork={fork()}
            onChanged={() => void refetchForks()}
          />
        </Show>
      </div>

      <style>{`
        .edit-agent {
          padding: 24px;
        }

        .edit-agent-back {
          display: inline-block;
          margin-bottom: 20px;
          font-size: 14px;
          color: var(--text-secondary);
          text-decoration: none;
        }

        .edit-agent-back:hover {
          color: var(--text-primary);
        }

        .loading, .error {
          padding: 24px 0;
          color: var(--text-tertiary);
        }

        .error {
          color: #e55;
        }

        .edit-agent-header {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .edit-agent-avatar {
          width: 72px;
          height: 72px;
          border-radius: 14px;
          background: var(--bg-raised);
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          flex-shrink: 0;
        }

        .avatar-emoji {
          font-size: 44px;
          line-height: 1;
        }

        .avatar-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .edit-agent-identity {
          min-width: 0;
        }

        .edit-agent-name {
          margin: 0;
          font-size: 24px;
          font-weight: 700;
          color: var(--text-primary);
        }

        .edit-agent-role {
          margin-top: 4px;
          font-size: 14px;
          color: var(--text-tertiary);
        }

        .edit-agent-team {
          margin-top: 28px;
          max-width: 320px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .edit-agent-section-title {
          margin: 0 0 4px;
          font-size: 16px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .edit-agent-team-current {
          font-size: 13px;
          color: var(--text-tertiary);
        }

        .edit-agent-team-select {
          width: 100%;
          padding: 8px 10px;
          border-radius: 6px;
          border: 1px solid var(--border-default);
          background: var(--bg-raised);
          color: var(--text-primary);
          font-size: 14px;
        }

        .edit-agent-team-warning {
          font-size: 13px;
          color: #d97706;
          margin: 0;
        }

        .edit-agent-team-button {
          padding: 8px 16px;
          border-radius: 6px;
          border: none;
          background: var(--accent, #3b82f6);
          color: #fff;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          align-self: flex-start;
        }

        .edit-agent-team-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .edit-agent-team-error {
          font-size: 13px;
          color: #e55;
          margin: 0;
        }
      `}</style>
    </Show>
  );
}
