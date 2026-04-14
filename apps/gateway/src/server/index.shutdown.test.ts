import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import os from "node:os";

describe("gateway graceful shutdown", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("registers SIGTERM/SIGINT handlers and cleans up containers", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aihub-shutdown-"));
    const prevHome = process.env.HOME;
    const prevUserProfile = process.env.USERPROFILE;

    process.env.HOME = tmpDir;
    process.env.USERPROFILE = tmpDir;

    await fs.mkdir(path.join(tmpDir, ".aihub"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, ".aihub", "aihub.json"),
      JSON.stringify({
        agents: [
          {
            id: "test-agent",
            name: "Test Agent",
            workspace: "~/test",
            model: { provider: "anthropic", model: "claude" },
          },
        ],
      })
    );

    const cleanupOrphanContainers = vi.fn();
    vi.doMock("../agents/container.js", async () => {
      const actual = await vi.importActual<typeof import("../agents/container.js")>(
        "../agents/container.js"
      );
      return {
        ...actual,
        cleanupOrphanContainers,
      };
    });

    const onSpy = vi.spyOn(process, "on");
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);

    const { startServer } = await import("./index.js");
    const server = startServer(0, "127.0.0.1");
    const closeSpy = vi.spyOn(server, "close");

    const sigtermCall = onSpy.mock.calls.find(([event]) => event === "SIGTERM");
    const sigintCall = onSpy.mock.calls.find(([event]) => event === "SIGINT");

    expect(sigtermCall).toBeTruthy();
    expect(sigintCall).toBeTruthy();

    const shutdown = sigtermCall?.[1] as () => Promise<void>;
    await shutdown();

    expect(cleanupOrphanContainers).toHaveBeenCalledTimes(1);
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);

    if (sigtermCall) process.off("SIGTERM", sigtermCall[1]);
    if (sigintCall) process.off("SIGINT", sigintCall[1]);

    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevUserProfile;

    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});
