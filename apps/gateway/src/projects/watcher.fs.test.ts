import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GatewayConfig } from "@aihub/shared";
import { agentEventBus } from "../agents/events.js";
import { startProjectWatcher } from "./watcher.js";

async function waitFor<T>(
  read: () => T | undefined,
  timeoutMs: number
): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return read();
}

describe("project watcher filesystem events", () => {
  let root = "";

  afterEach(async () => {
    if (root) {
      await fs.rm(root, { recursive: true, force: true });
      root = "";
    }
  });

  it("emits agent_changed when a nested session state.json changes", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "aihub-watcher-"));
    const sessionDir = path.join(root, "PRO-200_test", "sessions", "worker-a");
    await fs.mkdir(sessionDir, { recursive: true });
    await fs.writeFile(
      path.join(sessionDir, "state.json"),
      JSON.stringify({ supervisor_pid: 0 }),
      "utf8"
    );

    const received: string[] = [];
    const offEvent = agentEventBus.onAgentChanged((event) => {
      received.push(event.projectId);
    });
    const watcher = startProjectWatcher({
      projects: { root },
    } as GatewayConfig);

    try {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await fs.writeFile(
        path.join(sessionDir, "state.json"),
        JSON.stringify({ supervisor_pid: process.pid }),
        "utf8"
      );

      const projectId = await waitFor(() => received[0], 2_000);
      expect(projectId).toBe("PRO-200");
    } finally {
      offEvent();
      await watcher.close();
    }
  });
});
