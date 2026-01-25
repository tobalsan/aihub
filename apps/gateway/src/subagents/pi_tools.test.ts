import { describe, it, expect, vi } from "vitest";
import { createPiSubagentTools } from "./pi_tools.js";
import type { SubagentToolHandlers } from "./tool_handlers.js";

describe("pi subagent tools", () => {
  it("subagent.spawn calls handler and returns content", async () => {
    const handlers: SubagentToolHandlers = {
      spawn: vi.fn().mockResolvedValue({ ok: true, data: { slug: "alpha" } }),
      status: vi.fn(),
      logs: vi.fn(),
      interrupt: vi.fn(),
    };
    const tools = createPiSubagentTools(handlers);
    const tool = tools.find((t) => t.name === "subagent.spawn");
    expect(tool).toBeDefined();

    const result = await tool!.execute("call_1", {
      projectId: "PRO-1",
      slug: "alpha",
      cli: "codex",
      prompt: "hi",
    } as any);

    expect(handlers.spawn).toHaveBeenCalledWith({
      projectId: "PRO-1",
      slug: "alpha",
      cli: "codex",
      prompt: "hi",
      mode: undefined,
      baseBranch: undefined,
      resume: undefined,
    });
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("\"slug\":\"alpha\"");
  });

  it("subagent.spawn throws on error", async () => {
    const handlers: SubagentToolHandlers = {
      spawn: vi.fn().mockResolvedValue({ ok: false, error: "nope" }),
      status: vi.fn(),
      logs: vi.fn(),
      interrupt: vi.fn(),
    };
    const tools = createPiSubagentTools(handlers);
    const tool = tools.find((t) => t.name === "subagent.spawn");
    await expect(
      tool!.execute("call_2", { projectId: "PRO-1", slug: "alpha", cli: "codex", prompt: "hi" } as any)
    ).rejects.toThrow("nope");
  });

  it("subagent.logs forwards since", async () => {
    const handlers: SubagentToolHandlers = {
      spawn: vi.fn(),
      status: vi.fn(),
      logs: vi.fn().mockResolvedValue({ ok: true, data: { cursor: 10, events: [] } }),
      interrupt: vi.fn(),
    };
    const tools = createPiSubagentTools(handlers);
    const tool = tools.find((t) => t.name === "subagent.logs");
    expect(tool).toBeDefined();

    const result = await tool!.execute("call_3", {
      projectId: "PRO-2",
      slug: "beta",
      since: 123,
    } as any);

    expect(handlers.logs).toHaveBeenCalledWith({
      projectId: "PRO-2",
      slug: "beta",
      since: 123,
    });
    expect(result.content[0].text).toContain("\"cursor\":10");
  });
});
