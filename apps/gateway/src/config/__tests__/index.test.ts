import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearConfigCacheForTests,
  getConfigPath,
  loadConfig,
} from "../index.js";

describe("config loading", () => {
  const prevConfig = process.env.AIHUB_CONFIG;
  const prevHome = process.env.AIHUB_HOME;

  afterEach(() => {
    clearConfigCacheForTests();
    if (prevConfig === undefined) delete process.env.AIHUB_CONFIG;
    else process.env.AIHUB_CONFIG = prevConfig;
    if (prevHome === undefined) delete process.env.AIHUB_HOME;
    else process.env.AIHUB_HOME = prevHome;
  });

  it("honors AIHUB_HOME when loading config", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aihub-config-"));
    const configPath = path.join(tmpDir, "aihub.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        version: 2,
        agents: [
          {
            id: "custom",
            name: "Custom",
            workspace: "~/agents/custom",
            model: { provider: "anthropic", model: "claude" },
          },
        ],
      })
    );

    process.env.AIHUB_HOME = tmpDir;

    expect(getConfigPath()).toBe(configPath);
    expect(loadConfig().agents.map((agent) => agent.id)).toEqual(["custom"]);
  });
});
