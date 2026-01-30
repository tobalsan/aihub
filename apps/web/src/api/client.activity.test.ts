import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchActivity, fetchAgentStatuses } from "./client";

type FetchResponse = {
  ok: boolean;
  json: () => Promise<unknown>;
};

describe("api client (activity/status)", () => {
  const fetchMock = vi.fn<[], Promise<FetchResponse>>();

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

    expect(fetchMock).toHaveBeenCalledWith("/api/activity");
    expect(res.events.length).toBe(1);
  });

  it("fetches agent statuses", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ statuses: { cto: "streaming" } }),
    });

    const res = await fetchAgentStatuses();

    expect(fetchMock).toHaveBeenCalledWith("/api/agents/status");
    expect(res.statuses.cto).toBe("streaming");
  });
});
