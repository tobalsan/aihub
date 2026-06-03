import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentConfig, ExtensionContext, GatewayConfig } from "@aihub/shared";
import {
  ScheduleAlreadyRunningError,
  SchedulerService,
  clearSchedulerContext,
  setSchedulerContext,
  stopScheduler,
} from "./service.js";

function agent(id: string, workspace: string): AgentConfig {
  return {
    id,
    name: id,
    workspace,
    workspaceDir: workspace,
    model: { provider: "test", model: "test" },
    queueMode: "queue",
  };
}

function context(config: GatewayConfig, runAgent = vi.fn()): ExtensionContext {
  return {
    getConfig: () => config,
    getDataDir: () => os.tmpdir(),
    getAgent: (id) => config.agents.find((candidate) => candidate.id === id),
    getAgents: () => config.agents,
    isAgentActive: () => true,
    isAgentStreaming: () => false,
    resolveWorkspaceDir: (candidate) => candidate.workspaceDir ?? candidate.workspace,
    runAgent,
    getSubagentTemplates: () => [],
    resolveSessionId: vi.fn(),
    getSessionEntry: vi.fn(),
    clearSessionEntry: vi.fn(),
    restoreSessionUpdatedAt: vi.fn(),
    deleteSession: vi.fn(),
    invalidateHistoryCache: vi.fn(),
    getSessionHistory: vi.fn(),
    saveMediaFile: vi.fn(),
    readMediaFile: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    emit: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

describe("SchedulerService.runNow", () => {
  let tmpDir: string | undefined;

  afterEach(async () => {
    try {
      await stopScheduler();
    } catch {
      // Tests create the service directly and may not start it.
    }
    clearSchedulerContext();
    vi.restoreAllMocks();
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("runs a disabled job immediately without changing its next scheduled fire", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aihub-scheduler-service-"));
    const alpha = agent("alpha", path.join(tmpDir, "alpha"));
    const runAgent = vi.fn().mockResolvedValue({
      payloads: [{ text: "done" }],
      meta: { durationMs: 12, sessionId: "manual-session" },
    });
    const config: GatewayConfig = {
      version: 3,
      agents: [alpha],
      extensions: { scheduler: { enabled: true } },
      sessions: { idleMinutes: 360 },
      agentFab: false,
    };
    setSchedulerContext(context(config, runAgent));
    const scheduler = new SchedulerService();
    const job = await scheduler.add("alpha", {
      name: "Digest",
      schedule: { cron: "0 8 * * *", tz: "UTC" },
      payload: { message: "Run" },
    });
    const disabled = (await scheduler.update("alpha", job.id, { enabled: false })) as {
      state?: { nextRunAtMs?: number };
    };
    const previousNextRunAtMs = disabled.state?.nextRunAtMs;

    const result = await scheduler.runNow("alpha", job.id);

    expect(result.status).toBe("ok");
    expect(result.sessionId).toBe("manual-session");
    expect(result.outputPath).toContain(path.join("cron", "output", job.id));
    await expect(fs.readFile(result.outputPath!, "utf8")).resolves.toContain("done");
    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "alpha",
        message: "Run",
        source: "scheduler",
      })
    );

    const [after] = (await scheduler.list("alpha")) as Array<{
      enabled?: boolean;
      state?: { nextRunAtMs?: number; lastStatus?: string };
    }>;
    expect(after?.enabled).toBe(false);
    expect(after?.state?.nextRunAtMs).toBe(previousNextRunAtMs);
    expect(after?.state?.lastStatus).toBe("ok");
  });

  it("rejects a second manual run while the same job is executing", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aihub-scheduler-service-"));
    const alpha = agent("alpha", path.join(tmpDir, "alpha"));
    let finishRun!: (value: unknown) => void;
    const runStarted = new Promise<void>((resolve) => {
      const runAgent = vi.fn(
        () =>
          new Promise((finish) => {
            finishRun = finish;
            resolve();
          })
      );
      const config: GatewayConfig = {
        version: 3,
        agents: [alpha],
        extensions: { scheduler: { enabled: true } },
        sessions: { idleMinutes: 360 },
        agentFab: false,
      };
      setSchedulerContext(context(config, runAgent));
    });
    const scheduler = new SchedulerService();
    const job = await scheduler.add("alpha", {
      name: "Digest",
      schedule: { cron: "0 8 * * *", tz: "UTC" },
      payload: { message: "Run" },
    });

    const firstRun = scheduler.runNow("alpha", job.id);
    await runStarted;

    await expect(scheduler.runNow("alpha", job.id)).rejects.toBeInstanceOf(
      ScheduleAlreadyRunningError
    );

    finishRun({ payloads: [{ text: "done" }], meta: { durationMs: 1, sessionId: "s" } });
    await expect(firstRun).resolves.toMatchObject({ status: "ok" });
  });

  it("skips and reschedules a due scheduled fire that collides with a manual run", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aihub-scheduler-service-"));
    const alpha = agent("alpha", path.join(tmpDir, "alpha"));
    let finishRun!: (value: unknown) => void;
    const runStarted = new Promise<void>((resolve) => {
      const runAgent = vi.fn(
        () =>
          new Promise((finish) => {
            finishRun = finish;
            resolve();
          })
      );
      const config: GatewayConfig = {
        version: 3,
        agents: [alpha],
        extensions: { scheduler: { enabled: true } },
        sessions: { idleMinutes: 360 },
        agentFab: false,
      };
      setSchedulerContext(context(config, runAgent));
    });
    const scheduler = new SchedulerService();
    const job = await scheduler.add("alpha", {
      name: "Digest",
      schedule: { cron: "* * * * *", tz: "UTC" },
      payload: { message: "Run" },
    });
    const [loadedJob] = (await scheduler.list("alpha")) as Array<{
      state?: { nextRunAtMs?: number };
    }>;
    loadedJob!.state = { nextRunAtMs: Date.now() - 1 };

    const manualRun = scheduler.runNow("alpha", job.id);
    await runStarted;

    await (scheduler as unknown as { runDueJobs(): Promise<void> }).runDueJobs();

    finishRun({ payloads: [{ text: "done" }], meta: { durationMs: 1, sessionId: "s" } });
    await expect(manualRun).resolves.toMatchObject({ status: "ok" });

    const [after] = (await scheduler.list("alpha")) as Array<{
      state?: { nextRunAtMs?: number };
    }>;
    expect(after?.state?.nextRunAtMs).toBeGreaterThan(Date.now());
  });
});
