import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import os from "node:os";
import type { AddressInfo } from "node:net";

describe("/api/debug/events", () => {
  let tmpDir: string;
  let prevHome: string | undefined;
  let prevUserProfile: string | undefined;
  let server: ReturnType<typeof import("./index.js").startServer>;
  let port: number;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aihub-debug-events-"));
    prevHome = process.env.HOME;
    prevUserProfile = process.env.USERPROFILE;
    process.env.HOME = tmpDir;
    process.env.USERPROFILE = tmpDir;

    const configDir = path.join(tmpDir, ".aihub");
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(
      path.join(configDir, "aihub.json"),
      JSON.stringify({
        agents: [
          {
            id: "test-agent",
            name: "Test",
            workspace: "~/test",
            model: {
              provider: "anthropic",
              model: "claude-3-5-sonnet-20241022",
            },
          },
        ],
      })
    );

    vi.resetModules();
    const serverMod = await import("./index.js");
    server = serverMod.startServer(0, "127.0.0.1");
    await new Promise<void>((resolve) => {
      if (server.listening) return resolve();
      server.once("listening", () => resolve());
    });
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevUserProfile;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns recent events", async () => {
    const { agentEventBus } = await import("../agents/events.js");
    agentEventBus.emitStatusChange({
      agentId: "test-agent",
      status: "streaming",
    });
    agentEventBus.emitStatusChange({ agentId: "test-agent", status: "idle" });

    const res = await fetch(`http://127.0.0.1:${port}/api/debug/events`);
    expect(res.ok).toBe(true);

    const body = await res.json();
    expect(body.events).toBeInstanceOf(Array);
    expect(body.events.length).toBeGreaterThanOrEqual(2);
    expect(body.events[body.events.length - 1]).toMatchObject({
      type: "statusChange",
      data: { agentId: "test-agent", status: "idle" },
    });
  });
});
