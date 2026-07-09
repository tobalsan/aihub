import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchImpersonationStatus,
  fetchUsers,
  startImpersonation,
  updateUser,
} from "./admin";

type FetchResponse = {
  ok: boolean;
  status?: number;
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

  it("starts impersonation with 204 response", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 204,
      json: vi.fn(async () => {
        throw new Error("should not parse 204");
      }),
    });

    await startImpersonation("user-2");

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/impersonate/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetUserId: "user-2" }),
      credentials: "include",
    });
  });

  it("fetches impersonation status", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ active: false }),
    });

    await expect(fetchImpersonationStatus()).resolves.toEqual({ active: false });
    expect(fetchMock).toHaveBeenCalledWith("/api/impersonation/status", {
      credentials: "include",
    });
  });
});
