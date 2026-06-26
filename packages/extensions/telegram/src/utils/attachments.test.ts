import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_UPLOAD_SIZE_BYTES,
  downloadTelegramFile,
  formatTelegramFileError,
  getTelegramFilename,
  getTelegramMimeType,
  uploadTelegramFileToMedia,
  type TelegramMediaItem,
} from "./attachments.js";

const photo: TelegramMediaItem = { fileId: "p1", kind: "photo" };
const document: TelegramMediaItem = {
  fileId: "d1",
  kind: "document",
  filename: "server.log",
  mimeType: "text/plain",
  size: 1024,
};

describe("getTelegramFilename", () => {
  it("uses the declared document filename", () => {
    expect(getTelegramFilename(document)).toBe("server.log");
  });

  it("synthesizes a jpg name for photos", () => {
    expect(getTelegramFilename(photo)).toBe("photo.jpg");
  });

  it("derives the extension from a document mime type when unnamed", () => {
    expect(
      getTelegramFilename({
        fileId: "d2",
        kind: "document",
        mimeType: "application/pdf",
      })
    ).toBe("document.pdf");
  });
});

describe("getTelegramMimeType", () => {
  it("prefers the declared mime type", () => {
    expect(getTelegramMimeType(document)).toBe("text/plain");
  });

  it("defaults photos to jpeg", () => {
    expect(getTelegramMimeType(photo)).toBe("image/jpeg");
  });

  it("infers from the filename extension", () => {
    expect(
      getTelegramMimeType({ fileId: "d3", kind: "document", filename: "a.png" })
    ).toBe("image/png");
  });

  it("falls back to octet-stream for unknown documents", () => {
    expect(
      getTelegramMimeType({ fileId: "d4", kind: "document", filename: "a.bin" })
    ).toBe("application/octet-stream");
  });
});

describe("downloadTelegramFile", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("downloads via the resolved file path", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }) as never;
    const getFilePath = vi.fn().mockResolvedValue("photos/file_1.jpg");

    const result = await downloadTelegramFile(photo, "TOKEN", getFilePath);

    expect(getFilePath).toHaveBeenCalledWith("p1");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.telegram.org/file/botTOKEN/photos/file_1.jpg"
    );
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.filename).toBe("photo.jpg");
    expect(result.buffer).toEqual(Buffer.from([1, 2, 3]));
  });

  it("throws when the file path cannot be resolved", async () => {
    const getFilePath = vi.fn().mockResolvedValue(undefined);
    await expect(
      downloadTelegramFile(photo, "TOKEN", getFilePath)
    ).rejects.toThrow(/download path/);
  });

  it("throws when the download responds with an error status", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as never;
    const getFilePath = vi.fn().mockResolvedValue("p.jpg");
    await expect(
      downloadTelegramFile(photo, "TOKEN", getFilePath)
    ).rejects.toThrow(/500/);
  });

  it("rejects payloads larger than the limit", async () => {
    const big = new Uint8Array(MAX_UPLOAD_SIZE_BYTES + 1);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => big.buffer,
    }) as never;
    const getFilePath = vi.fn().mockResolvedValue("p.jpg");
    await expect(
      downloadTelegramFile(photo, "TOKEN", getFilePath)
    ).rejects.toThrow(/20MB/);
  });
});

describe("uploadTelegramFileToMedia", () => {
  it("forwards the buffer, mime type, and filename to saveMediaFile", async () => {
    const saveMediaFile = vi
      .fn()
      .mockResolvedValue({ path: "/tmp/x", mimeType: "image/png" });
    await uploadTelegramFileToMedia(
      { buffer: Buffer.from([9]), mimeType: "image/png", filename: "x.png" },
      saveMediaFile
    );
    expect(saveMediaFile).toHaveBeenCalledWith(
      Buffer.from([9]),
      "image/png",
      "x.png"
    );
  });
});

describe("formatTelegramFileError", () => {
  it("names the file and the reason", () => {
    expect(formatTelegramFileError(document, "too big")).toBe(
      "Could not process server.log: too big"
    );
  });
});
