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

  it("move command passes agent", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ id: "PRO-1", frontmatter: { status: "done" } }), {
        status: 200,
      });
    });

    vi.stubGlobal("fetch", fetchImpl);
    program.exitOverride();

    await program.parseAsync([
      "node",
      "projects",
      "move",
      "PRO-1",
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
});
