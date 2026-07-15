import { afterEach, describe, expect, it, vi } from "vitest";
import { collectDiscordAttachments, isSupportedDiscordAttachment, MAX_UPLOAD_SIZE_BYTES } from "./attachments.js";

describe("Discord attachments", () => {
  it("allows supported image and document files and rejects mismatched MIME types", () => {
    expect(isSupportedDiscordAttachment({ filename: "screen.png", url: "https://cdn.test/a", content_type: "image/png" })).toBe(true);
    expect(isSupportedDiscordAttachment({ filename: "report.pdf", url: "https://cdn.test/b", content_type: "application/pdf" })).toBe(true);
    expect(isSupportedDiscordAttachment({ filename: "report.pdf", url: "https://cdn.test/c", content_type: "text/plain" })).toBe(false);
  });

  afterEach(() => vi.restoreAllMocks());

  it("downloads supported files and reports rejected files", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2]), { status: 200 })));
    const saveMediaFile = vi.fn().mockResolvedValue({ path: "/media/screen.png", mimeType: "image/png" });
    const result = await collectDiscordAttachments([
      { filename: "screen.png", url: "https://cdn.test/screen", content_type: "image/png" },
      { filename: "notes.txt", url: "https://cdn.test/notes", content_type: "text/plain" },
      { filename: "large.pdf", url: "https://cdn.test/large", content_type: "application/pdf", size: MAX_UPLOAD_SIZE_BYTES + 1 },
    ], saveMediaFile);

    expect(saveMediaFile).toHaveBeenCalledWith(new Uint8Array([1, 2]), "image/png", "screen.png");
    expect(result.attachments).toHaveLength(1);
    expect(result.errors).toEqual([
      "Could not process notes.txt: Unsupported file type text/plain",
      "Could not process large.pdf: File exceeds the 25MB upload limit",
    ]);
  });
});
