import { useNavigate } from "@solidjs/router";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
} from "solid-js";
import { fetchAgents } from "../../api";
import {
  fetchAgentAssignments,
  fetchUsers,
  setAgentAssignments,
  type AdminUser,
} from "../../api/admin";
import { useSession } from "../../auth/client";
import AdminLayout from "./AdminLayout";

type SessionUser = {
  role?: string | string[] | null;
};

function hasAdminRole(role: string | string[] | null | undefined): boolean {
  if (Array.isArray(role)) return role.includes("admin");
  return role === "admin";
}

function buildAssignmentMap(
  users: AdminUser[],
  assignments: Awaited<ReturnType<typeof fetchAgentAssignments>>
) {
  const approvedIds = new Set(
    users.filter((user) => user.approved).map((user) => user.id)
  );
  return assignments.reduce<Record<string, string[]>>((acc, assignment) => {
    if (!approvedIds.has(assignment.userId)) return acc;
    acc[assignment.agentId] = [...(acc[assignment.agentId] ?? []), assignment.userId];
    return acc;
  }, {});
}

export default function AgentAssignmentsPage() {
  const navigate = useNavigate();
  const session = useSession();
  const [agents] = createResource(fetchAgents);
  const [users] = createResource(fetchUsers);
  const [assignments, { refetch }] = createResource(fetchAgentAssignments);
  const [assignmentMap, setAssignmentMap] = createSignal<Record<string, string[]>>({});
  const [savingAgentId, setSavingAgentId] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const sessionUser = createMemo(
    () => (session().data?.user ?? null) as SessionUser | null
  );

  createEffect(() => {
    if (session().isPending) return;
    if (!hasAdminRole(sessionUser()?.role)) {
      void navigate("/", { replace: true });
    }
  });

  createEffect(() => {
    const currentUsers = users();
    const currentAssignments = assignments();
    if (!currentUsers || !currentAssignments) return;
    setAssignmentMap(buildAssignmentMap(currentUsers, currentAssignments));
  });

  const approvedUsers = createMemo(
    () => (users() ?? []).filter((user) => user.approved)
  );

  async function toggleAssignment(agentId: string, userId: string) {
    const current = new Set(assignmentMap()[agentId] ?? []);
    if (current.has(userId)) current.delete(userId);
    else current.add(userId);
    const next = [...current];
    setAssignmentMap((prev) => ({ ...prev, [agentId]: next }));
    setSavingAgentId(agentId);
    setError(null);
    try {
      await setAgentAssignments(agentId, next);
      await refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Save failed.");
      await refetch();
    } finally {
      setSavingAgentId(null);
    }
  }

  return (
    <AdminLayout
      title="Agent assignments"
      description="Choose which approved users can access each agent."
      active="agents"
    >
      <Show when={error()}>
        {(message) => <p class="admin-error">{message()}</p>}
      </Show>
      <Show
        when={!agents.loading && !users.loading && !assignments.loading}
        fallback={<div class="admin-empty">Loading assignments…</div>}
      >
        <Show
          when={approvedUsers().length > 0}
          fallback={<div class="admin-empty">Approve users to assign agent access.</div>}
        >
          <div class="admin-panel">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>Agent</th>
                  <For each={approvedUsers()}>
                    {(user) => (
                      <th>
                        <div class="assignment-user-heading">
                          <span>{user.name ?? user.email ?? user.id}</span>
                          <small>{user.email ?? user.id}</small>
                        </div>
                      </th>
                    )}
                  </For>
                </tr>
              </thead>
              <tbody>
                <For each={agents() ?? []}>
                  {(agent) => {
                    const selectedUserIds = createMemo(
                      () => new Set(assignmentMap()[agent.id] ?? [])
                    );
                    const busy = () => savingAgentId() === agent.id;
                    return (
                      <tr>
                        <td>
                          <div class="assignment-agent-cell">
                            <strong>{agent.name}</strong>
                            <span>{agent.id}</span>
                          </div>
                        </td>
                        <For each={approvedUsers()}>
                          {(user) => (
                            <td>
                              <label class="assignment-checkbox">
                                <input
                                  type="checkbox"
                                  checked={selectedUserIds().has(user.id)}
                                  disabled={busy()}
                                  onChange={() => void toggleAssignment(agent.id, user.id)}
                                />
                                <span>{busy() ? "Saving…" : "Allow"}</span>
                              </label>
                            </td>
                          )}
                        </For>
                      </tr>
                    );
                  }}
                </For>
              </tbody>
            </table>
          </div>
        </Show>
      </Show>
      <style>{`
        .admin-panel {
          border: 1px solid var(--border-default);
          border-radius: 18px;
          background: color-mix(in srgb, var(--bg-surface) 92%, transparent);
          overflow: auto;
        }

        .admin-table {
          width: 100%;
          border-collapse: collapse;
          min-width: 780px;
        }

        .admin-table th,
        .admin-table td {
          padding: 16px 18px;
          border-bottom: 1px solid var(--border-default);
          vertical-align: middle;
          text-align: left;
        }

        .admin-table th {
          color: var(--text-secondary);
          font-size: 0.82rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }

        .admin-table tbody tr:last-child td {
          border-bottom: none;
        }

        .assignment-user-heading {
          display: grid;
          gap: 4px;
          text-transform: none;
          letter-spacing: normal;
          font-size: 0.92rem;
          color: var(--text-primary);
        }

        .assignment-user-heading small {
          color: var(--text-secondary);
          font-size: 0.78rem;
        }

        .assignment-agent-cell {
          display: grid;
          gap: 4px;
        }

        .assignment-agent-cell strong {
          color: var(--text-primary);
        }

        .assignment-agent-cell span {
          color: var(--text-secondary);
          font-size: 0.9rem;
        }

        .assignment-checkbox {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          color: var(--text-primary);
        }

        .assignment-checkbox input {
          width: 16px;
          height: 16px;
        }

        .admin-error,
        .admin-empty {
          margin: 0;
          padding: 16px 18px;
          border-radius: 16px;
          border: 1px solid var(--border-default);
          background: color-mix(in srgb, var(--bg-surface) 92%, transparent);
          color: var(--text-secondary);
        }

        .admin-error {
          margin-bottom: 16px;
          color: var(--text-primary);
          background: color-mix(in srgb, #ef4444 12%, var(--bg-surface));
        }
      `}</style>
    </AdminLayout>
  );
}
