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
  let api: {
    request: (
      input: RequestInfo,
      init?: RequestInit
    ) => Response | Promise<Response>;
  };
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
    await fs.writeFile(
      path.join(configDir, "aihub.json"),
      JSON.stringify(config, null, 2)
    );

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

  const writeRalphScript = async (cli: "codex" | "claude", lines: string[]) => {
    const scriptDir = path.join(
      tmpDir,
      ".agents",
      "skills",
      "ralphup",
      "scripts"
    );
    await fs.mkdir(scriptDir, { recursive: true });
    const scriptPath = path.join(scriptDir, `ralph_${cli}.sh`);
    await fs.writeFile(scriptPath, lines.join("\n"), { mode: 0o755 });
  };

  const writeRalphTemplate = async (
    cli: "codex" | "claude",
    content: string
  ) => {
    const assetsDir = path.join(
      tmpDir,
      ".agents",
      "skills",
      "ralphup",
      "assets"
    );
    await fs.mkdir(assetsDir, { recursive: true });
    await fs.writeFile(
      path.join(assetsDir, `prompt.${cli}.template.md`),
      content
    );
  };

  it("lists subagents and returns logs with cursor", async () => {
    const createRes = await Promise.resolve(
      api.request("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Subagent Test" }),
      })
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const repoDir = path.join(tmpDir, "repo");
    await fs.mkdir(repoDir, { recursive: true });
    await execFileAsync("git", ["init", "-b", "main"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], {
      cwd: repoDir,
    });
    await execFileAsync("git", ["config", "user.name", "Test User"], {
      cwd: repoDir,
    });
    await fs.writeFile(path.join(repoDir, "README.md"), "test\n");
    await execFileAsync("git", ["add", "."], { cwd: repoDir });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: repoDir });
    await execFileAsync("git", ["checkout", "-b", "dev"], { cwd: repoDir });

    const patchRes = await Promise.resolve(
      api.request(`/projects/${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: repoDir, domain: "coding" }),
      })
    );
    expect(patchRes.status).toBe(200);

    const sessionDir = path.join(
      projectsRoot,
      created.path,
      "sessions",
      "alpha"
    );
    await fs.mkdir(sessionDir, { recursive: true });

    const now = new Date().toISOString();
    await fs.writeFile(
      path.join(sessionDir, "config.json"),
      JSON.stringify(
        {
          type: "ralph_loop",
          cli: "codex",
          runMode: "worktree",
          baseBranch: "main",
          iterations: 20,
          created: now,
        },
        null,
        2
      )
    );
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
    await fs.writeFile(
      path.join(sessionDir, "state.json"),
      JSON.stringify(state, null, 2)
    );
    await fs.writeFile(
      path.join(sessionDir, "progress.json"),
      JSON.stringify({ last_active: now, tool_calls: 2 })
    );
    await fs.writeFile(
      path.join(sessionDir, "history.jsonl"),
      JSON.stringify({
        ts: now,
        type: "worker.finished",
        data: { run_id: "r1", outcome: "replied" },
      }) + "\n"
    );
    await fs.writeFile(path.join(sessionDir, "logs.jsonl"), "hello\n");

    const listRes = await Promise.resolve(
      api.request(`/projects/${created.id}/subagents`)
    );
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    expect(list.items.length).toBe(1);
    expect(list.items[0].slug).toBe("alpha");
    expect(list.items[0].status).toBe("replied");
    expect(list.items[0].cli).toBe("codex");
    expect(list.items[0].type).toBe("ralph_loop");
    expect(list.items[0].iterations).toBe(20);

    const logsRes = await Promise.resolve(
      api.request(`/projects/${created.id}/subagents/alpha/logs?since=0`)
    );
    expect(logsRes.status).toBe(200);
    const logs = await logsRes.json();
    expect(logs.events.length).toBe(1);
    expect(logs.events[0].type).toBe("stdout");
    expect(logs.events[0].text).toContain("hello");

    const logsRes2 = await Promise.resolve(
      api.request(
        `/projects/${created.id}/subagents/alpha/logs?since=${logs.cursor}`
      )
    );
    const logs2 = await logsRes2.json();
    expect(logs2.events.length).toBe(0);

    const branchesRes = await Promise.resolve(
      api.request(`/projects/${created.id}/branches`)
    );
    expect(branchesRes.status).toBe(200);
    const branches = await branchesRes.json();
    expect(branches.branches).toContain("main");
    expect(branches.branches).toContain("dev");
  });

  it("migrates legacy sessions from workspaces", async () => {
    const createRes = await Promise.resolve(
      api.request("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Subagent Migrate" }),
      })
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const legacyRoot = path.join(projectsRoot, ".workspaces", created.id);
    const legacyDir = path.join(legacyRoot, "legacy");
    await fs.mkdir(legacyDir, { recursive: true });

    const now = new Date().toISOString();
    const state = {
      session_id: "s1",
      supervisor_pid: 0,
      started_at: now,
      last_error: "",
      cli: "claude",
      run_mode: "worktree",
      worktree_path: path.join(tmpDir, "wt-legacy"),
      base_branch: "dev",
    };
    await fs.writeFile(
      path.join(legacyDir, "state.json"),
      JSON.stringify(state, null, 2)
    );
    await fs.writeFile(
      path.join(legacyDir, "progress.json"),
      JSON.stringify({ last_active: now }, null, 2)
    );
    await fs.writeFile(
      path.join(legacyDir, "history.jsonl"),
      JSON.stringify({
        ts: now,
        type: "worker.finished",
        data: { run_id: "r1", outcome: "replied" },
      }) + "\n"
    );
    await fs.writeFile(path.join(legacyDir, "logs.jsonl"), "legacy\n");

    const listRes = await Promise.resolve(
      api.request(`/projects/${created.id}/subagents`)
    );
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    const migrated = list.items.find(
      (item: { slug: string }) => item.slug === "legacy"
    );
    expect(migrated?.cli).toBe("claude");
    expect(migrated?.runMode).toBe("worktree");

    const sessionDir = path.join(
      projectsRoot,
      created.path,
      "sessions",
      "legacy"
    );
    const config = JSON.parse(
      await fs.readFile(path.join(sessionDir, "config.json"), "utf8")
    );
    expect(config.cli).toBe("claude");
    expect(config.runMode).toBe("worktree");
    expect(config.baseBranch).toBe("dev");
    expect(config.created).toBe(now);

    await expect(fs.stat(legacyRoot)).rejects.toThrow();
  });

  it("archives subagent runs and filters list", async () => {
    const createRes = await Promise.resolve(
      api.request("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Subagent Archive" }),
      })
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const sessionDir = path.join(
      projectsRoot,
      created.path,
      "sessions",
      "alpha"
    );
    await fs.mkdir(sessionDir, { recursive: true });
    const now = new Date().toISOString();
    await fs.writeFile(
      path.join(sessionDir, "config.json"),
      JSON.stringify(
        {
          cli: "codex",
          runMode: "worktree",
          baseBranch: "main",
          created: now,
          archived: false,
        },
        null,
        2
      )
    );

    const archiveRes = await Promise.resolve(
      api.request(`/projects/${created.id}/subagents/alpha/archive`, {
        method: "POST",
      })
    );
    expect(archiveRes.status).toBe(200);
    const archived = await archiveRes.json();
    expect(archived.slug).toBe("alpha");
    expect(archived.archived).toBe(true);

    const config = JSON.parse(
      await fs.readFile(path.join(sessionDir, "config.json"), "utf8")
    );
    expect(config.archived).toBe(true);

    const listRes = await Promise.resolve(
      api.request(`/projects/${created.id}/subagents`)
    );
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    expect(list.items.length).toBe(0);

    const listArchivedRes = await Promise.resolve(
      api.request(`/projects/${created.id}/subagents?includeArchived=true`)
    );
    expect(listArchivedRes.status).toBe(200);
    const listArchived = await listArchivedRes.json();
    expect(listArchived.items.length).toBe(1);
    expect(listArchived.items[0].archived).toBe(true);

    const unarchiveRes = await Promise.resolve(
      api.request(`/projects/${created.id}/subagents/alpha/unarchive`, {
        method: "POST",
      })
    );
    expect(unarchiveRes.status).toBe(200);
    const unarchived = await unarchiveRes.json();
    expect(unarchived.archived).toBe(false);

    const listRes2 = await Promise.resolve(
      api.request(`/projects/${created.id}/subagents`)
    );
    const list2 = await listRes2.json();
    expect(list2.items.length).toBe(1);
    expect(list2.items[0].archived).toBe(false);
  });

  it("lists all subagents across projects", async () => {
    const createRes = await Promise.resolve(
      api.request("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Global Subagents" }),
      })
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const sessionDir = path.join(
      projectsRoot,
      created.path,
      "sessions",
      "main"
    );
    await fs.mkdir(sessionDir, { recursive: true });

    const now = new Date().toISOString();
    await fs.writeFile(
      path.join(sessionDir, "config.json"),
      JSON.stringify(
        { cli: "codex", runMode: "main-run", baseBranch: "main", created: now },
        null,
        2
      )
    );
    await fs.writeFile(
      path.join(sessionDir, "state.json"),
      JSON.stringify(
        { supervisor_pid: 0, last_error: "", cli: "codex" },
        null,
        2
      )
    );
    await fs.writeFile(
      path.join(sessionDir, "progress.json"),
      JSON.stringify({ last_active: now }, null, 2)
    );
    await fs.writeFile(
      path.join(sessionDir, "history.jsonl"),
      JSON.stringify({
        ts: now,
        type: "worker.finished",
        data: { run_id: "r1", outcome: "replied" },
      }) + "\n"
    );

    const listRes = await Promise.resolve(api.request("/subagents"));
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    const match = list.items.find(
      (item: { projectId: string; slug: string }) =>
        item.projectId === created.id
    );
    expect(match?.slug).toBe("main");
    expect(match?.type).toBe("subagent");
  });

  it("adds supervisor/worker grouping metadata for ralph runs", async () => {
    const createRes = await Promise.resolve(
      api.request("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Ralph Group Metadata" }),
      })
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const sharedWorktree = path.join(tmpDir, "shared-worktree");
    const now = new Date().toISOString();
    const projectSessions = path.join(projectsRoot, created.path, "sessions");
    const supervisorDir = path.join(projectSessions, "ralph-1");
    const workerDir = path.join(projectSessions, "worker-1");
    await fs.mkdir(supervisorDir, { recursive: true });
    await fs.mkdir(workerDir, { recursive: true });

    await fs.writeFile(
      path.join(supervisorDir, "config.json"),
      JSON.stringify(
        {
          type: "ralph_loop",
          cli: "codex",
          runMode: "worktree",
          created: now,
        },
        null,
        2
      )
    );
    await fs.writeFile(
      path.join(supervisorDir, "state.json"),
      JSON.stringify(
        {
          supervisor_pid: 0,
          last_error: "",
          cli: "codex",
          run_mode: "worktree",
          worktree_path: sharedWorktree,
        },
        null,
        2
      )
    );
    await fs.writeFile(
      path.join(supervisorDir, "progress.json"),
      JSON.stringify({ last_active: now }, null, 2)
    );
    await fs.writeFile(path.join(supervisorDir, "history.jsonl"), "");

    await fs.writeFile(
      path.join(workerDir, "config.json"),
      JSON.stringify(
        {
          type: "subagent",
          cli: "codex",
          runMode: "worktree",
          created: now,
        },
        null,
        2
      )
    );
    await fs.writeFile(
      path.join(workerDir, "state.json"),
      JSON.stringify(
        {
          supervisor_pid: 0,
          last_error: "",
          cli: "codex",
          run_mode: "worktree",
          worktree_path: sharedWorktree,
        },
        null,
        2
      )
    );
    await fs.writeFile(
      path.join(workerDir, "progress.json"),
      JSON.stringify({ last_active: now }, null, 2)
    );
    await fs.writeFile(path.join(workerDir, "history.jsonl"), "");

    const listRes = await Promise.resolve(
      api.request(`/projects/${created.id}/subagents?includeArchived=true`)
    );
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    const supervisor = list.items.find(
      (item: { slug: string }) => item.slug === "ralph-1"
    );
    const worker = list.items.find(
      (item: { slug: string }) => item.slug === "worker-1"
    );
    expect(supervisor?.role).toBe("supervisor");
    expect(worker?.role).toBe("worker");
    expect(worker?.parentSlug).toBe("ralph-1");
    expect(worker?.groupKey).toBe(supervisor?.groupKey);

    const globalRes = await Promise.resolve(api.request("/subagents"));
    expect(globalRes.status).toBe(200);
    const global = await globalRes.json();
    const globalWorker = global.items.find(
      (item: { projectId: string; slug: string }) =>
        item.projectId === created.id && item.slug === "worker-1"
    );
    expect(globalWorker?.role).toBe("worker");
  });

  it("spawns ralph loop via API and writes stdout/stderr logs", async () => {
    const createRes = await Promise.resolve(
      api.request("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Ralph Loop Spawn" }),
      })
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const repoDir = path.join(tmpDir, "repo-ralph");
    await fs.mkdir(repoDir, { recursive: true });
    await execFileAsync("git", ["init", "-b", "main"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], {
      cwd: repoDir,
    });
    await execFileAsync("git", ["config", "user.name", "Test User"], {
      cwd: repoDir,
    });
    await fs.writeFile(path.join(repoDir, "README.md"), "test\n");
    await execFileAsync("git", ["add", "."], { cwd: repoDir });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: repoDir });

    const patchRes = await Promise.resolve(
      api.request(`/projects/${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: repoDir, domain: "coding" }),
      })
    );
    expect(patchRes.status).toBe(200);

    const promptPath = path.join(projectsRoot, created.path, "prompt.md");
    await fs.writeFile(promptPath, "Do work.\n");

    await writeRalphScript("codex", [
      "#!/bin/sh",
      'echo "=== Ralph iteration 1/2 ==="',
      'echo "stdout line"',
      'echo "stderr line" 1>&2',
    ]);

    const prevHome2 = process.env.HOME;
    const prevUserProfile2 = process.env.USERPROFILE;
    process.env.HOME = tmpDir;
    process.env.USERPROFILE = tmpDir;

    const spawnRes = await Promise.resolve(
      api.request(`/projects/${created.id}/ralph-loop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cli: "codex",
          iterations: 2,
          promptFile: promptPath,
        }),
      })
    );
    expect(spawnRes.status).toBe(201);
    const spawned = await spawnRes.json();
    expect(typeof spawned.slug).toBe("string");

    const sessionDir = path.join(
      projectsRoot,
      created.path,
      "sessions",
      spawned.slug
    );
    const historyPath = path.join(sessionDir, "history.jsonl");
    const logsPath = path.join(sessionDir, "logs.jsonl");

    const start = Date.now();
    while (Date.now() - start < 3000) {
      try {
        const history = await fs.readFile(historyPath, "utf8");
        if (history.includes('"worker.finished"')) break;
      } catch {
        // wait
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const config = JSON.parse(
      await fs.readFile(path.join(sessionDir, "config.json"), "utf8")
    );
    expect(config.type).toBe("ralph_loop");
    expect(config.cli).toBe("codex");
    expect(config.iterations).toBe(2);
    expect(config.generatedPrompt).toBe(false);
    expect(config.promptTemplate).toBeUndefined();

    const logs = await fs.readFile(logsPath, "utf8");
    expect(logs).toContain('"type":"stdout"');
    expect(logs).toContain("Ralph iteration 1/2");
    expect(logs).toContain('"type":"stderr"');
    expect(logs).toContain("stderr line");

    if (prevHome2 === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome2;
    if (prevUserProfile2 === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevUserProfile2;
  });

  it("generates prompt from template when promptFile is omitted", async () => {
    const createRes = await Promise.resolve(
      api.request("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Ralph Loop Generate Prompt" }),
      })
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const repoDir = path.join(tmpDir, "repo-ralph-generate");
    await fs.mkdir(repoDir, { recursive: true });
    await execFileAsync("git", ["init", "-b", "main"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], {
      cwd: repoDir,
    });
    await execFileAsync("git", ["config", "user.name", "Test User"], {
      cwd: repoDir,
    });
    await fs.writeFile(path.join(repoDir, "README.md"), "test\n");
    await execFileAsync("git", ["add", "."], { cwd: repoDir });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: repoDir });

    const patchRes = await Promise.resolve(
      api.request(`/projects/${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: repoDir, domain: "coding" }),
      })
    );
    expect(patchRes.status).toBe(200);

    const projectDir = path.join(projectsRoot, created.path);
    await fs.writeFile(path.join(projectDir, "SCOPES.md"), "# Scope\n");
    await writeRalphScript("codex", ["#!/bin/sh", 'echo "template run"']);
    await writeRalphTemplate(
      "codex",
      [
        "Project: {{PROJECT_FILE}}",
        "Scopes: {{SCOPES_FILE}}",
        "Progress: {{PROGRESS_FILE}}",
        "Repo: {{SOURCE_DIR}}",
      ].join("\n")
    );

    const spawnRes = await Promise.resolve(
      api.request(`/projects/${created.id}/ralph-loop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cli: "codex",
          iterations: 2,
        }),
      })
    );
    expect(spawnRes.status).toBe(201);
    const spawned = await spawnRes.json();

    const generatedPromptPath = path.join(projectDir, "prompt.md");
    const generatedPrompt = await fs.readFile(generatedPromptPath, "utf8");
    expect(generatedPrompt).toContain(path.join(projectDir, "README.md"));
    expect(generatedPrompt).toContain(path.join(projectDir, "SCOPES.md"));
    expect(generatedPrompt).toContain(path.join(projectDir, "progress.md"));
    const workspaceDir = path.join(
      projectsRoot,
      ".workspaces",
      created.id,
      spawned.slug
    );
    expect(generatedPrompt).toContain(workspaceDir);

    const progressFilePath = path.join(projectDir, "progress.md");
    await expect(fs.stat(progressFilePath)).resolves.toBeDefined();

    const config = JSON.parse(
      await fs.readFile(
        path.join(projectDir, "sessions", spawned.slug, "config.json"),
        "utf8"
      )
    );
    expect(config.generatedPrompt).toBe(true);
    expect(config.promptTemplate).toContain("prompt.codex.template.md");
    expect(config.promptFile).toBe(generatedPromptPath);
  });

  it("returns error when explicit prompt file is missing", async () => {
    const createRes = await Promise.resolve(
      api.request("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Ralph Missing Prompt" }),
      })
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const repoDir = path.join(tmpDir, "repo-ralph-missing-prompt");
    await fs.mkdir(repoDir, { recursive: true });
    await execFileAsync("git", ["init", "-b", "main"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], {
      cwd: repoDir,
    });
    await execFileAsync("git", ["config", "user.name", "Test User"], {
      cwd: repoDir,
    });
    await fs.writeFile(path.join(repoDir, "README.md"), "test\n");
    await execFileAsync("git", ["add", "."], { cwd: repoDir });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: repoDir });

    const patchRes = await Promise.resolve(
      api.request(`/projects/${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: repoDir, domain: "coding" }),
      })
    );
    expect(patchRes.status).toBe(200);

    await writeRalphScript("codex", ["#!/bin/sh", "exit 0"]);
    const missingPrompt = path.join(projectsRoot, created.path, "missing.md");
    const spawnRes = await Promise.resolve(
      api.request(`/projects/${created.id}/ralph-loop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cli: "codex",
          iterations: 2,
          promptFile: missingPrompt,
        }),
      })
    );
    expect(spawnRes.status).toBe(400);
    const body = await spawnRes.json();
    expect(body.error).toContain("Prompt file not found");
  });

  it("returns error when SCOPES.md is missing in generation mode", async () => {
    const createRes = await Promise.resolve(
      api.request("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Ralph Missing Scopes" }),
      })
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const repoDir = path.join(tmpDir, "repo-ralph-missing-scopes");
    await fs.mkdir(repoDir, { recursive: true });
    await execFileAsync("git", ["init", "-b", "main"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], {
      cwd: repoDir,
    });
    await execFileAsync("git", ["config", "user.name", "Test User"], {
      cwd: repoDir,
    });
    await fs.writeFile(path.join(repoDir, "README.md"), "test\n");
    await execFileAsync("git", ["add", "."], { cwd: repoDir });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: repoDir });

    const patchRes = await Promise.resolve(
      api.request(`/projects/${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: repoDir, domain: "coding" }),
      })
    );
    expect(patchRes.status).toBe(200);

    await writeRalphScript("codex", ["#!/bin/sh", "exit 0"]);
    await writeRalphTemplate("codex", "Test {{SCOPES_FILE}}");

    const spawnRes = await Promise.resolve(
      api.request(`/projects/${created.id}/ralph-loop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cli: "codex",
          iterations: 2,
        }),
      })
    );
    expect(spawnRes.status).toBe(400);
    const body = await spawnRes.json();
    expect(body.error).toContain("SCOPES.md not found");
  });

  it("dispatches ralph_loop from /projects/:id/start when executionMode is set", async () => {
    const createRes = await Promise.resolve(
      api.request("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Ralph Start Dispatch",
          executionMode: "ralph_loop",
          status: "todo",
        }),
      })
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const repoDir = path.join(tmpDir, "repo-ralph-start");
    await fs.mkdir(repoDir, { recursive: true });
    await execFileAsync("git", ["init", "-b", "main"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], {
      cwd: repoDir,
    });
    await execFileAsync("git", ["config", "user.name", "Test User"], {
      cwd: repoDir,
    });
    await fs.writeFile(path.join(repoDir, "README.md"), "test\n");
    await execFileAsync("git", ["add", "."], { cwd: repoDir });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: repoDir });

    const patchRes = await Promise.resolve(
      api.request(`/projects/${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: repoDir, domain: "coding" }),
      })
    );
    expect(patchRes.status).toBe(200);

    const projectDir = path.join(projectsRoot, created.path);
    await fs.writeFile(path.join(projectDir, "SCOPES.md"), "# Scope\n");
    await writeRalphTemplate(
      "codex",
      "Project {{PROJECT_FILE}} Scope {{SCOPES_FILE}} Progress {{PROGRESS_FILE}} Repo {{SOURCE_DIR}}"
    );
    await writeRalphScript("codex", ["#!/bin/sh", 'echo "start loop"']);

    const prevHome2 = process.env.HOME;
    const prevUserProfile2 = process.env.USERPROFILE;
    process.env.HOME = tmpDir;
    process.env.USERPROFILE = tmpDir;

    const startRes = await Promise.resolve(
      api.request(`/projects/${created.id}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runAgent: "cli:codex" }),
      })
    );
    expect(startRes.status).toBe(200);
    const started = await startRes.json();
    expect(started.ok).toBe(true);
    expect(started.type).toBe("ralph_loop");
    expect(typeof started.slug).toBe("string");

    const sessionDir = path.join(
      projectsRoot,
      created.path,
      "sessions",
      started.slug
    );
    const config = JSON.parse(
      await fs.readFile(path.join(sessionDir, "config.json"), "utf8")
    );
    expect(config.type).toBe("ralph_loop");
    expect(config.cli).toBe("codex");
    expect(config.runMode).toBe("clone");
    expect(config.baseBranch).toBe("main");
    expect(config.iterations).toBe(20);
    expect(config.generatedPrompt).toBe(true);

    const projectRes = await Promise.resolve(
      api.request(`/projects/${created.id}`)
    );
    expect(projectRes.status).toBe(200);
    const project = await projectRes.json();
    expect(project.frontmatter.status).toBe("in_progress");

    if (prevHome2 === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome2;
    if (prevUserProfile2 === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevUserProfile2;
  });

  it("uses frontmatter runAgent but ignores frontmatter runMode for /projects/:id/start", async () => {
    const createRes = await Promise.resolve(
      api.request("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Start Frontmatter Fallback" }),
      })
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const repoDir = path.join(tmpDir, "repo-frontmatter-start");
    await fs.mkdir(repoDir, { recursive: true });
    await execFileAsync("git", ["init", "-b", "main"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], {
      cwd: repoDir,
    });
    await execFileAsync("git", ["config", "user.name", "Test User"], {
      cwd: repoDir,
    });
    await fs.writeFile(path.join(repoDir, "README.md"), "test\n");
    await execFileAsync("git", ["add", "."], { cwd: repoDir });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: repoDir });

    const patchRes = await Promise.resolve(
      api.request(`/projects/${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: repoDir, domain: "coding" }),
      })
    );
    expect(patchRes.status).toBe(200);

    const projectReadmePath = path.join(
      projectsRoot,
      created.path,
      "README.md"
    );
    const readme = await fs.readFile(projectReadmePath, "utf8");
    const updatedReadme = readme.replace(
      /^---\n/,
      "---\nrunAgent: cli:codex\nrunMode: main-run\n"
    );
    await fs.writeFile(projectReadmePath, updatedReadme);

    const binDir = path.join(tmpDir, "bin-frontmatter-start");
    await fs.mkdir(binDir, { recursive: true });
    const codexPath = path.join(binDir, "codex");
    const script = [
      "#!/bin/sh",
      'echo \'{"type":"thread.started","thread_id":"s-frontmatter"}\'',
      'echo \'{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}\'',
    ].join("\n");
    await fs.writeFile(codexPath, script, { mode: 0o755 });
    const prevPath = process.env.PATH;
    process.env.PATH = `${binDir}:${prevPath ?? ""}`;

    const startRes = await Promise.resolve(
      api.request(`/projects/${created.id}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
    );
    expect(startRes.status).toBe(200);
    const started = await startRes.json();
    expect(started.ok).toBe(true);
    expect(started.type).toBe("cli");
    expect(started.slug).toBe("start-frontmatter-fallback");
    expect(started.runMode).toBe("clone");

    const sessionDir = path.join(
      projectsRoot,
      created.path,
      "sessions",
      "start-frontmatter-fallback"
    );
    const start = Date.now();
    while (Date.now() - start < 2000) {
      try {
        await fs.access(path.join(sessionDir, "config.json"));
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    const config = JSON.parse(
      await fs.readFile(path.join(sessionDir, "config.json"), "utf8")
    );
    expect(config.cli).toBe("codex");
    expect(config.runMode).toBe("clone");

    process.env.PATH = prevPath;
  });

  it("spawns mode none without creating a workspace clone", async () => {
    const createRes = await Promise.resolve(
      api.request("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "No Workspace Spawn" }),
      })
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const binDir = path.join(tmpDir, "bin-mode-none");
    await fs.mkdir(binDir, { recursive: true });
    const codexPath = path.join(binDir, "codex");
    const script = [
      "#!/bin/sh",
      'echo \'{"type":"thread.started","thread_id":"s-none"}\'',
      'echo \'{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}\'',
    ].join("\n");
    await fs.writeFile(codexPath, script, { mode: 0o755 });
    const prevPath = process.env.PATH;
    process.env.PATH = `${binDir}:${prevPath ?? ""}`;

    const spawnRes = await Promise.resolve(
      api.request(`/projects/${created.id}/subagents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: "reviewer-none",
          cli: "codex",
          prompt: "review changes",
          mode: "none",
        }),
      })
    );
    expect(spawnRes.status).toBe(201);

    const projectDir = path.join(projectsRoot, created.path);
    const sessionDir = path.join(projectDir, "sessions", "reviewer-none");
    const state = JSON.parse(
      await fs.readFile(path.join(sessionDir, "state.json"), "utf8")
    );
    expect(state.run_mode).toBe("none");
    expect(state.worktree_path).toBe(projectDir);

    const workspaceDir = path.join(
      projectsRoot,
      ".workspaces",
      created.id,
      "reviewer-none"
    );
    await expect(fs.stat(workspaceDir)).rejects.toThrow();

    process.env.PATH = prevPath;
  });

  it("applies model/effort and name when spawning from /projects/:id/start", async () => {
    const createRes = await Promise.resolve(
      api.request("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Start With Options" }),
      })
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const repoDir = path.join(tmpDir, "repo-start-options");
    await fs.mkdir(repoDir, { recursive: true });
    await execFileAsync("git", ["init", "-b", "main"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], {
      cwd: repoDir,
    });
    await execFileAsync("git", ["config", "user.name", "Test User"], {
      cwd: repoDir,
    });
    await fs.writeFile(path.join(repoDir, "README.md"), "test\n");
    await execFileAsync("git", ["add", "."], { cwd: repoDir });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: repoDir });

    const patchRes = await Promise.resolve(
      api.request(`/projects/${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: repoDir, domain: "coding" }),
      })
    );
    expect(patchRes.status).toBe(200);

    const binDir = path.join(tmpDir, "bin-start-options");
    await fs.mkdir(binDir, { recursive: true });
    const codexPath = path.join(binDir, "codex");
    const script = [
      "#!/bin/sh",
      'echo "$@"',
      'echo \'{"type":"thread.started","thread_id":"s-start-options"}\'',
      'echo \'{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}\'',
    ].join("\n");
    await fs.writeFile(codexPath, script, { mode: 0o755 });
    const prevPath = process.env.PATH;
    process.env.PATH = `${binDir}:${prevPath ?? ""}`;

    const startRes = await Promise.resolve(
      api.request(`/projects/${created.id}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runAgent: "cli:codex",
          runMode: "main-run",
          name: "Worker A",
          model: "gpt-5.2",
          reasoningEffort: "low",
        }),
      })
    );
    expect(startRes.status).toBe(200);

    const sessionDir = path.join(
      projectsRoot,
      created.path,
      "sessions",
      "main"
    );
    const logsPath = path.join(sessionDir, "logs.jsonl");
    const start = Date.now();
    while (Date.now() - start < 2000) {
      try {
        const logs = await fs.readFile(logsPath, "utf8");
        if (logs.includes("thread.started")) break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const logs = await fs.readFile(logsPath, "utf8");
    expect(logs).toContain("-m gpt-5.2");
    expect(logs).toContain("-c reasoning_effort=low");

    const config = JSON.parse(
      await fs.readFile(path.join(sessionDir, "config.json"), "utf8")
    );
    expect(config.name).toBe("Worker A");
    expect(config.model).toBe("gpt-5.2");
    expect(config.reasoningEffort).toBe("low");
    const state = JSON.parse(
      await fs.readFile(path.join(sessionDir, "state.json"), "utf8")
    );
    expect(state.worktree_path).toContain(
      path.join(".workspaces", created.id, "_space")
    );
    await expect(
      fs.stat(path.join(projectsRoot, created.path, "space.json"))
    ).resolves.toBeDefined();

    process.env.PATH = prevPath;
  });

  it("spawns subagent via API and writes logs", async () => {
    const createRes = await Promise.resolve(
      api.request("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Subagent Spawn" }),
      })
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const repoDir = path.join(tmpDir, "repo-spawn");
    await fs.mkdir(repoDir, { recursive: true });
    await execFileAsync("git", ["init", "-b", "main"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], {
      cwd: repoDir,
    });
    await execFileAsync("git", ["config", "user.name", "Test User"], {
      cwd: repoDir,
    });
    await fs.writeFile(path.join(repoDir, "README.md"), "test\n");
    await execFileAsync("git", ["add", "."], { cwd: repoDir });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: repoDir });

    const patchRes = await Promise.resolve(
      api.request(`/projects/${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: repoDir, domain: "coding" }),
      })
    );
    expect(patchRes.status).toBe(200);

    const binDir = path.join(tmpDir, "bin");
    await fs.mkdir(binDir, { recursive: true });
    const codexPath = path.join(binDir, "codex");
    const script = [
      "#!/bin/sh",
      'echo \'{"type":"thread.started","thread_id":"s1"}\'',
      'echo "$@"',
      'echo \'{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}\'',
    ].join("\n");
    await fs.writeFile(codexPath, script, { mode: 0o755 });
    const prevPath = process.env.PATH;
    process.env.PATH = `${binDir}:${prevPath ?? ""}`;

    const spawnRes = await Promise.resolve(
      api.request(`/projects/${created.id}/subagents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: "alpha",
          cli: "codex",
          name: "Coordinator",
          prompt: "hi",
          model: "gpt-5.3-codex-spark",
          reasoningEffort: "medium",
          mode: "main-run",
        }),
      })
    );
    expect(spawnRes.status).toBe(201);

    const sessionDir = path.join(
      projectsRoot,
      created.path,
      "sessions",
      "alpha"
    );
    const historyPath = path.join(sessionDir, "history.jsonl");
    const logsPath = path.join(sessionDir, "logs.jsonl");

    const start = Date.now();
    while (Date.now() - start < 2000) {
      try {
        const history = await fs.readFile(historyPath, "utf8");
        if (history.includes('"worker.finished"')) break;
      } catch {
        // wait
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const logs = await fs.readFile(logsPath, "utf8");
    expect(logs).toContain("thread.started");
    expect(logs).toContain("Let's tackle the following project:");
    expect(logs).toContain("-m gpt-5.3-codex-spark");
    expect(logs).toContain("-c reasoning_effort=medium");

    const state = JSON.parse(
      await fs.readFile(path.join(sessionDir, "state.json"), "utf8")
    );
    expect(state.session_id).toBe("s1");
    expect(state.worktree_path).toContain(
      path.join(".workspaces", created.id, "_space")
    );

    const config = JSON.parse(
      await fs.readFile(path.join(sessionDir, "config.json"), "utf8")
    );
    expect(config.name).toBe("Coordinator");
    expect(config.cli).toBe("codex");
    expect(config.model).toBe("gpt-5.3-codex-spark");
    expect(config.reasoningEffort).toBe("medium");
    expect(config.runMode).toBe("main-run");
    expect(config.baseBranch).toBe("main");
    expect(typeof config.created).toBe("string");

    const spaceRes = await Promise.resolve(
      api.request(`/projects/${created.id}/space`)
    );
    expect(spaceRes.status).toBe(200);
    const space = await spaceRes.json();
    expect(space.projectId).toBe(created.id);
    expect(space.branch).toBe(`space/${created.id}`);

    const integrateRes = await Promise.resolve(
      api.request(`/projects/${created.id}/space/integrate`, {
        method: "POST",
      })
    );
    expect(integrateRes.status).toBe(200);

    process.env.PATH = prevPath;
  });

  it("spawns pi subagent and records JSON mode output", async () => {
    const createRes = await Promise.resolve(
      api.request("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Pi Spawn" }),
      })
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const repoDir = path.join(tmpDir, "repo-pi");
    await fs.mkdir(repoDir, { recursive: true });
    await execFileAsync("git", ["init", "-b", "main"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], {
      cwd: repoDir,
    });
    await execFileAsync("git", ["config", "user.name", "Test User"], {
      cwd: repoDir,
    });
    await fs.writeFile(path.join(repoDir, "README.md"), "test\n");
    await execFileAsync("git", ["add", "."], { cwd: repoDir });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: repoDir });

    const patchRes = await Promise.resolve(
      api.request(`/projects/${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: repoDir, domain: "coding" }),
      })
    );
    expect(patchRes.status).toBe(200);

    const binDir = path.join(tmpDir, "bin-pi");
    await fs.mkdir(binDir, { recursive: true });
    const piPath = path.join(binDir, "pi");
    const script = [
      "#!/bin/sh",
      'ARGS="$*"',
      'echo "$ARGS" | grep -F -- "--mode json" >/dev/null 2>&1 || { echo "missing --mode json" >&2; exit 1; }',
      'echo "$ARGS" | grep -F -- "--session" >/dev/null 2>&1 || { echo "missing --session" >&2; exit 1; }',
      'echo "$ARGS" | grep -F -- "--model qwen3-max-2026-01-23" >/dev/null 2>&1 || { echo "missing --model" >&2; exit 1; }',
      'echo "$ARGS" | grep -F -- "--thinking high" >/dev/null 2>&1 || { echo "missing --thinking" >&2; exit 1; }',
      `echo '{"type":"session","id":"pi-s1","timestamp":"2026-02-01T00:00:00.000Z","cwd":"$PWD"}'`,
      `echo '{"type":"tool_execution_start","toolCallId":"t1","toolName":"bash","args":{"command":"echo hi"}}'`,
      `echo '{"type":"tool_execution_end","toolCallId":"t1","toolName":"bash","result":"ok","isError":false}'`,
      `echo '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"pi ok"}]}}'`,
    ].join("\n");
    await fs.writeFile(piPath, script, { mode: 0o755 });
    const prevPath = process.env.PATH;
    process.env.PATH = `${binDir}:${prevPath ?? ""}`;

    const spawnRes = await Promise.resolve(
      api.request(`/projects/${created.id}/subagents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: "pi-run",
          cli: "pi",
          prompt: "hi",
          model: "qwen3-max-2026-01-23",
          thinking: "high",
          mode: "main-run",
        }),
      })
    );
    expect(spawnRes.status).toBe(201);

    const sessionDir = path.join(
      projectsRoot,
      created.path,
      "sessions",
      "pi-run"
    );
    const historyPath = path.join(sessionDir, "history.jsonl");
    const start = Date.now();
    while (Date.now() - start < 2000) {
      try {
        const history = await fs.readFile(historyPath, "utf8");
        if (history.includes('"worker.finished"')) break;
      } catch {
        // wait
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const historyRaw = await fs.readFile(historyPath, "utf8");
    const finished = historyRaw
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line))
      .reverse()
      .find((line) => line.type === "worker.finished");
    expect(finished?.data?.outcome).toBe("replied");

    const stateRaw = await fs.readFile(
      path.join(sessionDir, "state.json"),
      "utf8"
    );
    const state = JSON.parse(stateRaw) as {
      session_id?: string;
      session_file?: string;
    };
    expect(state.session_id).toBe("pi-s1");
    expect(typeof state.session_file).toBe("string");
    expect(state.session_file?.endsWith("pi-session.jsonl")).toBe(true);

    process.env.PATH = prevPath;
  });

  it("rejects legacy CLI values on subagent spawn", async () => {
    const createRes = await Promise.resolve(
      api.request("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Legacy CLI Spawn Reject" }),
      })
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const spawnRes = await Promise.resolve(
      api.request(`/projects/${created.id}/subagents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: "legacy",
          cli: "droid",
          prompt: "hi",
          mode: "main-run",
        }),
      })
    );
    expect(spawnRes.status).toBe(400);
    const payload = await spawnRes.json();
    expect(payload.error).toContain("Unsupported CLI");
    expect(payload.error).toContain("claude, codex, pi");
  });

  it("rejects invalid model/effort combos on subagent spawn", async () => {
    const createRes = await Promise.resolve(
      api.request("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Invalid Model Spawn Reject" }),
      })
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const badModel = await Promise.resolve(
      api.request(`/projects/${created.id}/subagents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: "bad-model",
          cli: "codex",
          prompt: "hi",
          model: "haiku",
        }),
      })
    );
    expect(badModel.status).toBe(400);
    const badModelPayload = await badModel.json();
    expect(badModelPayload.error).toContain("Invalid codex model");

    const badThinking = await Promise.resolve(
      api.request(`/projects/${created.id}/subagents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: "bad-thinking",
          cli: "codex",
          prompt: "hi",
          thinking: "high",
        }),
      })
    );
    expect(badThinking.status).toBe(400);
    const badThinkingPayload = await badThinking.json();
    expect(badThinkingPayload.error).toContain("thinking is only valid for pi");
  });

  it("rejects legacy CLI values on project start", async () => {
    const createRes = await Promise.resolve(
      api.request("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Legacy CLI Start Reject" }),
      })
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const startRes = await Promise.resolve(
      api.request(`/projects/${created.id}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runAgent: "cli:gemini" }),
      })
    );
    expect(startRes.status).toBe(400);
    const payload = await startRes.json();
    expect(payload.error).toContain("Unsupported CLI");
    expect(payload.error).toContain("claude, codex, pi");
  });

  it("interrupts a running subagent", async () => {
    const createRes = await Promise.resolve(
      api.request("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Subagent Interrupt" }),
      })
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const repoDir = path.join(tmpDir, "repo-interrupt");
    await fs.mkdir(repoDir, { recursive: true });
    await execFileAsync("git", ["init", "-b", "main"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], {
      cwd: repoDir,
    });
    await execFileAsync("git", ["config", "user.name", "Test User"], {
      cwd: repoDir,
    });
    await fs.writeFile(path.join(repoDir, "README.md"), "test\n");
    await execFileAsync("git", ["add", "."], { cwd: repoDir });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: repoDir });

    const patchRes = await Promise.resolve(
      api.request(`/projects/${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: repoDir, domain: "coding" }),
      })
    );
    expect(patchRes.status).toBe(200);

    const binDir = path.join(tmpDir, "bin-interrupt");
    await fs.mkdir(binDir, { recursive: true });
    const codexPath = path.join(binDir, "codex");
    const script = [
      "#!/bin/sh",
      'echo \'{"type":"thread.started","thread_id":"s2"}\'',
      "sleep 5",
    ].join("\n");
    await fs.writeFile(codexPath, script, { mode: 0o755 });
    const prevPath = process.env.PATH;
    process.env.PATH = `${binDir}:${prevPath ?? ""}`;

    const spawnRes = await Promise.resolve(
      api.request(`/projects/${created.id}/subagents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: "beta",
          cli: "codex",
          prompt: "hi",
          mode: "main-run",
        }),
      })
    );
    expect(spawnRes.status).toBe(201);

    const interruptRes = await Promise.resolve(
      api.request(`/projects/${created.id}/subagents/beta/interrupt`, {
        method: "POST",
      })
    );
    expect(interruptRes.status).toBe(200);

    const sessionDir = path.join(
      projectsRoot,
      created.path,
      "sessions",
      "beta"
    );
    const historyPath = path.join(sessionDir, "history.jsonl");
    const start = Date.now();
    while (Date.now() - start < 2000) {
      try {
        const history = await fs.readFile(historyPath, "utf8");
        if (history.includes('"worker.interrupt"')) break;
      } catch {
        // wait
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const history = await fs.readFile(historyPath, "utf8");
    expect(history).toContain('"worker.interrupt"');

    process.env.PATH = prevPath;
  });

  it("resumes when slug exists and resume is true", async () => {
    const createRes = await Promise.resolve(
      api.request("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Subagent Resume" }),
      })
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const repoDir = path.join(tmpDir, "repo-resume");
    await fs.mkdir(repoDir, { recursive: true });
    await execFileAsync("git", ["init", "-b", "main"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], {
      cwd: repoDir,
    });
    await execFileAsync("git", ["config", "user.name", "Test User"], {
      cwd: repoDir,
    });
    await fs.writeFile(path.join(repoDir, "README.md"), "test\n");
    await execFileAsync("git", ["add", "."], { cwd: repoDir });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: repoDir });

    const patchRes = await Promise.resolve(
      api.request(`/projects/${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: repoDir, domain: "coding" }),
      })
    );
    expect(patchRes.status).toBe(200);

    const binDir = path.join(tmpDir, "bin-resume");
    await fs.mkdir(binDir, { recursive: true });
    const codexPath = path.join(binDir, "codex");
    const script = [
      "#!/bin/sh",
      'echo \'{"type":"thread.started","thread_id":"s1"}\'',
      'echo "$@"',
    ].join("\n");
    await fs.writeFile(codexPath, script, { mode: 0o755 });
    const prevPath = process.env.PATH;
    process.env.PATH = `${binDir}:${prevPath ?? ""}`;

    const spawnRes = await Promise.resolve(
      api.request(`/projects/${created.id}/subagents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: "gamma",
          cli: "codex",
          prompt: "hi",
          mode: "main-run",
        }),
      })
    );
    expect(spawnRes.status).toBe(201);

    const sessionDir = path.join(
      projectsRoot,
      created.path,
      "sessions",
      "gamma"
    );
    const statePath = path.join(sessionDir, "state.json");
    const waitStart = Date.now();
    while (Date.now() - waitStart < 5000) {
      try {
        const state = JSON.parse(await fs.readFile(statePath, "utf8"));
        if (state.session_id === "s1") break;
      } catch {
        // wait
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const resumeState = JSON.parse(await fs.readFile(statePath, "utf8"));
    expect(resumeState.session_id).toBe("s1");

    const spawnRes2 = await Promise.resolve(
      api.request(`/projects/${created.id}/subagents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: "gamma",
          cli: "codex",
          prompt: "follow up",
          mode: "main-run",
          resume: true,
        }),
      })
    );
    expect(spawnRes2.status).toBe(201);

    const logsPath = path.join(sessionDir, "logs.jsonl");
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
    const createRes = await Promise.resolve(
      api.request("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Subagent Worktree" }),
      })
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const repoDir = path.join(tmpDir, "repo-worktree");
    await fs.mkdir(repoDir, { recursive: true });
    await execFileAsync("git", ["init", "-b", "main"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], {
      cwd: repoDir,
    });
    await execFileAsync("git", ["config", "user.name", "Test User"], {
      cwd: repoDir,
    });
    await fs.writeFile(path.join(repoDir, "README.md"), "test\n");
    await execFileAsync("git", ["add", "."], { cwd: repoDir });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: repoDir });

    const patchRes = await Promise.resolve(
      api.request(`/projects/${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: repoDir, domain: "coding" }),
      })
    );
    expect(patchRes.status).toBe(200);

    const binDir = path.join(tmpDir, "bin-worktree");
    await fs.mkdir(binDir, { recursive: true });
    const codexPath = path.join(binDir, "codex");
    const script = [
      "#!/bin/sh",
      'echo \'{"type":"thread.started","thread_id":"s1"}\'',
    ].join("\n");
    await fs.writeFile(codexPath, script, { mode: 0o755 });
    const prevPath = process.env.PATH;
    process.env.PATH = `${binDir}:${prevPath ?? ""}`;

    const spawnRes = await Promise.resolve(
      api.request(`/projects/${created.id}/subagents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: "delta",
          cli: "codex",
          prompt: "hi",
          mode: "worktree",
          baseBranch: "main",
        }),
      })
    );
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

    const listRes = await execFileAsync("git", [
      "-C",
      repoDir,
      "worktree",
      "list",
      "--porcelain",
    ]);
    // Resolve symlinks (macOS /var -> /private/var)
    const realWorkDir = await fs.realpath(workDir);
    expect(listRes.stdout).toContain(`worktree ${realWorkDir}`);

    process.env.PATH = prevPath;
  });

  it("creates clone when mode is clone and adds named remote", async () => {
    const createRes = await Promise.resolve(
      api.request("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Subagent Clone" }),
      })
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const repoDir = path.join(tmpDir, "repo-clone");
    await fs.mkdir(repoDir, { recursive: true });
    await execFileAsync("git", ["init", "-b", "main"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], {
      cwd: repoDir,
    });
    await execFileAsync("git", ["config", "user.name", "Test User"], {
      cwd: repoDir,
    });
    await fs.writeFile(path.join(repoDir, "README.md"), "test\n");
    await execFileAsync("git", ["add", "."], { cwd: repoDir });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: repoDir });

    const patchRes = await Promise.resolve(
      api.request(`/projects/${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: repoDir, domain: "coding" }),
      })
    );
    expect(patchRes.status).toBe(200);

    const binDir = path.join(tmpDir, "bin-clone");
    await fs.mkdir(binDir, { recursive: true });
    const codexPath = path.join(binDir, "codex");
    const script = [
      "#!/bin/sh",
      'echo \'{"type":"thread.started","thread_id":"s1"}\'',
    ].join("\n");
    await fs.writeFile(codexPath, script, { mode: 0o755 });
    const prevPath = process.env.PATH;
    process.env.PATH = `${binDir}:${prevPath ?? ""}`;

    const spawnRes = await Promise.resolve(
      api.request(`/projects/${created.id}/subagents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: "sigma",
          cli: "codex",
          prompt: "hi",
          mode: "clone",
          baseBranch: "main",
        }),
      })
    );
    expect(spawnRes.status).toBe(201);

    const cloneDir = path.join(
      projectsRoot,
      ".workspaces",
      created.id,
      "sigma"
    );
    await expect(fs.stat(path.join(cloneDir, ".git"))).resolves.toBeDefined();
    const branchRes = await execFileAsync("git", [
      "-C",
      cloneDir,
      "branch",
      "--show-current",
    ]);
    expect(branchRes.stdout.trim()).toBe(`${created.id}/sigma`);

    const remote = `agent-${String(created.id).toLowerCase()}`;
    const remoteUrl = await execFileAsync("git", [
      "-C",
      repoDir,
      "remote",
      "get-url",
      remote,
    ]);
    const realCloneDir = await fs.realpath(cloneDir);
    expect(remoteUrl.stdout.trim()).toBe(realCloneDir);

    process.env.PATH = prevPath;
  });

  it("kills clone subagent and removes named remote", async () => {
    const createRes = await Promise.resolve(
      api.request("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Subagent Kill Clone" }),
      })
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const repoDir = path.join(tmpDir, "repo-kill-clone");
    await fs.mkdir(repoDir, { recursive: true });
    await execFileAsync("git", ["init", "-b", "main"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], {
      cwd: repoDir,
    });
    await execFileAsync("git", ["config", "user.name", "Test User"], {
      cwd: repoDir,
    });
    await fs.writeFile(path.join(repoDir, "README.md"), "test\n");
    await execFileAsync("git", ["add", "."], { cwd: repoDir });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: repoDir });

    const patchRes = await Promise.resolve(
      api.request(`/projects/${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: repoDir, domain: "coding" }),
      })
    );
    expect(patchRes.status).toBe(200);

    const workspacesRoot = path.join(projectsRoot, ".workspaces", created.id);
    await fs.mkdir(workspacesRoot, { recursive: true });
    const cloneDir = path.join(workspacesRoot, "omega");
    const branch = `${created.id}/omega`;
    await execFileAsync("git", ["clone", repoDir, cloneDir]);
    await execFileAsync("git", [
      "-C",
      cloneDir,
      "checkout",
      "-b",
      branch,
      "origin/main",
    ]);
    const remote = `agent-${String(created.id).toLowerCase()}`;
    await execFileAsync("git", [
      "-C",
      repoDir,
      "remote",
      "add",
      remote,
      cloneDir,
    ]);

    const now = new Date().toISOString();
    const state = {
      session_id: "s1",
      supervisor_pid: 0,
      started_at: now,
      last_error: "",
      cli: "codex",
      run_mode: "clone",
      worktree_path: cloneDir,
      base_branch: "main",
    };
    const sessionDir = path.join(
      projectsRoot,
      created.path,
      "sessions",
      "omega"
    );
    await fs.mkdir(sessionDir, { recursive: true });
    await fs.writeFile(
      path.join(sessionDir, "state.json"),
      JSON.stringify(state, null, 2)
    );

    const killRes = await Promise.resolve(
      api.request(`/projects/${created.id}/subagents/omega/kill`, {
        method: "POST",
      })
    );
    expect(killRes.status).toBe(200);

    await expect(fs.stat(cloneDir)).rejects.toThrow();
    const remotes = await execFileAsync("git", ["-C", repoDir, "remote"]);
    expect(remotes.stdout).not.toContain(remote);
  });

  it("kills worktree subagent and removes branch", async () => {
    const createRes = await Promise.resolve(
      api.request("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Subagent Kill Worktree" }),
      })
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const repoDir = path.join(tmpDir, "repo-kill-worktree");
    await fs.mkdir(repoDir, { recursive: true });
    await execFileAsync("git", ["init", "-b", "main"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], {
      cwd: repoDir,
    });
    await execFileAsync("git", ["config", "user.name", "Test User"], {
      cwd: repoDir,
    });
    await fs.writeFile(path.join(repoDir, "README.md"), "test\n");
    await execFileAsync("git", ["add", "."], { cwd: repoDir });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: repoDir });

    const patchRes = await Promise.resolve(
      api.request(`/projects/${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: repoDir, domain: "coding" }),
      })
    );
    expect(patchRes.status).toBe(200);

    const workspacesRoot = path.join(projectsRoot, ".workspaces", created.id);
    await fs.mkdir(workspacesRoot, { recursive: true });
    const workspaceDir = path.join(workspacesRoot, "omega");
    const branch = `${created.id}/omega`;
    await execFileAsync("git", [
      "-C",
      repoDir,
      "worktree",
      "add",
      "-b",
      branch,
      workspaceDir,
      "main",
    ]);

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
    const sessionDir = path.join(
      projectsRoot,
      created.path,
      "sessions",
      "omega"
    );
    await fs.mkdir(sessionDir, { recursive: true });
    await fs.writeFile(
      path.join(sessionDir, "state.json"),
      JSON.stringify(state, null, 2)
    );

    const killRes = await Promise.resolve(
      api.request(`/projects/${created.id}/subagents/omega/kill`, {
        method: "POST",
      })
    );
    expect(killRes.status).toBe(200);

    await expect(fs.stat(workspaceDir)).rejects.toThrow();
    const branchRes = await execFileAsync("git", [
      "-C",
      repoDir,
      "branch",
      "--list",
      branch,
    ]);
    expect(branchRes.stdout.trim()).toBe("");
  });

  it("kills main-run subagent by removing workspace", async () => {
    const createRes = await Promise.resolve(
      api.request("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Subagent Kill Main Run" }),
      })
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const sessionDir = path.join(projectsRoot, created.path, "sessions", "eta");
    await fs.mkdir(sessionDir, { recursive: true });
    await fs.writeFile(
      path.join(sessionDir, "state.json"),
      JSON.stringify({ supervisor_pid: 0, run_mode: "main-run" }, null, 2)
    );

    const killRes = await Promise.resolve(
      api.request(`/projects/${created.id}/subagents/eta/kill`, {
        method: "POST",
      })
    );
    expect(killRes.status).toBe(200);
    await expect(fs.stat(sessionDir)).rejects.toThrow();
  });

  it("returns error when subagent missing on kill", async () => {
    const createRes = await Promise.resolve(
      api.request("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Subagent Kill Missing" }),
      })
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const killRes = await Promise.resolve(
      api.request(`/projects/${created.id}/subagents/missing/kill`, {
        method: "POST",
      })
    );
    expect(killRes.status).toBe(404);
    const body = await killRes.json();
    expect(body.error).toBe("Subagent not found: missing");
  });

  it("SIGTERMs running subagent before cleanup", async () => {
    const createRes = await Promise.resolve(
      api.request("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Subagent Kill Running" }),
      })
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const sessionDir = path.join(
      projectsRoot,
      created.path,
      "sessions",
      "theta"
    );
    await fs.mkdir(sessionDir, { recursive: true });
    const child = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { stdio: "ignore" }
    );
    expect(child.pid).toBeDefined();
    const exitPromise = new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve) => {
      child.on("exit", (code, signal) => resolve({ code, signal }));
    });
    await fs.writeFile(
      path.join(sessionDir, "state.json"),
      JSON.stringify(
        { supervisor_pid: child.pid, run_mode: "main-run" },
        null,
        2
      )
    );

    const killRes = await Promise.resolve(
      api.request(`/projects/${created.id}/subagents/theta/kill`, {
        method: "POST",
      })
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
    const createRes = await Promise.resolve(
      api.request("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Subagent Resolve" }),
      })
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const repoDir = path.join(tmpDir, "repo-resolve");
    await fs.mkdir(repoDir, { recursive: true });
    await execFileAsync("git", ["init", "-b", "main"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], {
      cwd: repoDir,
    });
    await execFileAsync("git", ["config", "user.name", "Test User"], {
      cwd: repoDir,
    });
    await fs.writeFile(path.join(repoDir, "README.md"), "test\n");
    await execFileAsync("git", ["add", "."], { cwd: repoDir });
    await execFileAsync("git", ["commit", "-m", "init"], { cwd: repoDir });

    const patchRes = await Promise.resolve(
      api.request(`/projects/${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: repoDir, domain: "coding" }),
      })
    );
    expect(patchRes.status).toBe(200);

    const claudeDir = path.join(tmpDir, ".claude", "local");
    await fs.mkdir(claudeDir, { recursive: true });
    const claudePath = path.join(claudeDir, "claude");
    const script = [
      "#!/bin/sh",
      'echo \'{"type":"thread.started","thread_id":"s1"}\'',
    ].join("\n");
    await fs.writeFile(claudePath, script, { mode: 0o755 });

    const prevPath = process.env.PATH;
    process.env.PATH = "/usr/bin:/bin";

    const spawnRes = await Promise.resolve(
      api.request(`/projects/${created.id}/subagents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: "epsilon",
          cli: "claude",
          prompt: "hi",
          mode: "main-run",
        }),
      })
    );
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
