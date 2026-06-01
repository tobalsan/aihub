import { beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { OrchestratorApiClient } from "./client.js";
import { registerOrchestratorCommands } from "./index.js";

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
    await client.runs(20, "ENG-1");
    await client.workflow("aihub");
    await client.claim("ENG-1");
    await client.release("ENG-1");
    await client.interrupt("ENG-1");
    await client.kill("ENG-1");
    await client.export("ENG", "/tmp/snap");
    await client.tick();

    expect(calls).toEqual([
      "http://localhost:4000/api/orchestrator/health",
      "http://localhost:4000/api/orchestrator/runs?limit=20&issue=ENG-1",
      "http://localhost:4000/api/orchestrator/workflow?repo=aihub",
      "http://localhost:4000/api/orchestrator/issues/ENG-1/claim",
      "http://localhost:4000/api/orchestrator/runs/ENG-1/release",
      "http://localhost:4000/api/orchestrator/runs/ENG-1/interrupt",
      "http://localhost:4000/api/orchestrator/runs/ENG-1/kill",
      "http://localhost:4000/api/orchestrator/export?team=ENG&out=%2Ftmp%2Fsnap",
      "http://localhost:4000/api/orchestrator/tick",
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
      "interrupt",
      "kill",
      "logs",
      "release",
      "runs",
      "status",
      "tick",
      "workflow",
    ]);
  });
});
