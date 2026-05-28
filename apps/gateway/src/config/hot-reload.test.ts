import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reloadConfig = vi.fn();
const setLoadedConfig = vi.fn();
let configPath = "";

vi.mock("@aihub/extension-scheduler", () => ({
  getAgentJobsPath: (workspace: string) => path.join(workspace, "jobs.yaml"),
  getScheduler: () => ({ refreshFromDisk: vi.fn() }),
  hasSchedulerContext: () => false,
}));

vi.mock("./index.js", () => ({
  getConfigPath: () => configPath,
  reloadConfig,
  setLoadedConfig,
}));

describe("startGatewayHotReload", () => {
  let tmpDir = "";
  let timer: NodeJS.Timeout | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aihub-hot-reload-"));
    configPath = path.join(tmpDir, "aihub.json");
    fs.writeFileSync(configPath, "{}");
  });

  afterEach(() => {
    if (timer) clearInterval(timer);
    timer = undefined;
    vi.useRealTimers();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("does not reload when watched files are unchanged", async () => {
    const workspace = path.join(tmpDir, "agent");
    fs.mkdirSync(workspace);
    fs.writeFileSync(path.join(workspace, "agent.yaml"), "id: casey\n");

    const { startGatewayHotReload } = await import("./hot-reload.js");
    timer = startGatewayHotReload(
      {
        agents: [{ id: "casey", workspace, workspaceDir: workspace }],
      } as never,
      { intervalMs: 1000 }
    );

    await vi.advanceTimersByTimeAsync(1000);

    expect(reloadConfig).not.toHaveBeenCalled();
    expect(setLoadedConfig).not.toHaveBeenCalled();
  });

  it("reloads only after watched file mtimes change", async () => {
    const workspace = path.join(tmpDir, "agent");
    const agentPath = path.join(workspace, "agent.yaml");
    fs.mkdirSync(workspace);
    fs.writeFileSync(agentPath, "id: casey\n");
    const nextConfig = {
      agents: [{ id: "casey", workspace, workspaceDir: workspace }],
    };
    reloadConfig.mockReturnValue(nextConfig);
    const onReload = vi.fn();

    const { startGatewayHotReload } = await import("./hot-reload.js");
    timer = startGatewayHotReload(
      {
        agents: [{ id: "casey", workspace, workspaceDir: workspace }],
      } as never,
      { intervalMs: 1000, onReload }
    );

    await vi.advanceTimersByTimeAsync(1000);
    fs.writeFileSync(agentPath, "id: casey\nname: Casey\n");
    await vi.advanceTimersByTimeAsync(1000);

    expect(reloadConfig).toHaveBeenCalledTimes(1);
    expect(onReload).toHaveBeenCalledWith(nextConfig);
  });
});
