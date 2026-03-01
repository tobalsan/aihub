import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GatewayConfig } from "@aihub/shared";
import {
  ensureProjectSpace,
  getProjectSpace,
  integrateProjectSpaceQueue,
  recordWorkerDelivery,
} from "./space.js";

const execFileAsync = promisify(execFile);

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

async function createRepo(repoDir: string): Promise<void> {
  await fs.mkdir(repoDir, { recursive: true });
  await runGit(repoDir, ["init", "-b", "main"]);
  await runGit(repoDir, ["config", "user.name", "AIHub Test"]);
  await runGit(repoDir, ["config", "user.email", "test@aihub.local"]);
  await fs.writeFile(path.join(repoDir, "app.txt"), "base\n", "utf8");
  await runGit(repoDir, ["add", "."]);
  await runGit(repoDir, ["commit", "-m", "init"]);
}

async function writeProjectReadme(projectDir: string, repo: string): Promise<void> {
  const frontmatter = [
    "---",
    'id: "PRO-1"',
    'title: "Space Test"',
    `repo: ${JSON.stringify(repo)}`,
    "---",
    "",
    "# Space Test",
    "",
  ].join("\n");
  await fs.writeFile(path.join(projectDir, "README.md"), frontmatter, "utf8");
}

describe("project space", () => {
  let tmpDir: string;
  let projectsRoot: string;
  let config: GatewayConfig;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aihub-space-"));
    projectsRoot = path.join(tmpDir, "projects");
    await fs.mkdir(projectsRoot, { recursive: true });
    config = {
      agents: [],
      sessions: { idleMinutes: 360 },
      projects: { root: projectsRoot },
    } as unknown as GatewayConfig;
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates and persists project space", async () => {
    const repoDir = path.join(tmpDir, "repo");
    await createRepo(repoDir);

    const projectDir = path.join(projectsRoot, "PRO-1_space-test");
    await fs.mkdir(projectDir, { recursive: true });
    await writeProjectReadme(projectDir, repoDir);

    const space = await ensureProjectSpace(config, "PRO-1", "main");

    expect(space.branch).toBe("space/PRO-1");
    expect(space.baseBranch).toBe("main");
    await expect(fs.stat(path.join(projectDir, "space.json"))).resolves.toBeDefined();
    expect(await runGit(space.worktreePath, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(
      "space/PRO-1"
    );
  });

  it("integrates worker worktree commits into space", async () => {
    const repoDir = path.join(tmpDir, "repo");
    await createRepo(repoDir);

    const projectDir = path.join(projectsRoot, "PRO-1_space-test");
    await fs.mkdir(projectDir, { recursive: true });
    await writeProjectReadme(projectDir, repoDir);

    const space = await ensureProjectSpace(config, "PRO-1", "main");
    const workerPath = path.join(projectsRoot, ".workspaces", "PRO-1", "alpha");
    await fs.mkdir(path.dirname(workerPath), { recursive: true });
    await runGit(repoDir, [
      "worktree",
      "add",
      "-b",
      "PRO-1/alpha",
      workerPath,
      "main",
    ]);

    const start = await runGit(workerPath, ["rev-parse", "HEAD"]);
    await fs.writeFile(path.join(workerPath, "app.txt"), "worker-one\n", "utf8");
    await runGit(workerPath, ["add", "app.txt"]);
    await runGit(workerPath, ["commit", "-m", "worker one"]);
    const end = await runGit(workerPath, ["rev-parse", "HEAD"]);

    const updated = await recordWorkerDelivery(config, {
      projectId: "PRO-1",
      workerSlug: "alpha",
      runMode: "worktree",
      worktreePath: workerPath,
      startSha: start,
      endSha: end,
    });

    expect(updated.integrationBlocked).toBe(false);
    expect(updated.queue[0]?.status).toBe("integrated");
    const content = await fs.readFile(path.join(space.worktreePath, "app.txt"), "utf8");
    expect(content).toContain("worker-one");
  });

  it(
    "blocks queue on conflict and resumes later pending entries",
    async () => {
    const repoDir = path.join(tmpDir, "repo");
    await createRepo(repoDir);

    const projectDir = path.join(projectsRoot, "PRO-1_space-test");
    await fs.mkdir(projectDir, { recursive: true });
    await writeProjectReadme(projectDir, repoDir);

    const workspacesRoot = path.join(projectsRoot, ".workspaces", "PRO-1");
    await fs.mkdir(workspacesRoot, { recursive: true });
    await ensureProjectSpace(config, "PRO-1", "main");

    const alphaPath = path.join(workspacesRoot, "alpha");
    await runGit(repoDir, ["worktree", "add", "-b", "PRO-1/alpha", alphaPath, "main"]);
    const alphaStart = await runGit(alphaPath, ["rev-parse", "HEAD"]);
    await fs.writeFile(path.join(alphaPath, "app.txt"), "worker-one\n", "utf8");
    await runGit(alphaPath, ["add", "app.txt"]);
    await runGit(alphaPath, ["commit", "-m", "alpha"]);
    const alphaEnd = await runGit(alphaPath, ["rev-parse", "HEAD"]);
    await recordWorkerDelivery(config, {
      projectId: "PRO-1",
      workerSlug: "alpha",
      runMode: "worktree",
      worktreePath: alphaPath,
      startSha: alphaStart,
      endSha: alphaEnd,
    });

    const betaPath = path.join(workspacesRoot, "beta");
    await runGit(repoDir, ["worktree", "add", "-b", "PRO-1/beta", betaPath, "main"]);
    const betaStart = await runGit(betaPath, ["rev-parse", "HEAD"]);
    await fs.writeFile(path.join(betaPath, "app.txt"), "worker-two\n", "utf8");
    await runGit(betaPath, ["add", "app.txt"]);
    await runGit(betaPath, ["commit", "-m", "beta"]);
    const betaEnd = await runGit(betaPath, ["rev-parse", "HEAD"]);
    const blocked = await recordWorkerDelivery(config, {
      projectId: "PRO-1",
      workerSlug: "beta",
      runMode: "worktree",
      worktreePath: betaPath,
      startSha: betaStart,
      endSha: betaEnd,
    });
    expect(blocked.integrationBlocked).toBe(true);
    expect(blocked.queue.some((item) => item.status === "conflict")).toBe(true);

    const gammaPath = path.join(workspacesRoot, "gamma");
    await runGit(repoDir, ["worktree", "add", "-b", "PRO-1/gamma", gammaPath, "main"]);
    const gammaStart = await runGit(gammaPath, ["rev-parse", "HEAD"]);
    await fs.writeFile(path.join(gammaPath, "note.txt"), "ok\n", "utf8");
    await runGit(gammaPath, ["add", "note.txt"]);
    await runGit(gammaPath, ["commit", "-m", "gamma"]);
    const gammaEnd = await runGit(gammaPath, ["rev-parse", "HEAD"]);
    const pending = await recordWorkerDelivery(config, {
      projectId: "PRO-1",
      workerSlug: "gamma",
      runMode: "worktree",
      worktreePath: gammaPath,
      startSha: gammaStart,
      endSha: gammaEnd,
    });
    expect(pending.integrationBlocked).toBe(true);
    expect(pending.queue.some((item) => item.workerSlug === "gamma" && item.status === "pending")).toBe(true);

    const resumed = await integrateProjectSpaceQueue(config, "PRO-1", {
      resume: true,
    });
    expect(resumed.integrationBlocked).toBe(false);
    expect(
      resumed.queue.some(
        (item) => item.workerSlug === "gamma" && item.status === "integrated"
      )
    ).toBe(true);
    },
    15_000
  );

  it("integrates clone worker commits by fetching from clone remote", async () => {
    const repoDir = path.join(tmpDir, "repo");
    await createRepo(repoDir);

    const projectDir = path.join(projectsRoot, "PRO-1_space-test");
    await fs.mkdir(projectDir, { recursive: true });
    await writeProjectReadme(projectDir, repoDir);

    const clonePath = path.join(projectsRoot, ".workspaces", "PRO-1", "clone-a");
    await fs.mkdir(path.dirname(clonePath), { recursive: true });
    await runGit(repoDir, ["clone", repoDir, clonePath]);
    await runGit(clonePath, ["checkout", "-b", "PRO-1/clone-a", "main"]);

    const remoteName = "agent-pro-1";
    await runGit(repoDir, ["remote", "add", remoteName, clonePath]);

    await ensureProjectSpace(config, "PRO-1", "main");
    const start = await runGit(clonePath, ["rev-parse", "HEAD"]);
    await fs.writeFile(path.join(clonePath, "clone.txt"), "clone\n", "utf8");
    await runGit(clonePath, ["add", "clone.txt"]);
    await runGit(clonePath, ["commit", "-m", "clone commit"]);
    const end = await runGit(clonePath, ["rev-parse", "HEAD"]);

    const updated = await recordWorkerDelivery(config, {
      projectId: "PRO-1",
      workerSlug: "clone-a",
      runMode: "clone",
      worktreePath: clonePath,
      startSha: start,
      endSha: end,
    });

    expect(updated.integrationBlocked).toBe(false);
    expect(
      updated.queue.some(
        (item) => item.workerSlug === "clone-a" && item.status === "integrated"
      )
    ).toBe(true);

    const spaceRes = await getProjectSpace(config, "PRO-1");
    expect(spaceRes.ok).toBe(true);
    if (spaceRes.ok) {
      const content = await fs.readFile(
        path.join(spaceRes.data.worktreePath, "clone.txt"),
        "utf8"
      );
      expect(content).toContain("clone");
    }
  });
});
