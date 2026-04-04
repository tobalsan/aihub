export type AdminUser = {
  id: string;
  name: string | null;
  email: string | null;
  image?: string | null;
  role: string | string[] | null;
  approved: boolean | null;
  createdAt?: string;
};

export type Assignment = {
  userId: string;
  agentId: string;
  assignedBy: string;
  assignedAt: string;
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
  return res.json() as Promise<T>;
}

export async function fetchUsers(): Promise<AdminUser[]> {
  const data = await request<{ users: AdminUser[] }>("/api/admin/users");
  return data.users;
}

export async function updateUser(
  id: string,
  data: { approved?: boolean; role?: string }
): Promise<void> {
  await request(`/api/admin/users/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function fetchAgentAssignments(): Promise<Assignment[]> {
  const data = await request<{ assignments: Assignment[] }>(
    "/api/admin/agents/assignments"
  );
  return data.assignments;
}

export async function setAgentAssignments(
  agentId: string,
  userIds: string[]
): Promise<void> {
  await request(`/api/admin/agents/${encodeURIComponent(agentId)}/assignments`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userIds }),
  });
}
