import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GatewayConfig } from "@aihub/shared";
import {
  ensureProjectSpace,
  recordWorkerDelivery,
  integrateProjectSpaceQueue,
} from "../projects/space.js";

const execFileAsync = promisify(execFile);
const SPACE_API_TEST_TIMEOUT_MS = 30_000;

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

describe("space merge API", () => {
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

  const projectConfig = (): GatewayConfig =>
    ({
      agents: [],
      sessions: { idleMinutes: 360 },
      projects: { root: projectsRoot },
    }) as unknown as GatewayConfig;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aihub-space-merge-api-"));
    projectsRoot = path.join(tmpDir, "projects");

    prevHome = process.env.HOME;
    prevUserProfile = process.env.USERPROFILE;
    process.env.HOME = tmpDir;
    process.env.USERPROFILE = tmpDir;

    const configDir = path.join(tmpDir, ".aihub");
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      path.join(configDir, "aihub.json"),
      JSON.stringify(
        {
          version: 2,
          agents: [
            {
              id: "test-agent",
              name: "Test Agent",
              workspace: "~/test",
              model: {
                provider: "anthropic",
                model: "claude-3-5-sonnet-20241022",
              },
            },
          ],
          projects: { root: projectsRoot },
          components: {
            projects: { enabled: true, root: projectsRoot },
          },
        },
        null,
        2
      )
    );

    vi.resetModules();
    const { clearConfigCacheForTests, loadConfig } = await import(
      "../config/index.js"
    );
    clearConfigCacheForTests();
    const { loadComponents } = await import("../components/registry.js");
    const mod = await import("./api.core.js");
    api = mod.api;
    const components = await loadComponents(loadConfig());
    for (const component of components) {
      component.registerRoutes(api as never);
    }
  });

  afterAll(async () => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevUserProfile;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("rejects merge when queue has unresolved entries", async () => {
    const repoDir = path.join(tmpDir, "repo-unresolved");
    await createRepo(repoDir);

    const createRes = await Promise.resolve(
      api.request("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Space Merge Queue Validation" }),
      })
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const patchRes = await Promise.resolve(
      api.request(`/projects/${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: repoDir }),
      })
    );
    expect(patchRes.status).toBe(200);

    await ensureProjectSpace(projectConfig(), created.id, "main");
    const workerPath = path.join(projectsRoot, ".workspaces", created.id, "alpha");
    await fs.mkdir(path.dirname(workerPath), { recursive: true });
    await runGit(repoDir, ["worktree", "add", "-b", `${created.id}/alpha`, workerPath, "main"]);
    const start = await runGit(workerPath, ["rev-parse", "HEAD"]);
    await fs.writeFile(path.join(workerPath, "app.txt"), "worker-one\n", "utf8");
    await runGit(workerPath, ["add", "app.txt"]);
    await runGit(workerPath, ["commit", "-m", "worker one"]);
    const end = await runGit(workerPath, ["rev-parse", "HEAD"]);
    await recordWorkerDelivery(projectConfig(), {
      projectId: created.id,
      workerSlug: "alpha",
      runMode: "worktree",
      worktreePath: workerPath,
      startSha: start,
      endSha: end,
    });

    const mergeRes = await Promise.resolve(
      api.request(`/projects/${created.id}/space/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cleanup: true }),
      })
    );
    expect(mergeRes.status).toBe(409);
    const mergeBody = await mergeRes.json();
    expect(mergeBody.error).toContain("Space queue has unresolved entries");
  }, SPACE_API_TEST_TIMEOUT_MS);

  it("merges space into base and updates project status to done", async () => {
    const repoDir = path.join(tmpDir, "repo-success");
    await createRepo(repoDir);

    const createRes = await Promise.resolve(
      api.request("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Space Merge Success" }),
      })
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const patchRes = await Promise.resolve(
      api.request(`/projects/${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: repoDir, status: "in_progress" }),
      })
    );
    expect(patchRes.status).toBe(200);

    await ensureProjectSpace(projectConfig(), created.id, "main");
    const workerPath = path.join(projectsRoot, ".workspaces", created.id, "alpha");
    await fs.mkdir(path.dirname(workerPath), { recursive: true });
    await runGit(repoDir, ["worktree", "add", "-b", `${created.id}/alpha`, workerPath, "main"]);
    const start = await runGit(workerPath, ["rev-parse", "HEAD"]);
    await fs.writeFile(path.join(workerPath, "app.txt"), "worker-one\n", "utf8");
    await runGit(workerPath, ["add", "app.txt"]);
    await runGit(workerPath, ["commit", "-m", "worker one"]);
    const end = await runGit(workerPath, ["rev-parse", "HEAD"]);
    await recordWorkerDelivery(projectConfig(), {
      projectId: created.id,
      workerSlug: "alpha",
      runMode: "worktree",
      worktreePath: workerPath,
      startSha: start,
      endSha: end,
    });
    await integrateProjectSpaceQueue(projectConfig(), created.id);

    const mergeRes = await Promise.resolve(
      api.request(`/projects/${created.id}/space/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cleanup: false }),
      })
    );
    expect(mergeRes.status).toBe(200);
    const merged = await mergeRes.json();
    expect(merged.merge.baseBranch).toBe("main");
    expect(merged.merge.mergeMethod).toBe("ff");
    expect(merged.merge.afterSha).toBeTruthy();
    expect(merged.project.frontmatter.status).toBe("done");

    const projectRes = await Promise.resolve(api.request(`/projects/${created.id}`));
    expect(projectRes.status).toBe(200);
    const project = await projectRes.json();
    expect(project.frontmatter.status).toBe("done");

    const mainContent = await runGit(repoDir, ["show", "main:app.txt"]);
    expect(mainContent).toContain("worker-one");

    const spaceRes = await Promise.resolve(api.request(`/projects/${created.id}/space`));
    expect(spaceRes.status).toBe(200);
    const spaceState = await spaceRes.json();
    expect(Array.isArray(spaceState.queue)).toBe(true);
    expect(spaceState.queue).toHaveLength(0);
    expect(spaceState.integrationBlocked).toBe(false);
  }, SPACE_API_TEST_TIMEOUT_MS);
});
