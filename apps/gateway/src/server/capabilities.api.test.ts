import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import os from "node:os";

describe("/capabilities API", () => {
  let tmpDir: string;
  let prevHome: string | undefined;
  let prevUserProfile: string | undefined;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aihub-capabilities-"));
    prevHome = process.env.HOME;
    prevUserProfile = process.env.USERPROFILE;
    process.env.HOME = tmpDir;
    process.env.USERPROFILE = tmpDir;

    await fs.mkdir(path.join(tmpDir, ".aihub"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, ".aihub", "aihub.json"),
      JSON.stringify({
        version: 2,
        agents: [
          {
            id: "main",
            name: "Main",
            workspace: "~/agents/main",
            model: { provider: "anthropic", model: "claude" },
          },
        ],
        extensions: {
          scheduler: { enabled: true, tickSeconds: 60 },
        },
      })
    );

    vi.resetModules();
    const { clearConfigCacheForTests, loadConfig } =
      await import("../config/index.js");
    clearConfigCacheForTests();
    const { loadExtensions } = await import("../extensions/registry.js");
    await loadExtensions(loadConfig());
  });

  afterAll(async () => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevUserProfile;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns loaded component and agent ids", async () => {
    const { api } = await import("./api.core.js");

    const response = await Promise.resolve(api.request("/capabilities"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      version: 2,
      extensions: { scheduler: true },
      agents: ["main"],
      multiUser: false,
    });
  });
});
