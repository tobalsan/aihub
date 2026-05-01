import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_UPLOAD_SIZE_BYTES,
  downloadSlackFile,
  extractSnippetText,
  formatSlackFileError,
  getSlackFileMimeType,
  isSupportedSlackFile,
  isSlackSnippet,
  uploadSlackFileToMedia,
  type SlackFile,
} from "./attachments.js";

describe("Slack attachment helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("allows the v1 Slack file MIME set", () => {
    const supported = [
      ["photo.jpg", "image/jpeg"],
      ["photo.png", "image/png"],
      ["photo.gif", "image/gif"],
      ["photo.webp", "image/webp"],
      ["doc.pdf", "application/pdf"],
      [
        "doc.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ],
      [
        "sheet.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ],
    ] satisfies Array<[string, string]>;

    for (const [name, mimetype] of supported) {
      expect(isSupportedSlackFile({ name, mimetype })).toBe(true);
    }
  });

  it("rejects MIME types outside the v1 allowlist", () => {
    expect(
      isSupportedSlackFile({ name: "archive.zip", mimetype: "application/zip" })
    ).toBe(false);
    expect(
      isSupportedSlackFile({ name: "notes.txt", mimetype: "text/plain" })
    ).toBe(false);
  });

  it("rejects supported extensions with unsupported or mismatched MIME types", () => {
    expect(
      isSupportedSlackFile({ name: "doc.pdf", mimetype: "text/plain" })
    ).toBe(false);
    expect(
      isSupportedSlackFile({
        name: "doc.pdf",
        mimetype:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      })
    ).toBe(false);
    expect(
      isSupportedSlackFile({
        name: "sheet.xlsx",
        mimetype: "application/pdf",
      })
    ).toBe(false);
  });

  it("keeps extension fallback when Slack omits MIME type", () => {
    expect(isSupportedSlackFile({ name: "sheet.xlsx" })).toBe(true);
  });

  it("extracts Slack snippets as inline code text", () => {
    const file: SlackFile = {
      name: "example.ts",
      mode: "snippet",
      mimetype: "text/plain",
      preview: "const x = 1;",
    };

    expect(isSlackSnippet(file)).toBe(true);
    expect(extractSnippetText(file)).toContain("Snippet: example.ts");
    expect(extractSnippetText(file)).toContain("const x = 1;");
  });

  it("downloads Slack files with bot-token auth", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await downloadSlackFile(
      {
        name: "screen.png",
        mimetype: "image/png",
        url_private_download: "https://files.slack.test/screen.png",
      },
      "xoxb-token"
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://files.slack.test/screen.png",
      { headers: { Authorization: "Bearer xoxb-token" } }
    );
    expect(result).toEqual({
      buffer: Buffer.from([1, 2, 3]),
      mimeType: "image/png",
      filename: "screen.png",
    });
  });

  it("rejects downloaded files over 25MB", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(new Uint8Array(MAX_UPLOAD_SIZE_BYTES + 1), {
          status: 200,
        })
      )
    );

    await expect(
      downloadSlackFile(
        {
          name: "large.pdf",
          mimetype: "application/pdf",
          url_private_download: "https://files.slack.test/large.pdf",
        },
        "xoxb-token"
      )
    ).rejects.toThrow("25MB");
  });

  it("maps extension-only files to the expected MIME type", () => {
    expect(getSlackFileMimeType({ name: "sheet.xlsx" })).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
  });

  it("uploads downloaded files through the media context", async () => {
    const saveMediaFile = vi.fn().mockResolvedValue({
      path: "/media/inbound/file.png",
      mimeType: "image/png",
      filename: "file.png",
      size: 3,
    });

    await expect(
      uploadSlackFileToMedia(
        {
          buffer: Buffer.from([1, 2, 3]),
          mimeType: "image/png",
          filename: "file.png",
        },
        saveMediaFile
      )
    ).resolves.toEqual({
      path: "/media/inbound/file.png",
      mimeType: "image/png",
      filename: "file.png",
      size: 3,
    });
    expect(saveMediaFile).toHaveBeenCalledWith(
      Buffer.from([1, 2, 3]),
      "image/png",
      "file.png"
    );
  });

  it("formats visible Slack file errors", () => {
    expect(formatSlackFileError({ name: "bad.zip" }, "Unsupported")).toBe(
      "Could not process bad.zip: Unsupported"
    );
  });
});
