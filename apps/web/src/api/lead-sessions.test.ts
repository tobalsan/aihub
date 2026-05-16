import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLeadSession,
  deleteLeadSession,
  fetchLeadSessionTranscript,
  fetchLeadSessions,
  patchLeadSession,
  sendLeadSessionMessage,
} from "./lead-sessions";

type FetchResponse = {
  ok: boolean;
  json: () => Promise<unknown>;
};

const fetchMock = vi.fn<() => Promise<FetchResponse>>();

function expectFetchCall(url: string, init?: RequestInit) {
  expect(fetchMock).toHaveBeenCalledWith(url, {
    ...init,
    credentials: "include",
  });
}

describe("lead session api", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches scoped lead sessions using the real items response shape", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ id: "lead:PRO-1:abc" }] }),
    });

    const res = await fetchLeadSessions("PRO-1", {
      archived: true,
      sliceId: "PRO-1-S01",
    });

    expectFetchCall(
      "/api/projects/PRO-1/lead-sessions?archived=true&sliceId=PRO-1-S01"
    );
    expect(res.items[0]?.id).toBe("lead:PRO-1:abc");
  });

  it("creates, patches, deletes, fetches transcript, and sends messages", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "lead:PRO-1:abc", messages: [] }),
    });

    await createLeadSession("PRO-1", { agentId: "pom", sliceId: "PRO-1-S01" });
    expectFetchCall("/api/projects/PRO-1/lead-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: "pom", sliceId: "PRO-1-S01" }),
    });

    await patchLeadSession("lead:PRO-1:abc", { title: "New title" });
    expectFetchCall("/api/lead-sessions/lead%3APRO-1%3Aabc", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New title" }),
    });

    await fetchLeadSessionTranscript("lead:PRO-1:abc");
    expectFetchCall("/api/lead-sessions/lead%3APRO-1%3Aabc/transcript");

    await sendLeadSessionMessage("lead:PRO-1:abc", {
      content: "hi",
      agentId: "pom",
      files: [{ path: "media/1", mimeType: "text/plain", filename: "a.txt" }],
    });
    expectFetchCall("/api/lead-sessions/lead%3APRO-1%3Aabc/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "hi",
        agentId: "pom",
        files: [{ path: "media/1", mimeType: "text/plain", filename: "a.txt" }],
      }),
    });

    await deleteLeadSession("lead:PRO-1:abc");
    expectFetchCall("/api/lead-sessions/lead%3APRO-1%3Aabc", {
      method: "DELETE",
    });
  });
});
