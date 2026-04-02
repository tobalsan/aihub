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

  afterEach(() => {
    clearConfigCacheForTests();
    if (prevConfig === undefined) delete process.env.AIHUB_CONFIG;
    else process.env.AIHUB_CONFIG = prevConfig;
  });

  it("honors AIHUB_CONFIG when loading config", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aihub-config-"));
    const configPath = path.join(tmpDir, "custom.json");
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

    process.env.AIHUB_CONFIG = configPath;

    expect(getConfigPath()).toBe(configPath);
    expect(loadConfig().agents.map((agent) => agent.id)).toEqual(["custom"]);
  });
});
