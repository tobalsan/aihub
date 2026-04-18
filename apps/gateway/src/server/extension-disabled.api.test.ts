import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import os from "node:os";

describe("extension-disabled API responses", () => {
  let tmpDir: string;
  let prevHome: string | undefined;
  let prevUserProfile: string | undefined;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aihub-component-404-"));
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
        extensions: {},
      })
    );

    vi.resetModules();
    const { clearConfigCacheForTests } = await import("../config/index.js");
    clearConfigCacheForTests();
  });

  afterAll(async () => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevUserProfile;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns a structured 404 for disabled extension routes", async () => {
    const { app } = await import("./index.js");

    const response = await Promise.resolve(app.request("/api/projects"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "extension_disabled",
      extension: "projects",
    });
  });
});
