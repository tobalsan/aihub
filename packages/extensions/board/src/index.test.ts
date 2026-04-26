import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ExtensionContext } from "@aihub/shared";
import { boardExtension } from "./index.js";

function context(dataDir: string): ExtensionContext {
  return {
    getConfig: () => ({ agents: [], extensions: { board: {} } }),
    getDataDir: () => dataDir,
    getAgent: () => undefined,
    getAgents: () => [],
    isAgentActive: () => false,
    isAgentStreaming: () => false,
    resolveWorkspaceDir: () => "",
    runAgent: async () => ({
      payloads: [],
      meta: { durationMs: 0, sessionId: "test" },
    }),
    getSubagentTemplates: () => [],
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

describe("board extension system prompt contribution", () => {
  it("contributes scratchpad tool guidance through the extension hook", async () => {
    const contribution = boardExtension.getSystemPromptContributions?.({
      id: "lead",
      name: "Lead",
      workspace: "/tmp/aihub-board-test",
      sdk: "pi",
      model: { model: "test" },
      queueMode: "queue",
    });
    const resolved = await Promise.resolve(contribution);
    const text = Array.isArray(resolved) ? resolved.join("\n") : resolved ?? "";

    expect(text).toContain("Board scratchpad tools");
    expect(text).toContain("scratchpad_read");
    expect(text).toContain("scratchpad_write");
  });

  it("contributes scratchpad tools through the extension hook", async () => {
    const tools = await boardExtension.getAgentTools?.({
      id: "lead",
      name: "Lead",
      workspace: "/tmp/aihub-board-test",
      sdk: "pi",
      model: { model: "test" },
      queueMode: "queue",
    });

    expect(tools?.map((tool) => tool.name)).toEqual([
      "scratchpad.read",
      "scratchpad.write",
      "scratchpad.read_lines",
      "scratchpad.insert_lines",
      "scratchpad.replace_lines",
      "scratchpad.delete_lines",
    ]);
    expect(tools?.[0]?.parameters).toMatchObject({ type: "object" });
  });

  it("edits scratchpad lines without replacing the whole file", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aihub-board-"));
    try {
      await boardExtension.start(context(tmpDir));
      const tools = await boardExtension.getAgentTools?.({
        id: "lead",
        name: "Lead",
        workspace: "/tmp/aihub-board-test",
        sdk: "pi",
        model: { model: "test" },
        queueMode: "queue",
      });
      const byName = new Map(tools?.map((tool) => [tool.name, tool]));

      await byName.get("scratchpad.write")?.execute(
        { content: "one\ntwo\nthree\n" },
        { agent: {} as never }
      );
      const read = (await byName.get("scratchpad.read_lines")?.execute(
        {},
        { agent: {} as never }
      )) as { updatedAt: string; lines: Array<{ line: number; text: string }> };
      expect(read.lines).toEqual([
        { line: 1, text: "one" },
        { line: 2, text: "two" },
        { line: 3, text: "three" },
      ]);

      await byName.get("scratchpad.replace_lines")?.execute(
        {
          startLine: 2,
          endLine: 2,
          content: "TWO",
          expectedContent: "two",
          expectedUpdatedAt: read.updatedAt,
        },
        { agent: {} as never }
      );
      await byName.get("scratchpad.insert_lines")?.execute(
        { afterLine: 3, content: "four" },
        { agent: {} as never }
      );
      await byName.get("scratchpad.delete_lines")?.execute(
        { startLine: 1, endLine: 1, expectedContent: "one" },
        { agent: {} as never }
      );

      const final = (await byName.get("scratchpad.read")?.execute(
        {},
        { agent: {} as never }
      )) as { content: string };
      expect(final.content).toBe("TWO\nthree\nfour\n");
    } finally {
      await boardExtension.stop();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
