import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addTeamMember,
  fetchTeamMembers,
  removeTeamMember,
} from "./teams";

type FetchResponse = {
  ok: boolean;
  status?: number;
  json: () => Promise<unknown>;
};

describe("teams membership api client", () => {
  const fetchMock = vi.fn<() => Promise<FetchResponse>>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches team members from the global route", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ teamId: "team-1", userIds: ["user-1"] }),
    });

    const members = await fetchTeamMembers("team-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/teams/team-1/members", {
      credentials: "include",
    });
    expect(members).toEqual(["user-1"]);
  });

  it("adds a member via the admin route", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ teamId: "team-1", userIds: ["user-1"] }),
    });

    const result = await addTeamMember("team-1", "user-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/teams/team-1/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "user-1" }),
      credentials: "include",
    });
    expect(result).toEqual(["user-1"]);
  });

  it("removes a member via the admin route", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ teamId: "team-1", userIds: [] }),
    });

    const result = await removeTeamMember("team-1", "user-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/teams/team-1/members/user-1",
      { method: "DELETE", credentials: "include" }
    );
    expect(result).toEqual([]);
  });
});
