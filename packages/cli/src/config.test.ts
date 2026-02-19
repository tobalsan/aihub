import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveConfig } from "./config.js";

describe("cli config", () => {
  let prevHome: string | undefined;
  let prevApiUrl: string | undefined;
  let prevUrl: string | undefined;
  let prevToken: string | undefined;
  let tmpHome = "";

  beforeEach(async () => {
    prevHome = process.env.HOME;
    prevApiUrl = process.env.AIHUB_API_URL;
    prevUrl = process.env.AIHUB_URL;
    prevToken = process.env.AIHUB_TOKEN;

    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "aihub-cli-test-"));
    process.env.HOME = tmpHome;
    delete process.env.AIHUB_API_URL;
    delete process.env.AIHUB_URL;
    delete process.env.AIHUB_TOKEN;
  });

  afterEach(async () => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevApiUrl === undefined) delete process.env.AIHUB_API_URL;
    else process.env.AIHUB_API_URL = prevApiUrl;
    if (prevUrl === undefined) delete process.env.AIHUB_URL;
    else process.env.AIHUB_URL = prevUrl;
    if (prevToken === undefined) delete process.env.AIHUB_TOKEN;
    else process.env.AIHUB_TOKEN = prevToken;

    await fs.rm(tmpHome, { recursive: true, force: true });
  });

  it("uses AIHUB_API_URL over AIHUB_URL and config file", async () => {
    await fs.mkdir(path.join(tmpHome, ".aihub"), { recursive: true });
    await fs.writeFile(
      path.join(tmpHome, ".aihub", "config.json"),
      JSON.stringify({ apiUrl: "http://file-url", token: "file-token" })
    );

    process.env.AIHUB_URL = "http://env-url";
    process.env.AIHUB_API_URL = "http://api-url";
    process.env.AIHUB_TOKEN = "env-token";

    expect(resolveConfig()).toEqual({
      apiUrl: "http://api-url",
      token: "env-token",
    });
  });

  it("uses config file when env is missing", async () => {
    await fs.mkdir(path.join(tmpHome, ".aihub"), { recursive: true });
    await fs.writeFile(
      path.join(tmpHome, ".aihub", "config.json"),
      JSON.stringify({ apiUrl: "http://from-file", token: "file-token" })
    );

    expect(resolveConfig()).toEqual({
      apiUrl: "http://from-file",
      token: "file-token",
    });
  });

  it("uses AIHUB_URL when AIHUB_API_URL is not set", () => {
    process.env.AIHUB_URL = "http://legacy-url";
    expect(resolveConfig()).toEqual({ apiUrl: "http://legacy-url" });
  });

  it("throws when no API URL is configured", () => {
    expect(() => resolveConfig()).toThrow(/Missing AIHub API URL/);
  });
});
