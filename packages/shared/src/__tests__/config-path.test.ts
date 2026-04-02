import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getDefaultConfigPath, resolveConfigPath } from "../config-path.js";

describe("config path helpers", () => {
  const prevConfig = process.env.AIHUB_CONFIG;

  afterEach(() => {
    if (prevConfig === undefined) delete process.env.AIHUB_CONFIG;
    else process.env.AIHUB_CONFIG = prevConfig;
  });

  it("returns the default config path", () => {
    expect(getDefaultConfigPath()).toBe(
      path.join(os.homedir(), ".aihub", "aihub.json")
    );
  });

  it("prefers explicit config path", () => {
    process.env.AIHUB_CONFIG = "/tmp/from-env.json";

    expect(resolveConfigPath("/tmp/from-arg.json")).toBe(
      path.resolve("/tmp/from-arg.json")
    );
  });

  it("falls back to AIHUB_CONFIG", () => {
    process.env.AIHUB_CONFIG = "~/custom/aihub.json";

    expect(resolveConfigPath()).toBe(
      path.join(os.homedir(), "custom/aihub.json")
    );
  });
});
