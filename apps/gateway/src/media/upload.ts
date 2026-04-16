import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  ensureMediaDirectories,
  MEDIA_INBOUND_DIR,
  registerMediaFile,
} from "./metadata.js";

export { MEDIA_INBOUND_DIR };

export const MAX_UPLOAD_SIZE_BYTES = 25 * 1024 * 1024;

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
  "text/csv",
  // Office formats
  "application/msword", // .doc
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/vnd.ms-excel", // .xls
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
]);

const MIME_TO_EXTENSIONS: Record<string, string[]> = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/gif": ["gif"],
  "image/webp": ["webp"],
  "image/svg+xml": ["svg"],
  "application/pdf": ["pdf"],
  "text/markdown": ["md", "markdown"],
  "text/plain": ["txt"],
  "text/csv": ["csv"],
  "application/msword": ["doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
    "docx",
  ],
  "application/vnd.ms-excel": ["xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
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

export class UploadTooLargeError extends Error {
  constructor(size: number) {
    super(
      `File size ${size} bytes exceeds the ${MAX_UPLOAD_SIZE_BYTES} byte limit`
    );
    this.name = "UploadTooLargeError";
  }
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
function getExtensionFromMime(
  mimeType: string,
  originalFilename?: string
): string {
  const allowedExtensions = MIME_TO_EXTENSIONS[mimeType] ?? [];

  if (originalFilename) {
    const ext = path.extname(originalFilename).slice(1).toLowerCase();
    if (allowedExtensions.includes(ext)) return ext;
  }

  return allowedExtensions[0] ?? "bin";
}

function sanitizeFilename(
  filename: string | undefined,
  fallback: string
): string {
  if (!filename) return fallback;

  const cleaned = filename
    .replace(/\0/g, "")
    .split(/[\\/]/)
    .filter(Boolean)
    .at(-1);

  return cleaned || fallback;
}

/**
 * Save uploaded file to disk
 */
export async function saveUploadedFile(
  data: ArrayBuffer | Buffer,
  mimeType: string,
  originalFilename?: string
): Promise<UploadResult> {
  const ext = getExtensionFromMime(mimeType, originalFilename);
  const fileId = randomUUID();
  const filename = `${fileId}.${ext}`;
  const filepath = path.join(MEDIA_INBOUND_DIR, filename);

  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (buffer.length > MAX_UPLOAD_SIZE_BYTES) {
    throw new UploadTooLargeError(buffer.length);
  }

  await ensureMediaDirectories();
  await fs.writeFile(filepath, buffer);
  await registerMediaFile({
    direction: "inbound",
    fileId,
    filename: sanitizeFilename(originalFilename, filename),
    storedFilename: filename,
    path: filepath,
    mimeType,
    size: buffer.length,
  });

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
