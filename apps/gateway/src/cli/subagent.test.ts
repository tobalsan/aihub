import { describe, it, expect } from "vitest";
import { createSubagentHandlers } from "./subagent.js";

describe("subagent CLI handlers", () => {
  it("spawn posts to subagent endpoint", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ slug: "alpha" }), { status: 201 });
    };

    const handlers = createSubagentHandlers({
      baseUrl: "http://localhost:4000",
      fetchImpl,
    });

    await handlers.spawn({
      projectId: "PRO-1",
      slug: "alpha",
      cli: "codex",
      prompt: "hi",
      mode: "main-run",
    });

    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe("http://localhost:4000/api/projects/PRO-1/subagents");
    const body = JSON.parse(String(calls[0].init?.body ?? "{}"));
    expect(body.slug).toBe("alpha");
    expect(body.cli).toBe("codex");
    expect(body.prompt).toBe("hi");
    expect(body.mode).toBe("main-run");
  });

  it("logs requests include cursor", async () => {
    const calls: Array<{ url: string }> = [];
    const fetchImpl = async (url: string) => {
      calls.push({ url });
      return new Response(JSON.stringify({ cursor: 10, events: [] }), { status: 200 });
    };

    const handlers = createSubagentHandlers({
      baseUrl: "http://localhost:4000",
      fetchImpl,
    });

    await handlers.logs({ projectId: "PRO-2", slug: "beta", since: 123 });
    expect(calls[0].url).toBe("http://localhost:4000/api/projects/PRO-2/subagents/beta/logs?since=123");
  });
});
