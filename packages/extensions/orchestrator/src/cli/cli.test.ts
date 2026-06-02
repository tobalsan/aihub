import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { OrchestratorApiClient } from "./client.js";
import { initWorkflow, registerOrchestratorCommands } from "./index.js";

describe("orchestrator CLI client", () => {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;

  beforeEach(() => {
    calls.length = 0;
    vi.clearAllMocks();
  });

  it("maps verbs to /api/orchestrator routes", async () => {
    const client = new OrchestratorApiClient({ apiUrl: "http://localhost:4000" }, fetchImpl);

    await client.health();
    await client.projects();
    await client.runs(20, "ENG-1", "aihub");
    await client.workflow("aihub");
    await client.claim("ENG-1", "aihub");
    await client.release("ENG-1", "aihub");
    await client.interrupt("ENG-1", "aihub");
    await client.kill("ENG-1", "aihub");
    await client.export("aihub", "/tmp/snap");
    await client.tick("aihub");

    expect(calls).toEqual([
      "http://localhost:4000/api/orchestrator/health",
      "http://localhost:4000/api/orchestrator/projects",
      "http://localhost:4000/api/orchestrator/runs?limit=20&issue=ENG-1&project=aihub",
      "http://localhost:4000/api/orchestrator/workflow?project=aihub",
      "http://localhost:4000/api/orchestrator/issues/ENG-1/claim?project=aihub",
      "http://localhost:4000/api/orchestrator/runs/ENG-1/release?project=aihub",
      "http://localhost:4000/api/orchestrator/runs/ENG-1/interrupt?project=aihub",
      "http://localhost:4000/api/orchestrator/runs/ENG-1/kill?project=aihub",
      "http://localhost:4000/api/orchestrator/export?project=aihub&out=%2Ftmp%2Fsnap",
      "http://localhost:4000/api/orchestrator/tick?project=aihub",
    ]);
  });
});

describe("registerOrchestratorCommands", () => {
  it("registers required verbs", () => {
    const program = new Command();
    registerOrchestratorCommands(program.command("orchestrator"));

    const verbs = program.commands[0]?.commands.map((command) => command.name()).sort();
    expect(verbs).toEqual([
      "claim",
      "events",
      "export",
      "init-workflow",
      "interrupt",
      "kill",
      "logs",
      "projects",
      "release",
      "runs",
      "status",
      "tick",
      "workflow",
    ]);
  });

  it("creates project workflow templates explicitly", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aih-orch-cli-"));
    const project = path.join(root, "project");

    const workflowPath = await initWorkflow(project, { projectSlug: "aihub", profile: "worker" });
    const content = await fs.readFile(workflowPath, "utf8");

    expect(workflowPath).toBe(path.join(project, "WORKFLOW.md"));
    expect(content).toContain("project_slug: aihub");
    expect(content).toContain("api_key: $LINEAR_API_KEY");
    expect(content).toContain("profile: worker");
    await expect(initWorkflow(project, { projectSlug: "aihub" })).rejects.toThrow("WORKFLOW.md already exists");
  });
});
