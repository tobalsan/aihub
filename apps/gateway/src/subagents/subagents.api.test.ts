import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import os from "node:os";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

describe("subagents API", () => {
  let tmpDir: string;
  let projectsRoot: string;
  let api: { request: (input: RequestInfo, init?: RequestInit) => Response | Promise<Response> };
  let prevHome: string | undefined;
  let prevUserProfile: string | undefined;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aihub-subagents-"));
    projectsRoot = path.join(tmpDir, "projects");

    prevHome = process.env.HOME;
    prevUserProfile = process.env.USERPROFILE;
    process.env.HOME = tmpDir;
    process.env.USERPROFILE = tmpDir;

    const configDir = path.join(tmpDir, ".aihub");
    await fs.mkdir(configDir, { recursive: true });
    const config = {
      agents: [
        {
          id: "test-agent",
          name: "Test Agent",
          workspace: "~/test",
          model: { provider: "anthropic", model: "claude-3-5-sonnet-20241022" },
        },
      ],
      projects: { root: projectsRoot },
    };
    await fs.writeFile(path.join(configDir, "aihub.json"), JSON.stringify(config, null, 2));

    vi.resetModules();
    const mod = await import("../server/api.js");
    api = mod.api;
  });

  afterAll(async () => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevUserProfile;

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("lists subagents and returns logs with cursor", async () => {
    const createRes = await Promise.resolve(api.request("/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Subagent Test" }),
    }));
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const repoDir = path.join(tmpDir, "repo");
    await fs.mkdir(repoDir, { recursive: true });
    await execFileAsync("git", ["init", "-b", "main"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: repoDir });
    await fs.writeFile(path.join(repoDir, "README.md"), "test\n");
    await execFileAsync("git", ["add", "."], { cwd: repoDir });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: repoDir });
    await execFileAsync("git", ["checkout", "-b", "dev"], { cwd: repoDir });

    const patchRes = await Promise.resolve(api.request(`/projects/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo: repoDir, domain: "coding" }),
    }));
    expect(patchRes.status).toBe(200);

    const workspaceDir = path.join(projectsRoot, ".workspaces", created.id, "alpha");
    await fs.mkdir(workspaceDir, { recursive: true });

    const now = new Date().toISOString();
    const state = {
      session_id: "s1",
      supervisor_pid: 0,
      started_at: now,
      last_error: "",
      cli: "codex",
      run_mode: "worktree",
      worktree_path: path.join(repoDir, "wt"),
      base_branch: "main",
    };
    await fs.writeFile(path.join(workspaceDir, "state.json"), JSON.stringify(state, null, 2));
    await fs.writeFile(path.join(workspaceDir, "progress.json"), JSON.stringify({ last_active: now, tool_calls: 2 }));
    await fs.writeFile(
      path.join(workspaceDir, "history.jsonl"),
      JSON.stringify({ ts: now, type: "worker.finished", data: { run_id: "r1", outcome: "replied" } }) + "\n"
    );
    await fs.writeFile(path.join(workspaceDir, "logs.jsonl"), "hello\n");

    const listRes = await Promise.resolve(api.request(`/projects/${created.id}/subagents`));
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    expect(list.items.length).toBe(1);
    expect(list.items[0].slug).toBe("alpha");
    expect(list.items[0].status).toBe("replied");
    expect(list.items[0].cli).toBe("codex");

    const logsRes = await Promise.resolve(api.request(`/projects/${created.id}/subagents/alpha/logs?since=0`));
    expect(logsRes.status).toBe(200);
    const logs = await logsRes.json();
    expect(logs.events.length).toBe(1);
    expect(logs.events[0].type).toBe("stdout");
    expect(logs.events[0].text).toContain("hello");

    const logsRes2 = await Promise.resolve(api.request(`/projects/${created.id}/subagents/alpha/logs?since=${logs.cursor}`));
    const logs2 = await logsRes2.json();
    expect(logs2.events.length).toBe(0);

    const branchesRes = await Promise.resolve(api.request(`/projects/${created.id}/branches`));
    expect(branchesRes.status).toBe(200);
    const branches = await branchesRes.json();
    expect(branches.branches).toContain("main");
    expect(branches.branches).toContain("dev");
  });

  it("lists all subagents across projects", async () => {
    const createRes = await Promise.resolve(api.request("/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Global Subagents" }),
    }));
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const workspaceDir = path.join(projectsRoot, ".workspaces", created.id, "main");
    await fs.mkdir(workspaceDir, { recursive: true });

    const now = new Date().toISOString();
    await fs.writeFile(
      path.join(workspaceDir, "state.json"),
      JSON.stringify({ supervisor_pid: 0, last_error: "", cli: "codex" }, null, 2)
    );
    await fs.writeFile(
      path.join(workspaceDir, "progress.json"),
      JSON.stringify({ last_active: now }, null, 2)
    );
    await fs.writeFile(
      path.join(workspaceDir, "history.jsonl"),
      JSON.stringify({ ts: now, type: "worker.finished", data: { run_id: "r1", outcome: "replied" } }) + "\n"
    );

    const listRes = await Promise.resolve(api.request("/subagents"));
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    const match = list.items.find((item: { projectId: string; slug: string }) => item.projectId === created.id);
    expect(match?.slug).toBe("main");
  });

  it("spawns subagent via API and writes logs", async () => {
    const createRes = await Promise.resolve(api.request("/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Subagent Spawn" }),
    }));
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const repoDir = path.join(tmpDir, "repo-spawn");
    await fs.mkdir(repoDir, { recursive: true });
    await execFileAsync("git", ["init", "-b", "main"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: repoDir });
    await fs.writeFile(path.join(repoDir, "README.md"), "test\n");
    await execFileAsync("git", ["add", "."], { cwd: repoDir });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: repoDir });

    const patchRes = await Promise.resolve(api.request(`/projects/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo: repoDir, domain: "coding" }),
    }));
    expect(patchRes.status).toBe(200);

    const binDir = path.join(tmpDir, "bin");
    await fs.mkdir(binDir, { recursive: true });
    const codexPath = path.join(binDir, "codex");
    const script = [
      "#!/bin/sh",
      "echo '{\"type\":\"thread.started\",\"thread_id\":\"s1\"}'",
      "echo \"$@\"",
      "echo '{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"ok\"}}'",
    ].join("\n");
    await fs.writeFile(codexPath, script, { mode: 0o755 });
    const prevPath = process.env.PATH;
    process.env.PATH = `${binDir}:${prevPath ?? ""}`;

    const spawnRes = await Promise.resolve(api.request(`/projects/${created.id}/subagents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: "alpha",
        cli: "codex",
        prompt: "hi",
        mode: "main-run",
      }),
    }));
    expect(spawnRes.status).toBe(201);

    const workDir = path.join(projectsRoot, ".workspaces", created.id, "alpha");
    const historyPath = path.join(workDir, "history.jsonl");
    const logsPath = path.join(workDir, "logs.jsonl");

    const start = Date.now();
    while (Date.now() - start < 2000) {
      try {
        const history = await fs.readFile(historyPath, "utf8");
        if (history.includes("\"worker.finished\"")) break;
      } catch {
        // wait
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const logs = await fs.readFile(logsPath, "utf8");
    expect(logs).toContain("thread.started");
    expect(logs).toContain("Let's tackle the following project:");

    const state = JSON.parse(await fs.readFile(path.join(workDir, "state.json"), "utf8"));
    expect(state.session_id).toBe("s1");

    process.env.PATH = prevPath;
  });

  it("interrupts a running subagent", async () => {
    const createRes = await Promise.resolve(api.request("/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Subagent Interrupt" }),
    }));
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const repoDir = path.join(tmpDir, "repo-interrupt");
    await fs.mkdir(repoDir, { recursive: true });
    await execFileAsync("git", ["init", "-b", "main"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: repoDir });
    await fs.writeFile(path.join(repoDir, "README.md"), "test\n");
    await execFileAsync("git", ["add", "."], { cwd: repoDir });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: repoDir });

    const patchRes = await Promise.resolve(api.request(`/projects/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo: repoDir, domain: "coding" }),
    }));
    expect(patchRes.status).toBe(200);

    const binDir = path.join(tmpDir, "bin-interrupt");
    await fs.mkdir(binDir, { recursive: true });
    const codexPath = path.join(binDir, "codex");
    const script = [
      "#!/bin/sh",
      "echo '{\"type\":\"thread.started\",\"thread_id\":\"s2\"}'",
      "sleep 5",
    ].join("\n");
    await fs.writeFile(codexPath, script, { mode: 0o755 });
    const prevPath = process.env.PATH;
    process.env.PATH = `${binDir}:${prevPath ?? ""}`;

    const spawnRes = await Promise.resolve(api.request(`/projects/${created.id}/subagents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: "beta",
        cli: "codex",
        prompt: "hi",
        mode: "main-run",
      }),
    }));
    expect(spawnRes.status).toBe(201);

    const interruptRes = await Promise.resolve(
      api.request(`/projects/${created.id}/subagents/beta/interrupt`, { method: "POST" })
    );
    expect(interruptRes.status).toBe(200);

    const workDir = path.join(projectsRoot, ".workspaces", created.id, "beta");
    const historyPath = path.join(workDir, "history.jsonl");
    const start = Date.now();
    while (Date.now() - start < 2000) {
      try {
        const history = await fs.readFile(historyPath, "utf8");
        if (history.includes("\"worker.interrupt\"")) break;
      } catch {
        // wait
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const history = await fs.readFile(historyPath, "utf8");
    expect(history).toContain("\"worker.interrupt\"");

    process.env.PATH = prevPath;
  });

  it("resumes when slug exists and resume is true", async () => {
    const createRes = await Promise.resolve(api.request("/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Subagent Resume" }),
    }));
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const repoDir = path.join(tmpDir, "repo-resume");
    await fs.mkdir(repoDir, { recursive: true });
    await execFileAsync("git", ["init", "-b", "main"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: repoDir });
    await fs.writeFile(path.join(repoDir, "README.md"), "test\n");
    await execFileAsync("git", ["add", "."], { cwd: repoDir });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: repoDir });

    const patchRes = await Promise.resolve(api.request(`/projects/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo: repoDir, domain: "coding" }),
    }));
    expect(patchRes.status).toBe(200);

    const binDir = path.join(tmpDir, "bin-resume");
    await fs.mkdir(binDir, { recursive: true });
    const codexPath = path.join(binDir, "codex");
    const script = [
      "#!/bin/sh",
      "echo '{\"type\":\"thread.started\",\"thread_id\":\"s1\"}'",
      "echo \"$@\"",
    ].join("\n");
    await fs.writeFile(codexPath, script, { mode: 0o755 });
    const prevPath = process.env.PATH;
    process.env.PATH = `${binDir}:${prevPath ?? ""}`;

    const spawnRes = await Promise.resolve(api.request(`/projects/${created.id}/subagents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: "gamma",
        cli: "codex",
        prompt: "hi",
        mode: "main-run",
      }),
    }));
    expect(spawnRes.status).toBe(201);

    const workDir = path.join(projectsRoot, ".workspaces", created.id, "gamma");
    const statePath = path.join(workDir, "state.json");
    const waitStart = Date.now();
    while (Date.now() - waitStart < 2000) {
      try {
        const state = JSON.parse(await fs.readFile(statePath, "utf8"));
        if (state.session_id === "s1") break;
      } catch {
        // wait
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const spawnRes2 = await Promise.resolve(api.request(`/projects/${created.id}/subagents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: "gamma",
        cli: "codex",
        prompt: "follow up",
        mode: "main-run",
        resume: true,
      }),
    }));
    expect(spawnRes2.status).toBe(201);

    const logsPath = path.join(workDir, "logs.jsonl");
    const start = Date.now();
    while (Date.now() - start < 2000) {
      const logs = await fs.readFile(logsPath, "utf8");
      if (logs.includes("resume s1")) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const logs = await fs.readFile(logsPath, "utf8");
    expect(logs).toContain("resume s1");

    process.env.PATH = prevPath;
  });

  it("creates worktree when mode is worktree", async () => {
    const createRes = await Promise.resolve(api.request("/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Subagent Worktree" }),
    }));
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const repoDir = path.join(tmpDir, "repo-worktree");
    await fs.mkdir(repoDir, { recursive: true });
    await execFileAsync("git", ["init", "-b", "main"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: repoDir });
    await fs.writeFile(path.join(repoDir, "README.md"), "test\n");
    await execFileAsync("git", ["add", "."], { cwd: repoDir });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: repoDir });

    const patchRes = await Promise.resolve(api.request(`/projects/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo: repoDir, domain: "coding" }),
    }));
    expect(patchRes.status).toBe(200);

    const binDir = path.join(tmpDir, "bin-worktree");
    await fs.mkdir(binDir, { recursive: true });
    const codexPath = path.join(binDir, "codex");
    const script = [
      "#!/bin/sh",
      "echo '{\"type\":\"thread.started\",\"thread_id\":\"s1\"}'",
    ].join("\n");
    await fs.writeFile(codexPath, script, { mode: 0o755 });
    const prevPath = process.env.PATH;
    process.env.PATH = `${binDir}:${prevPath ?? ""}`;

    const spawnRes = await Promise.resolve(api.request(`/projects/${created.id}/subagents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: "delta",
        cli: "codex",
        prompt: "hi",
        mode: "worktree",
        baseBranch: "main",
      }),
    }));
    expect(spawnRes.status).toBe(201);

    const workDir = path.join(projectsRoot, ".workspaces", created.id, "delta");
    const gitPath = path.join(workDir, ".git");
    const start = Date.now();
    while (Date.now() - start < 2000) {
      try {
        await fs.stat(gitPath);
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    await expect(fs.stat(gitPath)).resolves.toBeDefined();

    process.env.PATH = prevPath;
  });

  it("kills worktree subagent and removes branch", async () => {
    const createRes = await Promise.resolve(api.request("/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Subagent Kill Worktree" }),
    }));
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const repoDir = path.join(tmpDir, "repo-kill-worktree");
    await fs.mkdir(repoDir, { recursive: true });
    await execFileAsync("git", ["init", "-b", "main"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: repoDir });
    await fs.writeFile(path.join(repoDir, "README.md"), "test\n");
    await execFileAsync("git", ["add", "."], { cwd: repoDir });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: repoDir });

    const patchRes = await Promise.resolve(api.request(`/projects/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo: repoDir, domain: "coding" }),
    }));
    expect(patchRes.status).toBe(200);

    const workspacesRoot = path.join(projectsRoot, ".workspaces", created.id);
    await fs.mkdir(workspacesRoot, { recursive: true });
    const workspaceDir = path.join(workspacesRoot, "omega");
    const branch = `${created.id}/omega`;
    await execFileAsync("git", ["-C", repoDir, "worktree", "add", "-b", branch, workspaceDir, "main"]);

    const now = new Date().toISOString();
    const state = {
      session_id: "s1",
      supervisor_pid: 0,
      started_at: now,
      last_error: "",
      cli: "codex",
      run_mode: "worktree",
      worktree_path: workspaceDir,
      base_branch: "main",
    };
    await fs.writeFile(path.join(workspaceDir, "state.json"), JSON.stringify(state, null, 2));

    const killRes = await Promise.resolve(
      api.request(`/projects/${created.id}/subagents/omega/kill`, { method: "POST" })
    );
    expect(killRes.status).toBe(200);

    await expect(fs.stat(workspaceDir)).rejects.toThrow();
    const branchRes = await execFileAsync("git", ["-C", repoDir, "branch", "--list", branch]);
    expect(branchRes.stdout.trim()).toBe("");
  });

  it("kills main-run subagent by removing workspace", async () => {
    const createRes = await Promise.resolve(api.request("/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Subagent Kill Main Run" }),
    }));
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const workspaceDir = path.join(projectsRoot, ".workspaces", created.id, "eta");
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.writeFile(
      path.join(workspaceDir, "state.json"),
      JSON.stringify({ supervisor_pid: 0, run_mode: "main-run" }, null, 2)
    );

    const killRes = await Promise.resolve(
      api.request(`/projects/${created.id}/subagents/eta/kill`, { method: "POST" })
    );
    expect(killRes.status).toBe(200);
    await expect(fs.stat(workspaceDir)).rejects.toThrow();
  });

  it("returns error when subagent missing on kill", async () => {
    const createRes = await Promise.resolve(api.request("/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Subagent Kill Missing" }),
    }));
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const killRes = await Promise.resolve(
      api.request(`/projects/${created.id}/subagents/missing/kill`, { method: "POST" })
    );
    expect(killRes.status).toBe(404);
    const body = await killRes.json();
    expect(body.error).toBe("Subagent not found: missing");
  });

  it("SIGTERMs running subagent before cleanup", async () => {
    const createRes = await Promise.resolve(api.request("/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Subagent Kill Running" }),
    }));
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const workspaceDir = path.join(projectsRoot, ".workspaces", created.id, "theta");
    await fs.mkdir(workspaceDir, { recursive: true });
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    expect(child.pid).toBeDefined();
    const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.on("exit", (code, signal) => resolve({ code, signal }));
    });
    await fs.writeFile(
      path.join(workspaceDir, "state.json"),
      JSON.stringify({ supervisor_pid: child.pid, run_mode: "main-run" }, null, 2)
    );

    const killRes = await Promise.resolve(
      api.request(`/projects/${created.id}/subagents/theta/kill`, { method: "POST" })
    );
    expect(killRes.status).toBe(200);

    const exitResult = await Promise.race([
      exitPromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
    ]);
    if (exitResult === null) {
      child.kill("SIGKILL");
    }
    expect(exitResult).not.toBeNull();
  });

  it("resolves cli from common install locations", async () => {
    const createRes = await Promise.resolve(api.request("/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Subagent Resolve" }),
    }));
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const repoDir = path.join(tmpDir, "repo-resolve");
    await fs.mkdir(repoDir, { recursive: true });
    await execFileAsync("git", ["init", "-b", "main"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: repoDir });
    await fs.writeFile(path.join(repoDir, "README.md"), "test\n");
    await execFileAsync("git", ["add", "."], { cwd: repoDir });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: repoDir });

    const patchRes = await Promise.resolve(api.request(`/projects/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo: repoDir, domain: "coding" }),
    }));
    expect(patchRes.status).toBe(200);

    const claudeDir = path.join(tmpDir, ".claude", "local");
    await fs.mkdir(claudeDir, { recursive: true });
    const claudePath = path.join(claudeDir, "claude");
    const script = [
      "#!/bin/sh",
      "echo '{\"type\":\"thread.started\",\"thread_id\":\"s1\"}'",
    ].join("\n");
    await fs.writeFile(claudePath, script, { mode: 0o755 });

    const prevPath = process.env.PATH;
    process.env.PATH = "";

    const spawnRes = await Promise.resolve(api.request(`/projects/${created.id}/subagents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: "epsilon",
        cli: "claude",
        prompt: "hi",
        mode: "main-run",
      }),
    }));
    expect(spawnRes.status).toBe(201);

    process.env.PATH = prevPath;
  });

  it("returns agent statuses", async () => {
    const res = await Promise.resolve(api.request("/agents/status"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.statuses["test-agent"]).toBe("idle");
  });

  it("returns activity feed", async () => {
    const res = await Promise.resolve(api.request("/activity"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.events)).toBe(true);
  });
});
