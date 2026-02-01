import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import os from "node:os";

describe("media upload API", () => {
  let tmpDir: string;
  let api: { request: (input: RequestInfo, init?: RequestInit) => Response | Promise<Response> };
  let prevHome: string | undefined;
  let prevUserProfile: string | undefined;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aihub-media-"));

    prevHome = process.env.HOME;
    prevUserProfile = process.env.USERPROFILE;
    process.env.HOME = tmpDir;
    process.env.USERPROFILE = tmpDir;

    vi.resetModules();
    const mod = await import("../server/api.js");
    api = mod.api;
  });

  afterAll(async () => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevUserProfile;

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("uploads allowed image files", async () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    const file = new File([data], "test.png", { type: "image/png" });
    const formData = new FormData();
    formData.set("file", file);

    const res = await Promise.resolve(api.request("/media/upload", {
      method: "POST",
      body: formData,
    }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.mimeType).toBe("image/png");
    expect(json.size).toBe(data.length);
    expect(json.path).toContain(path.join(".aihub", "media", "inbound"));

    const saved = await fs.readFile(json.path);
    expect(saved.length).toBe(data.length);
  });

  it("rejects unsupported file types", async () => {
    const file = new File([new Uint8Array([9])], "test.bin", { type: "application/x-foo" });
    const formData = new FormData();
    formData.set("file", file);

    const res = await Promise.resolve(api.request("/media/upload", {
      method: "POST",
      body: formData,
    }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Unsupported file type");
    expect(Array.isArray(json.allowedTypes)).toBe(true);
  });
});
