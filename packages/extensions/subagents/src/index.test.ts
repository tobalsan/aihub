import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { ExtensionContext, GatewayConfig } from "@aihub/shared";
import { subagentsExtension } from "./index.js";

function context(config: GatewayConfig): ExtensionContext {
  return {
    getConfig: () => config,
    getDataDir: () => "/tmp/aihub-subagents-test",
    getAgent: () => undefined,
    getAgents: () => [],
    isAgentActive: () => false,
    isAgentStreaming: () => false,
    resolveWorkspaceDir: () => "",
    runAgent: async () => ({
      payloads: [],
      meta: { durationMs: 0, sessionId: "test" },
    }),
    getSubagentTemplates: () => config.subagents ?? [],
    resolveSessionId: async () => undefined,
    getSessionEntry: async () => undefined,
    clearSessionEntry: async () => undefined,
    restoreSessionUpdatedAt: () => undefined,
    deleteSession: () => undefined,
    invalidateHistoryCache: async () => undefined,
    getSessionHistory: async () => [],
    subscribe: () => () => undefined,
    emit: () => undefined,
    logger: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  };
}

describe("subagents extension profile resolution", () => {
  it("contributes subagent command guidance to the system prompt", async () => {
    const contribution = subagentsExtension.getSystemPromptContributions?.({
      id: "lead",
      name: "Lead",
      workspace: "/tmp/aihub-subagents-test",
      sdk: "pi",
      model: { model: "test" },
      queueMode: "queue",
    });
    const resolved = await Promise.resolve(contribution);
    const text = Array.isArray(resolved) ? resolved.join("\n") : resolved ?? "";

    expect(text).toContain("aihub subagents start");
    expect(text).toContain("aihub subagents list");
    expect(text).toContain("aihub subagents interrupt|archive");
  });

  it("uses top-level subagent cli templates as profiles", async () => {
    const app = new Hono();
    await subagentsExtension.start(
      context({
        agents: [],
        sessions: { idleMinutes: 360 },
        subagents: [
          {
            name: "Worker",
            cli: "codex",
            model: "gpt-5.3-codex",
            reasoning: "medium",
            type: "worker",
            runMode: "worktree",
          },
        ],
      })
    );
    subagentsExtension.registerRoutes(app);

    const res = await app.request("/subagents", {
      method: "POST",
      body: JSON.stringify({
        profile: "Worker",
      }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "cwd, prompt, and label are required",
    });
    await subagentsExtension.stop();
  });
});
