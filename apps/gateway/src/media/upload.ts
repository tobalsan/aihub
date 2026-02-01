import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

// Directory for storing inbound media files
export const MEDIA_INBOUND_DIR = path.join(os.homedir(), ".aihub", "media", "inbound");

// Allowed MIME types for upload
const ALLOWED_MIME_TYPES = new Set([
  // Images
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  // Documents
  "application/pdf",
  "text/markdown",
  "text/plain",
  // Office formats
  "application/msword", // .doc
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/vnd.ms-excel", // .xls
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.ms-powerpoint", // .ppt
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
  // Code/text
  "text/csv",
  "application/json",
  "text/html",
  "text/css",
  "text/javascript",
  "application/javascript",
]);

// Extension mapping for common types
const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
  "text/markdown": "md",
  "text/plain": "txt",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/csv": "csv",
  "application/json": "json",
  "text/html": "html",
  "text/css": "css",
  "text/javascript": "js",
  "application/javascript": "js",
};

export interface UploadResult {
  path: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface UploadError {
  error: string;
}

/**
 * Check if a MIME type is allowed for upload
 */
export function isAllowedMimeType(mimeType: string): boolean {
  return ALLOWED_MIME_TYPES.has(mimeType);
}

/**
 * Get file extension from MIME type
 */
function getExtensionFromMime(mimeType: string, originalFilename?: string): string {
  // Try to get extension from original filename first
  if (originalFilename) {
    const ext = path.extname(originalFilename).slice(1).toLowerCase();
    if (ext) return ext;
  }
  // Fall back to MIME type mapping
  return MIME_TO_EXT[mimeType] || "bin";
}

/**
 * Save uploaded file to disk
 */
export async function saveUploadedFile(
  data: ArrayBuffer | Buffer,
  mimeType: string,
  originalFilename?: string
): Promise<UploadResult> {
  // Ensure directory exists
  await fs.mkdir(MEDIA_INBOUND_DIR, { recursive: true });

  const ext = getExtensionFromMime(mimeType, originalFilename);
  const filename = `${randomUUID()}.${ext}`;
  const filepath = path.join(MEDIA_INBOUND_DIR, filename);

  // Write file
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  await fs.writeFile(filepath, buffer);

  return {
    path: filepath,
    filename,
    mimeType,
    size: buffer.length,
  };
}

/**
 * List allowed MIME types (for documentation/validation)
 */
export function getAllowedMimeTypes(): string[] {
  return Array.from(ALLOWED_MIME_TYPES);
}
