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
