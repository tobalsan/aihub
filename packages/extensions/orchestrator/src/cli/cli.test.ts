import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { OrchestratorApiClient } from "./client.js";
import { initProject, initWorkflow, registerOrchestratorCommands, safeProjectName } from "./index.js";

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
      "init-project",
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
    expect(content).toContain("runner: claude");
    expect(content).toContain("profile: worker");
    expect(content).toContain("## DO THIS FIRST");
    expect(content).toContain("Fetch Linear issue {{issue.identifier}}.");
    expect(content).toContain("Do not perform task work before this claim step.");
    expect(content).toContain("## Workspace Rule");
    expect(content).toContain("## Linear Workflow");
    expect(content).toContain("move the issue to `In Review`");
    expect(content).toContain("## Code Changes and Review Flow");
    expect(content).toContain("Create a worktree from the `main` branch");
    expect(content).toContain("Spawn a reviewer subagent");
    expect(content).toContain("## Golden Rule: Clarification Over Assumption");
    await expect(initWorkflow(project, { projectSlug: "aihub" })).rejects.toThrow("WORKFLOW.md already exists");
  });

  it("sanitizes project names for folder creation", () => {
    expect(safeProjectName("Foo Bar")).toBe("foo-bar");
    expect(safeProjectName("  Déjà Vu / 2026!  ")).toBe("deja-vu-2026");
    expect(() => safeProjectName("!!!")).toThrow("Project name must contain at least one letter or number");
  });

  it("creates Linear project, folder, workflow, and registers config", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aih-orch-project-"));
    const projectsRoot = path.join(root, "projects");
    const configPath = path.join(root, "aihub.json");
    await fs.writeFile(configPath, JSON.stringify({ extensions: { orchestrator: { projectsRoot, projects: [] } } }), "utf8");
    const linear = {
      findProjectByName: vi.fn(async () => undefined),
      inferProjectTeamIds: vi.fn(async () => ["team-1"]),
      createProject: vi.fn(async () => ({ id: "project-1", name: "Foo Bar", slugId: "foo-bar-linear" })),
    };

    const result = await initProject("Foo Bar", { profile: "reviewer", linearClient: linear as any, configPath });
    const workflow = await fs.readFile(result.workflowPath, "utf8");
    const config = JSON.parse(await fs.readFile(configPath, "utf8"));

    expect(result.projectPath).toBe(path.join(projectsRoot, "foo-bar"));
    expect(workflow).toContain("project_slug: foo-bar-linear");
    expect(workflow).toContain("runner: claude");
    expect(workflow).toContain("profile: reviewer");
    expect(workflow).toContain("## DO THIS FIRST");
    expect(workflow).toContain("## Code Changes and Review Flow");
    expect(workflow).toContain("## Golden Rule: Clarification Over Assumption");
    expect(config.extensions.orchestrator.projects).toEqual([path.join(projectsRoot, "foo-bar")]);
    expect(linear.createProject).toHaveBeenCalledWith({ name: "Foo Bar", teamIds: ["team-1"] });
  });

  it("defaults projectsRoot to ~/projects", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "aih-orch-home-"));
    const homedir = vi.spyOn(os, "homedir").mockReturnValue(home);
    const configPath = path.join(home, ".aihub", "aihub.json");
    const linear = {
      findProjectByName: vi.fn(async () => undefined),
      inferProjectTeamIds: vi.fn(async () => ["team-1"]),
      createProject: vi.fn(async () => ({ id: "project-1", name: "Default Root", slugId: "default-root" })),
    };
    try {
      const result = await initProject("Default Root", { linearClient: linear as any, configPath });
      expect(result.projectPath).toBe(path.join(home, "projects", "default-root"));
    } finally {
      homedir.mockRestore();
    }
  });

  it("fails before Linear creation when the folder already exists", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aih-orch-exists-"));
    const projectsRoot = path.join(root, "projects");
    const configPath = path.join(root, "aihub.json");
    await fs.mkdir(path.join(projectsRoot, "foo-bar"), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify({ extensions: { orchestrator: { projectsRoot } } }), "utf8");
    const linear = {
      findProjectByName: vi.fn(),
      inferProjectTeamIds: vi.fn(),
      createProject: vi.fn(),
    };

    await expect(initProject("Foo Bar", { linearClient: linear as any, configPath })).rejects.toThrow("Project folder already exists");
    expect(linear.findProjectByName).not.toHaveBeenCalled();
    expect(linear.createProject).not.toHaveBeenCalled();
  });

  it("fails before local scaffolding when Linear project already exists", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aih-orch-duplicate-"));
    const projectsRoot = path.join(root, "projects");
    const configPath = path.join(root, "aihub.json");
    await fs.writeFile(configPath, JSON.stringify({ extensions: { orchestrator: { projectsRoot } } }), "utf8");
    const linear = {
      findProjectByName: vi.fn(async () => ({ id: "project-1", name: "Foo Bar", slugId: "foo-bar" })),
      inferProjectTeamIds: vi.fn(),
      createProject: vi.fn(),
    };

    await expect(initProject("Foo Bar", { linearClient: linear as any, configPath })).rejects.toThrow("Linear project already exists");
    await expect(fs.access(path.join(projectsRoot, "foo-bar"))).rejects.toThrow();
    expect(linear.createProject).not.toHaveBeenCalled();
  });

  it("rolls back Linear project and local folder when registration fails after creation", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "aih-orch-rollback-"));
    const projectsRoot = path.join(root, "projects");
    const configPath = path.join(root, "aihub.json");
    await fs.writeFile(configPath, JSON.stringify({ extensions: { orchestrator: { projectsRoot, projects: [] } } }), "utf8");
    await fs.chmod(configPath, 0o444);
    const linear = {
      findProjectByName: vi.fn(async () => undefined),
      inferProjectTeamIds: vi.fn(async () => ["team-1"]),
      createProject: vi.fn(async () => ({ id: "project-1", name: "Foo Bar", slugId: "foo-bar" })),
      deleteProject: vi.fn(async () => undefined),
    };
    try {
      await expect(initProject("Foo Bar", { linearClient: linear as any, configPath })).rejects.toThrow();
      expect(linear.deleteProject).toHaveBeenCalledWith("project-1");
      await expect(fs.access(path.join(projectsRoot, "foo-bar"))).rejects.toThrow();
    } finally {
      await fs.chmod(configPath, 0o644).catch(() => undefined);
    }
  });
});
