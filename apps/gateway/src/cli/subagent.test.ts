import { describe, it, expect } from "vitest";
import {
  createRuntimeSubagentHandlers,
  createSubagentHandlers,
} from "./subagent.js";

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
      projectId: "pro-1",
      slug: "alpha",
      cli: "codex",
      prompt: "hi",
      mode: "main-run",
    });

    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe(
      "http://localhost:4000/api/projects/PRO-1/subagents"
    );
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
      return new Response(JSON.stringify({ cursor: 10, events: [] }), {
        status: 200,
      });
    };

    const handlers = createSubagentHandlers({
      baseUrl: "http://localhost:4000",
      fetchImpl,
    });

    await handlers.logs({ projectId: "pro-2", slug: "beta", since: 123 });
    expect(calls[0].url).toBe(
      "http://localhost:4000/api/projects/PRO-2/subagents/beta/logs?since=123"
    );
  });

  it("kill posts to kill endpoint", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ slug: "gamma" }), { status: 200 });
    };

    const handlers = createSubagentHandlers({
      baseUrl: "http://localhost:4000",
      fetchImpl,
    });

    await handlers.kill({ projectId: "pro-3", slug: "gamma" });
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe(
      "http://localhost:4000/api/projects/PRO-3/subagents/gamma/kill"
    );
    expect(calls[0].init?.method).toBe("POST");
  });
});

describe("runtime subagents CLI handlers", () => {
  it("start posts to runtime endpoint", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: "sar_1" }), { status: 201 });
    };

    const handlers = createRuntimeSubagentHandlers({
      baseUrl: "http://localhost:4000",
      fetchImpl,
    });

    await handlers.start({
      cli: "codex",
      cwd: "/repo",
      prompt: "hi",
      label: "worker-a",
      parent: "agent-session:lead:main",
      model: "gpt-5.3-codex",
      reasoningEffort: "medium",
    });

    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe("http://localhost:4000/api/subagents");
    const body = JSON.parse(String(calls[0].init?.body ?? "{}"));
    expect(body).toMatchObject({
      cli: "codex",
      cwd: "/repo",
      prompt: "hi",
      label: "worker-a",
      parent: "agent-session:lead:main",
      model: "gpt-5.3-codex",
      reasoningEffort: "medium",
    });
  });

  it("list encodes runtime filters", async () => {
    const calls: Array<{ url: string }> = [];
    const fetchImpl = async (url: string) => {
      calls.push({ url });
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    };

    const handlers = createRuntimeSubagentHandlers({
      baseUrl: "http://localhost:4000",
      fetchImpl,
    });

    await handlers.list({
      parent: "board:main",
      status: "running",
      includeArchived: true,
    });

    expect(calls[0].url).toBe(
      "http://localhost:4000/api/subagents?parent=board%3Amain&status=running&includeArchived=true"
    );
  });
});
