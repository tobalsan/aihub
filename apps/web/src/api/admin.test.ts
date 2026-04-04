import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchAgentAssignments,
  fetchUsers,
  setAgentAssignments,
  updateUser,
} from "./admin";

type FetchResponse = {
  ok: boolean;
  json: () => Promise<unknown>;
};

describe("admin api client", () => {
  const fetchMock = vi.fn<() => Promise<FetchResponse>>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches users with credentials", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        users: [{ id: "user-1", email: "user@example.com", role: "user" }],
      }),
    });

    const users = await fetchUsers();

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/users", {
      credentials: "include",
    });
    expect(users[0]?.id).toBe("user-1");
  });

  it("updates a user with credentials", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    await updateUser("user-1", { approved: true, role: "admin" });

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/users/user-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approved: true, role: "admin" }),
      credentials: "include",
    });
  });

  it("fetches assignments with credentials", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        assignments: [{ agentId: "agent-a", userId: "user-1" }],
      }),
    });

    const assignments = await fetchAgentAssignments();

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/agents/assignments", {
      credentials: "include",
    });
    expect(assignments[0]?.agentId).toBe("agent-a");
  });

  it("sets assignments with credentials", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    await setAgentAssignments("agent-a", ["user-1", "user-2"]);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/agents/agent-a/assignments",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: ["user-1", "user-2"] }),
        credentials: "include",
      }
    );
  });
});
