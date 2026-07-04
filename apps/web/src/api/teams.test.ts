import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addTeamMember,
  assignPoolToTeam,
  fetchTeamAgents,
  fetchTeamMembers,
  reassignFork,
  removeTeamMember,
  unassignFork,
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

  it("lists a team's agents from the global route", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        teamId: "team-1",
        forks: [{ sourcePoolId: "scribe", forkAgentId: "fork__scribe" }],
      }),
    });

    const forks = await fetchTeamAgents("team-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/teams/team-1/agents", {
      credentials: "include",
    });
    expect(forks).toEqual([
      { sourcePoolId: "scribe", forkAgentId: "fork__scribe" },
    ]);
  });

  it("assigns a pool agent to a team via the admin route", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ fork: { sourcePoolId: "scribe", teamId: "team-1" } }),
    });

    await assignPoolToTeam("scribe", "team-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/forks/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ poolId: "scribe", teamId: "team-1" }),
      credentials: "include",
    });
  });

  it("reassigns a fork via the admin route", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ fork: { sourcePoolId: "scribe", teamId: "team-2" } }),
    });

    await reassignFork("scribe", "team-2");

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/forks/scribe/reassign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamId: "team-2" }),
      credentials: "include",
    });
  });

  it("unassigns a fork via the admin route", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ fork: { sourcePoolId: "scribe", teamId: null } }),
    });

    await unassignFork("scribe");

    expect(fetchMock).toHaveBeenCalledWith("/api/admin/forks/scribe/unassign", {
      method: "POST",
      credentials: "include",
    });
  });
});
