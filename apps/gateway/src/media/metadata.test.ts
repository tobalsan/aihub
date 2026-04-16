import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

describe("media metadata", () => {
  let tmpDir: string;
  let prevAihubHome: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aihub-media-meta-"));
    prevAihubHome = process.env.AIHUB_HOME;
    process.env.AIHUB_HOME = tmpDir;
    vi.resetModules();
  });

  afterEach(async () => {
    if (prevAihubHome === undefined) delete process.env.AIHUB_HOME;
    else process.env.AIHUB_HOME = prevAihubHome;

    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("registers inbound and outbound files", async () => {
    const {
      MEDIA_INBOUND_DIR,
      MEDIA_OUTBOUND_DIR,
      getMediaFileMetadata,
      registerMediaFile,
    } = await import("./metadata.js");

    const inbound = await registerMediaFile({
      direction: "inbound",
      fileId: "in-1",
      filename: "source.pdf",
      storedFilename: "in-1.pdf",
      path: path.join(MEDIA_INBOUND_DIR, "in-1.pdf"),
      mimeType: "application/pdf",
      size: 10,
      sessionId: "session-1",
    });
    const outbound = await registerMediaFile({
      direction: "outbound",
      fileId: "out-1",
      filename: "report.csv",
      storedFilename: "out-1.csv",
      path: path.join(MEDIA_OUTBOUND_DIR, "out-1.csv"),
      mimeType: "text/csv",
      size: 20,
      agentId: "agent-1",
    });

    await expect(fs.stat(MEDIA_OUTBOUND_DIR)).resolves.toBeTruthy();
    await expect(getMediaFileMetadata("in-1")).resolves.toMatchObject({
      fileId: inbound.fileId,
      direction: inbound.direction,
      filename: inbound.filename,
      storedFilename: inbound.storedFilename,
      path: inbound.path,
      mimeType: inbound.mimeType,
      size: inbound.size,
      createdAt: inbound.createdAt,
      sessionId: inbound.sessionId,
    });
    await expect(getMediaFileMetadata("out-1")).resolves.toMatchObject({
      fileId: outbound.fileId,
      direction: outbound.direction,
      filename: outbound.filename,
      storedFilename: outbound.storedFilename,
      path: outbound.path,
      mimeType: outbound.mimeType,
      size: outbound.size,
      createdAt: outbound.createdAt,
      agentId: outbound.agentId,
    });
  });
});
