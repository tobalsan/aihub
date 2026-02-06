import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { program } from "./projects.js";

describe("projects CLI", () => {
  let prevApiUrl: string | undefined;

  beforeEach(() => {
    prevApiUrl = process.env.AIHUB_API_URL;
    process.env.AIHUB_API_URL = "http://localhost:4000";
  });

  afterEach(() => {
    if (prevApiUrl === undefined) delete process.env.AIHUB_API_URL;
    else process.env.AIHUB_API_URL = prevApiUrl;
    vi.unstubAllGlobals();
  });

  it("create command passes description when provided", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ id: "PRO-1", frontmatter: {} }), {
        status: 200,
      });
    });

    vi.stubGlobal("fetch", fetchImpl);
    program.exitOverride();

    await program.parseAsync([
      "node",
      "projects",
      "create",
      "-t",
      "Title",
      "Desc",
      "--json",
    ]);

    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe("http://localhost:4000/api/projects");
    const body = JSON.parse(String(calls[0].init?.body ?? "{}"));
    expect(body).toEqual({ title: "Title", description: "Desc" });
  });

  it("create command omits description when absent", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ id: "PRO-2", frontmatter: {} }), {
        status: 200,
      });
    });

    vi.stubGlobal("fetch", fetchImpl);
    program.exitOverride();

    await program.parseAsync([
      "node",
      "projects",
      "create",
      "-t",
      "Title",
      "--json",
    ]);

    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe("http://localhost:4000/api/projects");
    const body = JSON.parse(String(calls[0].init?.body ?? "{}"));
    expect(body).toEqual({ title: "Title" });
  });

  it("move command passes agent", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(
        JSON.stringify({ id: "PRO-1", frontmatter: { status: "done" } }),
        {
          status: 200,
        }
      );
    });

    vi.stubGlobal("fetch", fetchImpl);
    program.exitOverride();

    await program.parseAsync([
      "node",
      "projects",
      "move",
      "pro-1",
      "done",
      "--agent",
      "Sage",
      "--json",
    ]);

    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe("http://localhost:4000/api/projects/PRO-1");
    const body = JSON.parse(String(calls[0].init?.body ?? "{}"));
    expect(body).toEqual({ status: "done", agent: "Sage" });
  });

  it("start command defaults to codex worktree when flags omitted", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(
        JSON.stringify({
          ok: true,
          type: "cli",
          slug: "main",
          runMode: "worktree",
        }),
        {
          status: 200,
        }
      );
    });

    vi.stubGlobal("fetch", fetchImpl);
    program.exitOverride();

    await program.parseAsync(["node", "projects", "start", "PRO-10", "--json"]);

    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe(
      "http://localhost:4000/api/projects/PRO-10/start"
    );
    const body = JSON.parse(String(calls[0].init?.body ?? "{}"));
    expect(body).toEqual({
      runAgent: "cli:codex",
      runMode: "worktree",
    });
  });

  it("start command passes per-run flags", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(
        JSON.stringify({
          ok: true,
          type: "cli",
          slug: "my-run",
          runMode: "worktree",
        }),
        {
          status: 200,
        }
      );
    });

    vi.stubGlobal("fetch", fetchImpl);
    program.exitOverride();

    await program.parseAsync([
      "node",
      "projects",
      "start",
      "pro-9",
      "--agent",
      "codex",
      "--mode",
      "worktree",
      "--branch",
      "main",
      "--slug",
      "my-run",
      "--json",
    ]);

    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe("http://localhost:4000/api/projects/PRO-9/start");
    const body = JSON.parse(String(calls[0].init?.body ?? "{}"));
    expect(body).toEqual({
      runAgent: "cli:codex",
      runMode: "worktree",
      baseBranch: "main",
      slug: "my-run",
    });
  });

  it("ralph command posts to ralph-loop endpoint", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ slug: "ralph-abc" }), {
        status: 201,
      });
    });

    vi.stubGlobal("fetch", fetchImpl);
    program.exitOverride();

    await program.parseAsync([
      "node",
      "projects",
      "ralph",
      "pro-75",
      "--cli",
      "claude",
      "--iterations",
      "12",
      "--prompt-file",
      "/tmp/prompt.md",
      "--json",
    ]);

    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe(
      "http://localhost:4000/api/projects/PRO-75/ralph-loop"
    );
    const body = JSON.parse(String(calls[0].init?.body ?? "{}"));
    expect(body).toEqual({
      cli: "claude",
      iterations: 12,
      promptFile: "/tmp/prompt.md",
    });
  });
});
