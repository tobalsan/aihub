import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchActivity, fetchAgentStatuses, fetchBoardActivity } from "./client";

type FetchResponse = {
  ok: boolean;
  json: () => Promise<unknown>;
};

describe("api client (activity/status)", () => {
  const fetchMock = vi.fn<() => Promise<FetchResponse>>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches activity feed", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ events: [{ id: "1", type: "agent_message" }] }),
    });

    const res = await fetchActivity();

    expect(fetchMock).toHaveBeenCalledWith("/api/activity?offset=0&limit=20", {
      credentials: "include",
    });
    expect(res.events.length).toBe(1);
  });

  it("fetches board activity (cross-project)", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ id: "a1", type: "project_status" }] }),
    });

    const res = await fetchBoardActivity();

    expect(fetchMock).toHaveBeenCalledWith("/api/board/activity", {
      credentials: "include",
    });
    expect(res.items.length).toBe(1);
  });

  it("fetches board activity per-project", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] }),
    });

    await fetchBoardActivity({ projectId: "PRO-123", limit: 10 });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/board/activity?projectId=PRO-123&limit=10",
      { credentials: "include" }
    );
  });

  it("fetches agent statuses", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ statuses: { cto: "streaming" } }),
    });

    const res = await fetchAgentStatuses();

    expect(fetchMock).toHaveBeenCalledWith("/api/agents/status", {
      credentials: "include",
    });
    expect(res.statuses.cto).toBe("streaming");
  });
});
