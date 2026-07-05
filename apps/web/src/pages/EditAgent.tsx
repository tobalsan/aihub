import { createEffect, createMemo, createResource, Show } from "solid-js";
import { A, useNavigate, useParams } from "@solidjs/router";
import { fetchPool } from "../api";
import { useSession } from "../auth/client";

function isEmoji(str: string): boolean {
  return /^\p{Emoji}/u.test(str) && str.length <= 4;
}

const STAFF_ROLES = ["admin", "superadmin"];

function hasAdminRole(role: string | string[] | null | undefined): boolean {
  if (Array.isArray(role)) return role.some((r) => STAFF_ROLES.includes(r));
  return typeof role === "string" && STAFF_ROLES.includes(role);
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
      `}</style>
    </Show>
  );
}
