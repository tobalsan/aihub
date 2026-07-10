import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import os from "node:os";
import { writeTestV3Config } from "../test-utils/v3-config.js";

describe("/capabilities API", () => {
  let tmpDir: string;
  let prevAihubHome: string | undefined;
  let prevHome: string | undefined;
  let prevUserProfile: string | undefined;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aihub-capabilities-"));
    prevAihubHome = process.env.AIHUB_HOME;
    prevHome = process.env.HOME;
    prevUserProfile = process.env.USERPROFILE;
    process.env.AIHUB_HOME = path.join(tmpDir, ".aihub");
    process.env.HOME = tmpDir;
    process.env.USERPROFILE = tmpDir;

    await writeTestV3Config(path.join(tmpDir, ".aihub"), {
      agents: [{ id: "main", name: "Main" }],
      extensions: {
        scheduler: { enabled: true },
      },
    });

    vi.resetModules();
    const { clearConfigCacheForTests, loadConfig } =
      await import("../config/index.js");
    clearConfigCacheForTests();
    const { loadExtensions } = await import("../extensions/registry.js");
    await loadExtensions(loadConfig());
  });

  afterAll(async () => {
    if (prevAihubHome === undefined) delete process.env.AIHUB_HOME;
    else process.env.AIHUB_HOME = prevAihubHome;
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
      // only configured extensions load (heartbeat absent from config)
      extensions: { scheduler: true },
      agents: ["main"],
      multiUser: false,
      forkedAgents: false,
      agentFab: false,
    });
  });
});
