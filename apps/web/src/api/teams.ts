export type Team = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  icon: string;
  createdBy: string;
  createdAt: string;
};

export type TeamInput = {
  name: string;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
};

export type DeleteTeamResult = {
  deleted: boolean;
  teamlessUsers: string[];
  teamlessAgents: string[];
};

// A forked pool agent and its provenance link. `teamId` is null when the fork
// is teamless/inert (unassigned).
export type AgentFork = {
  sourcePoolId: string;
  forkAgentId: string;
  teamId: string | null;
  createdBy: string;
  createdAt: string;
  assignedBy: string | null;
  assignedAt: string | null;
};

// The single action a pool catalog card should offer the current user. Mirrors
// the gateway pool-catalog resolver: chat (fork exists + chattable/staff),
// assign_to_team (staff, no fork yet), or none (visible-but-inert).
export type PoolCatalogAction = "chat" | "assign_to_team" | "none";

export type PoolCatalogEntry = {
  poolId: string;
  forked: boolean;
  // The fork agent id the Chat action routes to; non-null only when action is
  // "chat".
  chatAgentId: string | null;
  action: PoolCatalogAction;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await globalThis.fetch(path, {
    ...init,
    credentials: "include",
  });
  if (!res.ok) {
    const error = await res
      .json()
      .catch(() => ({ error: `Request failed (${res.status})` }));
    throw new Error(
      typeof error?.error === "string"
        ? error.error
        : `Request failed (${res.status})`
    );
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export async function fetchTeams(): Promise<Team[]> {
  const data = await request<{ teams: Team[] }>("/api/teams");
  return data.teams;
}

export async function createTeam(input: TeamInput): Promise<Team> {
  const data = await request<{ team: Team }>("/api/admin/teams", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return data.team;
}

export async function updateTeam(
  id: string,
  input: TeamInput
): Promise<Team> {
  const data = await request<{ team: Team }>(
    `/api/admin/teams/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );
  return data.team;
}

export async function deleteTeam(id: string): Promise<DeleteTeamResult> {
  return request<DeleteTeamResult>(
    `/api/admin/teams/${encodeURIComponent(id)}`,
    { method: "DELETE" }
  );
}

// Any authenticated user can read a team's members (global visibility).
export async function fetchTeamMembers(teamId: string): Promise<string[]> {
  const data = await request<{ teamId: string; userIds: string[] }>(
    `/api/teams/${encodeURIComponent(teamId)}/members`
  );
  return data.userIds;
}

// Admin-only: add a user to a team. Idempotent server-side.
export async function addTeamMember(
  teamId: string,
  userId: string
): Promise<string[]> {
  const data = await request<{ teamId: string; userIds: string[] }>(
    `/api/admin/teams/${encodeURIComponent(teamId)}/members`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    }
  );
  return data.userIds;
}

// Admin-only: remove a user from a team.
export async function removeTeamMember(
  teamId: string,
  userId: string
): Promise<string[]> {
  const data = await request<{ teamId: string; userIds: string[] }>(
    `/api/admin/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`,
    { method: "DELETE" }
  );
  return data.userIds;
}

// Admin-only: all fork provenance rows. Lets the pool catalog decide whether a
// pool agent is already forked (and to which team) or still assignable.
export async function fetchForks(): Promise<AgentFork[]> {
  const data = await request<{ forks: AgentFork[] }>("/api/admin/forks");
  return data.forks;
}

// Any authenticated user can list a team's agents (global visibility).
export async function fetchTeamAgents(teamId: string): Promise<AgentFork[]> {
  const data = await request<{ teamId: string; forks: AgentFork[] }>(
    `/api/teams/${encodeURIComponent(teamId)}/agents`
  );
  return data.forks;
}

// Per-user catalog action states for every pool agent. Available to any
// authenticated user; visibility is global and only the action is gated.
export async function fetchPoolActions(): Promise<PoolCatalogEntry[]> {
  const data = await request<{ actions: PoolCatalogEntry[] }>(
    "/api/pool-actions"
  );
  return data.actions;
}

// Admin-only: assign a pool agent to a team (forks on first assignment).
export async function assignPoolToTeam(
  poolId: string,
  teamId: string
): Promise<AgentFork> {
  const data = await request<{ fork: AgentFork }>("/api/admin/forks/assign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ poolId, teamId }),
  });
  return data.fork;
}

// Admin-only: move an existing fork to a different team.
export async function reassignFork(
  poolId: string,
  teamId: string
): Promise<AgentFork> {
  const data = await request<{ fork: AgentFork }>(
    `/api/admin/forks/${encodeURIComponent(poolId)}/reassign`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamId }),
    }
  );
  return data.fork;
}

// Admin-only: clear a fork's team link (teamless/inert; folder persists).
export async function unassignFork(poolId: string): Promise<AgentFork> {
  const data = await request<{ fork: AgentFork }>(
    `/api/admin/forks/${encodeURIComponent(poolId)}/unassign`,
    { method: "POST" }
  );
  return data.fork;
}
