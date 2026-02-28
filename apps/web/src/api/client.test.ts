import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchProjectBranches,
  fetchProjectChanges,
  commitProjectChanges,
  fetchAllSubagents,
  fetchSubagents,
  fetchSubagentLogs,
  createProjectFromConversation,
  postConversationMessage,
  spawnSubagent,
  spawnRalphLoop,
  interruptSubagent,
  archiveSubagent,
  unarchiveSubagent,
} from "./client";

type FetchResponse = {
  ok: boolean;
  json: () => Promise<unknown>;
};

describe("api client (projects/subagents)", () => {
  const fetchMock = vi.fn<() => Promise<FetchResponse>>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches subagents list", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ slug: "main", status: "running" }] }),
    });

    const res = await fetchSubagents("PRO-1");

    expect(fetchMock).toHaveBeenCalledWith("/api/projects/PRO-1/subagents");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.items[0]?.slug).toBe("main");
    }
  });

  it("fetches subagents list with archived", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [{ slug: "main", status: "running", archived: true }],
      }),
    });

    const res = await fetchSubagents("PRO-1", true);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/PRO-1/subagents?includeArchived=true"
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.items[0]?.archived).toBe(true);
    }
  });

  it("fetches all subagents", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [{ projectId: "PRO-1", slug: "main", status: "idle" }],
      }),
    });

    const res = await fetchAllSubagents();

    expect(fetchMock).toHaveBeenCalledWith("/api/subagents");
    expect(res.items[0]?.projectId).toBe("PRO-1");
  });

  it("fetches subagent logs", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        cursor: 10,
        events: [{ type: "stdout", text: "hi" }],
      }),
    });

    const res = await fetchSubagentLogs("PRO-1", "main", 5);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/PRO-1/subagents/main/logs?since=5"
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.cursor).toBe(10);
      expect(res.data.events[0]?.type).toBe("stdout");
    }
  });

  it("fetches project branches", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ branches: ["main", "dev"] }),
    });

    const res = await fetchProjectBranches("PRO-9");

    expect(fetchMock).toHaveBeenCalledWith("/api/projects/PRO-9/branches");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.branches).toContain("main");
    }
  });

  it("fetches project changes", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        branch: "feature/x",
        baseBranch: "main",
        files: [{ path: "src/a.ts", status: "modified", staged: false }],
        diff: "diff --git a/src/a.ts b/src/a.ts",
        stats: { filesChanged: 1, insertions: 2, deletions: 1 },
      }),
    });

    const res = await fetchProjectChanges("PRO-9");

    expect(fetchMock).toHaveBeenCalledWith("/api/projects/PRO-9/changes");
    expect(res.branch).toBe("feature/x");
    expect(res.stats.filesChanged).toBe(1);
  });

  it("commits project changes", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, sha: "abc123", message: "test commit" }),
    });

    const res = await commitProjectChanges("PRO-9", "test commit");

    expect(fetchMock).toHaveBeenCalledWith("/api/projects/PRO-9/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "test commit" }),
    });
    expect(res.ok).toBe(true);
    expect(res.sha).toBe("abc123");
  });

  it("creates project from conversation", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "PRO-7",
        title: "Routing",
        path: "PRO-7_routing",
      }),
    });

    const res = await createProjectFromConversation("conv-1", {
      title: "Routing",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/conversations/conv-1/projects",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Routing" }),
      }
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.id).toBe("PRO-7");
    }
  });

  it("posts conversation message", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ mentions: ["codex"] }),
    });

    const res = await postConversationMessage("conv-1", {
      message: "Ping @codex",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/conversations/conv-1/messages",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Ping @codex" }),
      }
    );
    expect(res.mentions).toEqual(["codex"]);
  });

  it("spawns subagent", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ slug: "alpha" }),
    });

    const res = await spawnSubagent("PRO-2", {
      slug: "alpha",
      cli: "claude",
      prompt: "hello",
      mode: "worktree",
      baseBranch: "main",
      resume: true,
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/projects/PRO-2/subagents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: "alpha",
        cli: "claude",
        prompt: "hello",
        mode: "worktree",
        baseBranch: "main",
        resume: true,
      }),
    });
    expect(res.ok).toBe(true);
  });

  it("interrupts subagent", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ slug: "main" }),
    });

    const res = await interruptSubagent("PRO-3", "main");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/PRO-3/subagents/main/interrupt",
      {
        method: "POST",
      }
    );
    expect(res.ok).toBe(true);
  });

  it("spawns ralph loop", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ slug: "ralph-1" }),
    });

    const res = await spawnRalphLoop("PRO-2", {
      cli: "codex",
      iterations: 20,
      promptFile: "/tmp/prompt.md",
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/projects/PRO-2/ralph-loop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cli: "codex",
        iterations: 20,
        promptFile: "/tmp/prompt.md",
      }),
    });
    expect(res.ok).toBe(true);
  });

  it("archives subagent", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ slug: "main", archived: true }),
    });

    const res = await archiveSubagent("PRO-3", "main");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/PRO-3/subagents/main/archive",
      {
        method: "POST",
      }
    );
    expect(res.ok).toBe(true);
  });

  it("unarchives subagent", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ slug: "main", archived: false }),
    });

    const res = await unarchiveSubagent("PRO-3", "main");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects/PRO-3/subagents/main/unarchive",
      {
        method: "POST",
      }
    );
    expect(res.ok).toBe(true);
  });
});
