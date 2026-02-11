import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import os from "node:os";
import type { RunAgentParams, RunAgentResult } from "../agents/runner.js";

describe("conversations API", () => {
  let tmpDir: string;
  let api: {
    request: (
      input: RequestInfo,
      init?: RequestInit
    ) => Response | Promise<Response>;
  };
  let prevHome: string | undefined;
  let prevUserProfile: string | undefined;
  const conversationId = "2026-02-10_agent-routing-ideas";
  const runAgentMock = vi.fn<
    (params: RunAgentParams) => Promise<RunAgentResult>
  >();

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aihub-conversations-"));

    prevHome = process.env.HOME;
    prevUserProfile = process.env.USERPROFILE;
    process.env.HOME = tmpDir;
    process.env.USERPROFILE = tmpDir;

    const configDir = path.join(tmpDir, ".aihub");
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      path.join(configDir, "aihub.json"),
      JSON.stringify(
        {
          agents: [
            {
              id: "codex",
              name: "Codex",
              workspace: "~/test",
              model: {
                provider: "anthropic",
                model: "claude-3-5-sonnet-20241022",
              },
            },
            {
              id: "claude",
              name: "Claude",
              workspace: "~/test",
              model: {
                provider: "anthropic",
                model: "claude-3-5-sonnet-20241022",
              },
            },
            {
              id: "gemini",
              name: "Gemini",
              workspace: "~/test",
              model: {
                provider: "google",
                model: "gemini-2.0-flash",
              },
            },
            {
              id: "cloud",
              name: "Cloud",
              workspace: "~/test",
              sdk: "openclaw",
              openclaw: { token: "test-token" },
            },
          ],
          projects: { root: path.join(tmpDir, "projects") },
        },
        null,
        2
      ),
      "utf8"
    );

    const conversationDir = path.join(
      tmpDir,
      "projects",
      ".conversations",
      conversationId
    );
    await fs.mkdir(conversationDir, { recursive: true });
    await fs.writeFile(
      path.join(conversationDir, "THREAD.md"),
      `---
title: "Agent Routing Ideas"
date: "2026-02-10"
participants:
  - User
  - Codex
source: Discord
tags:
  - agents
  - orchestration
---

# Agent Routing Ideas

**User** (09:11):
Can we route @codex and @claude from one thread?

**Codex** (09:12):
Yes, route by mention, then append each response to THREAD.md.
`,
      "utf8"
    );
    await fs.writeFile(
      path.join(conversationDir, "notes.txt"),
      "attachment-content",
      "utf8"
    );

    vi.resetModules();
    runAgentMock.mockReset();
    runAgentMock.mockImplementation(async (params) => {
      const text =
        params.agentId === "cloud"
          ? "Cloud routed via openclaw."
          : `${params.agentId} reply`;
      return {
        payloads: [{ text }],
        meta: {
          durationMs: 1,
          sessionId: `${params.agentId}-session`,
        },
      };
    });
    vi.doMock("../agents/index.js", async () => {
      const actual = await vi.importActual<
        typeof import("../agents/index.js")
      >("../agents/index.js");
      return {
        ...actual,
        runAgent: runAgentMock,
      };
    });
    const mod = await import("../server/api.js");
    api = mod.api;
  });

  afterAll(async () => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevUserProfile;

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("lists, filters, fetches detail, and serves attachments", async () => {
    const listRes = await Promise.resolve(api.request("/conversations"));
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    expect(list.length).toBe(1);
    expect(list[0]?.id).toBe(conversationId);
    expect(list[0]?.source).toBe("Discord");
    expect(list[0]?.participants).toEqual(["User", "Codex"]);
    expect(list[0]?.tags).toEqual(["agents", "orchestration"]);
    expect(list[0]?.attachments).toContain("notes.txt");

    const queryRes = await Promise.resolve(
      api.request("/conversations?q=routing&source=discord&tag=agents&participant=codex")
    );
    expect(queryRes.status).toBe(200);
    const queryList = await queryRes.json();
    expect(queryList.length).toBe(1);
    expect(queryList[0]?.id).toBe(conversationId);

    const detailRes = await Promise.resolve(
      api.request(`/conversations/${conversationId}`)
    );
    expect(detailRes.status).toBe(200);
    const detail = await detailRes.json();
    expect(detail.id).toBe(conversationId);
    expect(detail.messages.length).toBe(2);
    expect(detail.messages[0]?.speaker).toBe("User");
    expect(detail.messages[1]?.speaker).toBe("Codex");
    expect(detail.content).toContain("route by mention");

    const attachmentRes = await Promise.resolve(
      api.request(`/conversations/${conversationId}/attachments/notes.txt`)
    );
    expect(attachmentRes.status).toBe(200);
    const attachmentContent = await attachmentRes.text();
    expect(attachmentContent).toBe("attachment-content");
  });

  it("returns 404 when conversation not found", async () => {
    const detailRes = await Promise.resolve(
      api.request("/conversations/2026-02-10_missing-thread")
    );
    expect(detailRes.status).toBe(404);
  });

  it("appends user message when posting conversation message without mentions", async () => {
    const postRes = await Promise.resolve(
      api.request(`/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "plain update, no mentions" }),
      })
    );

    expect(postRes.status).toBe(200);
    const payload = await postRes.json();
    expect(payload.mentions).toEqual([]);
    expect(payload.dispatches).toEqual([]);
    expect(payload.ui).toEqual({
      shouldRefresh: true,
      isThinking: false,
      pendingMentions: [],
    });
    expect(runAgentMock).not.toHaveBeenCalled();
    const lastMessage =
      payload.conversation.messages[payload.conversation.messages.length - 1];
    expect(lastMessage?.speaker).toBe("User");
    expect(lastMessage?.body).toContain(
      "plain update, no mentions"
    );
  });

  it("dispatches @codex and @cloud mentions and appends replies", async () => {
    const postRes = await Promise.resolve(
      api.request(`/conversations/${conversationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Need checks from @codex and @cloud" }),
      })
    );

    expect(postRes.status).toBe(200);
    const payload = await postRes.json();
    expect(payload.mentions).toEqual(["codex", "cloud"]);
    expect(payload.dispatches).toHaveLength(2);
    expect(payload.dispatches[0]).toMatchObject({
      mention: "codex",
      status: "ok",
      agentId: "codex",
      replies: ["codex reply"],
    });
    expect(payload.dispatches[1]).toMatchObject({
      mention: "cloud",
      status: "ok",
      agentId: "cloud",
      sdk: "openclaw",
      replies: ["Cloud routed via openclaw."],
    });
    expect(runAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "codex",
        message: expect.stringContaining("Latest user message:\nNeed checks from @codex and @cloud"),
        sessionKey: `conversation:${conversationId}:codex`,
      })
    );
    expect(runAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "cloud",
        message: expect.stringContaining("Conversation thread context:"),
        sessionKey: `conversation:${conversationId}:cloud`,
      })
    );

    const detailRes = await Promise.resolve(
      api.request(`/conversations/${conversationId}`)
    );
    expect(detailRes.status).toBe(200);
    const detail = await detailRes.json();
    const speakers = detail.messages.map((m: { speaker: string }) => m.speaker);
    expect(speakers).toContain("User");
    expect(speakers).toContain("Codex");
    expect(speakers).toContain("Cloud");
    expect(detail.content).toContain("Need checks from @codex and @cloud");
    expect(detail.content).toContain("codex reply");
    expect(detail.content).toContain("Cloud routed via openclaw.");
  });

  it("creates project from conversation with specs and thread comment", async () => {
    const createRes = await Promise.resolve(
      api.request(`/conversations/${conversationId}/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
    );

    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.id).toMatch(/^PRO-\d+$/);
    expect(created.frontmatter.status).toBe("shaping");

    const projectDir = path.join(tmpDir, "projects", created.path);
    const specs = await fs.readFile(path.join(projectDir, "SPECS.md"), "utf8");
    expect(specs).toContain("## Source conversation");
    expect(specs).toContain(`- id: ${conversationId}`);
    expect(specs).toContain("Can we route @codex and @claude");

    const thread = await fs.readFile(path.join(projectDir, "THREAD.md"), "utf8");
    expect(thread).toContain(`Created from conversation ${conversationId}`);
  });
});
