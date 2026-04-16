import path from "node:path";
import type { FileAttachment } from "@aihub/shared";
import { extractText } from "../media/extract.js";

export function isImageAttachment(attachment: FileAttachment): boolean {
  return attachment.mimeType.startsWith("image/");
}

export function getAttachmentFilename(attachment: FileAttachment): string {
  return attachment.filename ?? path.basename(attachment.path);
}

export async function buildDocumentAttachmentContext(
  attachments: FileAttachment[] | undefined
): Promise<string> {
  const documents = (attachments ?? []).filter(
    (attachment) => !isImageAttachment(attachment)
  );
  if (documents.length === 0) return "";

  const blocks: string[] = [];
  for (const attachment of documents) {
    let text: string | null;
    try {
      text = await extractText(attachment.path, attachment.mimeType);
    } catch {
      continue;
    }
    if (!text?.trim()) continue;
    blocks.push(
      [
        `File: ${getAttachmentFilename(attachment)}`,
        `MIME type: ${attachment.mimeType}`,
        "",
        text.trim(),
      ].join("\n")
    );
  }

  if (blocks.length === 0) return "";
  return `Attached document text:\n\n${blocks.join("\n\n---\n\n")}`;
}

export function appendAttachmentContext(
  message: string,
  attachmentContext: string
): string {
  if (!attachmentContext) return message;
  return `${message}\n\n${attachmentContext}`;
}
