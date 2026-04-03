import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getDefaultConfigPath,
  resolveConfigPath,
  resolveHomeDir,
} from "../config-path.js";

describe("config path helpers", () => {
  const prevConfig = process.env.AIHUB_CONFIG;
  const prevHome = process.env.AIHUB_HOME;

  afterEach(() => {
    if (prevConfig === undefined) delete process.env.AIHUB_CONFIG;
    else process.env.AIHUB_CONFIG = prevConfig;
    if (prevHome === undefined) delete process.env.AIHUB_HOME;
    else process.env.AIHUB_HOME = prevHome;
    vi.restoreAllMocks();
  });

  it("returns the default home and config path", () => {
    delete process.env.AIHUB_HOME;
    delete process.env.AIHUB_CONFIG;

    expect(resolveHomeDir()).toBe(path.join(os.homedir(), ".aihub"));
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

  it("uses AIHUB_HOME for home and default config path", () => {
    process.env.AIHUB_HOME = "~/custom-home";
    delete process.env.AIHUB_CONFIG;

    expect(resolveHomeDir()).toBe(path.join(os.homedir(), "custom-home"));
    expect(getDefaultConfigPath()).toBe(
      path.join(os.homedir(), "custom-home", "aihub.json")
    );
    expect(resolveConfigPath()).toBe(
      path.join(os.homedir(), "custom-home", "aihub.json")
    );
  });

  it("falls back to AIHUB_CONFIG directory with a deprecation warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.AIHUB_CONFIG = "~/custom/aihub.json";
    delete process.env.AIHUB_HOME;

    expect(resolveHomeDir()).toBe(path.join(os.homedir(), "custom"));
    expect(getDefaultConfigPath()).toBe(
      path.join(os.homedir(), "custom", "aihub.json")
    );
    expect(resolveConfigPath()).toBe(
      path.join(os.homedir(), "custom", "aihub.json")
    );
    expect(warn).toHaveBeenCalledWith(
      "[config] AIHUB_CONFIG is deprecated; set AIHUB_HOME to the containing directory instead."
    );
  });
});
