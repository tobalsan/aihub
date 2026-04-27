import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentConfig, GatewayConfig } from "@aihub/shared";
import { projectsExtension } from "./index.js";
import { clearProjectsContext, setProjectsContext } from "./context.js";

let tmpDir: string | undefined;

afterEach(async () => {
  clearProjectsContext();
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  }
});

describe("projects extension agent tools", () => {
  it("registers project tools through the extension model", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aihub-project-tools-"));
    const projectsRoot = path.join(tmpDir, "projects");
    const agent = {
      id: "agent-1",
      name: "Agent One",
      workspace: tmpDir,
      model: { model: "test" },
    } as AgentConfig;
    const config = {
      agents: [agent],
      extensions: { projects: { enabled: true, root: projectsRoot } },
      projects: { root: projectsRoot },
    } as unknown as GatewayConfig;
    setProjectsContext({
      getConfig: () => config,
      getDataDir: () => path.join(tmpDir, ".aihub"),
      getAgents: () => [agent],
      getAgent: () => agent,
      isAgentActive: () => true,
      isAgentStreaming: () => false,
      resolveWorkspaceDir: () => tmpDir,
      runAgent: async () => ({ ok: true as const, data: {} }),
      getSubagentTemplates: () => [],
      resolveSessionId: async () => undefined,
      getSessionEntry: async () => undefined,
      clearSessionEntry: async () => undefined,
      restoreSessionUpdatedAt: () => {},
      deleteSession: () => {},
      invalidateHistoryCache: async () => {},
      getSessionHistory: async () => [],
      subscribe: () => () => {},
      emit: () => {},
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    } as never);

    const tools = await projectsExtension.getAgentTools?.(agent, { config });

    expect(tools?.map((tool) => tool.name)).toEqual([
      "project.create",
      "project.get",
      "project.update",
      "project.comment",
    ]);

    const createTool = tools?.find((tool) => tool.name === "project.create");
    const getTool = tools?.find((tool) => tool.name === "project.get");
    const updateTool = tools?.find((tool) => tool.name === "project.update");

    const created = await createTool?.execute(
      { title: "Extension Tool Project", specs: "Initial specs" },
      { agent, config }
    );
    expect(created).toMatchObject({
      id: "PRO-1",
      title: "Extension Tool Project",
    });

    const fetched = await getTool?.execute(
      { projectId: "PRO-1" },
      { agent, config }
    );
    expect(fetched).toMatchObject({
      id: "PRO-1",
      title: "Extension Tool Project",
    });

    const updated = await updateTool?.execute(
      { projectId: "PRO-1", updates: { title: "Updated Extension Project" } },
      { agent, config }
    );
    expect(updated).toMatchObject({
      id: "PRO-1",
      title: "Updated Extension Project",
    });
  });
});
