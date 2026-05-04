import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { ExtensionContext } from "@aihub/shared";
import { boardExtension } from "./index.js";

function context(
  dataDir: string,
  contentRoot?: string,
  projectsConfig?: {
    legacyRoot?: string;
    canonicalRoot?: string;
    worktreeDir?: string;
  }
): ExtensionContext {
  return {
    getConfig: () => ({
      agents: [],
      projects: projectsConfig?.legacyRoot
        ? { root: projectsConfig.legacyRoot }
        : undefined,
      extensions: {
        board: contentRoot ? { contentRoot } : {},
        projects: projectsConfig?.canonicalRoot
          ? {
              root: projectsConfig.canonicalRoot,
              worktreeDir: projectsConfig.worktreeDir,
            }
          : undefined,
      },
    }),
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

async function buildApp(
  dataDir: string,
  projectsConfig: {
    legacyRoot?: string;
    canonicalRoot?: string;
    worktreeDir?: string;
  }
): Promise<Hono> {
  const app = new Hono().basePath("/api");
  boardExtension.registerRoutes(app);
  await boardExtension.start(context(dataDir, undefined, projectsConfig));
  return app;
}

function writeProject(root: string, id: string, title: string): void {
  const dir = path.join(root, `${id}_test`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "README.md"),
    `---\nid: "${id}"\ntitle: "${title}"\nstatus: "active"\ncreated: "2026-01-01T00:00:00.000Z"\n---\n# ${title}\n`,
    "utf-8"
  );
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

  it("uses extensions.projects.root before deprecated projects.root", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aihub-board-roots-"));
    const legacyRoot = path.join(dataDir, "legacy-projects");
    const canonicalRoot = path.join(dataDir, "canonical-projects");
    try {
      writeProject(legacyRoot, "PRO-401", "Legacy Project");
      writeProject(canonicalRoot, "PRO-402", "Canonical Project");

      const app = await buildApp(dataDir, { legacyRoot, canonicalRoot });
      const res = await app.request("/api/board/projects");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: Array<{ id: string }> };
      const ids = body.items.map((item) => item.id);
      expect(ids).toContain("PRO-402");
      expect(ids).not.toContain("PRO-401");
    } finally {
      await boardExtension.stop();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("uses extensions.projects.root for board areas", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aihub-board-areas-"));
    const legacyRoot = path.join(dataDir, "legacy-projects");
    const canonicalRoot = path.join(dataDir, "canonical-projects");
    try {
      fs.mkdirSync(path.join(legacyRoot, ".areas"), { recursive: true });
      fs.writeFileSync(
        path.join(legacyRoot, ".areas", "legacy.yaml"),
        "id: legacy\ntitle: Legacy\ncolor: '#999999'\n",
        "utf-8"
      );
      fs.mkdirSync(path.join(canonicalRoot, ".areas"), { recursive: true });
      fs.writeFileSync(
        path.join(canonicalRoot, ".areas", "canonical.yaml"),
        "id: canonical\ntitle: Canonical\ncolor: '#336699'\n",
        "utf-8"
      );

      const app = await buildApp(dataDir, { legacyRoot, canonicalRoot });
      const res = await app.request("/api/board/areas");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: Array<{ id: string }> };
      expect(body.items.map((item) => item.id)).toEqual(["canonical"]);
    } finally {
      await boardExtension.stop();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("stores user content at AIHUB_HOME by default and supports contentRoot override", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aihub-board-home-"));
    const customDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "aihub-board-custom-")
    );
    try {
      await boardExtension.start(context(dataDir));
      const defaultTools = await boardExtension.getAgentTools?.({
        id: "lead",
        name: "Lead",
        workspace: "/tmp/aihub-board-test",
        sdk: "pi",
        model: { model: "test" },
        queueMode: "queue",
      });
      await defaultTools
        ?.find((tool) => tool.name === "scratchpad.write")
        ?.execute({ content: "home" }, { agent: {} as never });
      expect(fs.existsSync(path.join(dataDir, "SCRATCHPAD.md"))).toBe(true);
      expect(
        fs.existsSync(path.join(dataDir, "extensions", "board", "SCRATCHPAD.md"))
      ).toBe(false);
      await boardExtension.stop();

      await boardExtension.start(context(dataDir, customDir));
      const customTools = await boardExtension.getAgentTools?.({
        id: "lead",
        name: "Lead",
        workspace: "/tmp/aihub-board-test",
        sdk: "pi",
        model: { model: "test" },
        queueMode: "queue",
      });
      await customTools
        ?.find((tool) => tool.name === "scratchpad.write")
        ?.execute({ content: "custom" }, { agent: {} as never });
      expect(fs.existsSync(path.join(customDir, "SCRATCHPAD.md"))).toBe(true);
    } finally {
      await boardExtension.stop();
      fs.rmSync(dataDir, { recursive: true, force: true });
      fs.rmSync(customDir, { recursive: true, force: true });
    }
  });
});
