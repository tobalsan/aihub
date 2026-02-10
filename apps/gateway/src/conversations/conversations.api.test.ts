import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import os from "node:os";

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
              id: "test-agent",
              name: "Test Agent",
              workspace: "~/test",
              model: {
                provider: "anthropic",
                model: "claude-3-5-sonnet-20241022",
              },
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
