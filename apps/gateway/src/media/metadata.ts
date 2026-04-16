import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveHomeDir } from "@aihub/shared";

export type MediaDirection = "inbound" | "outbound";

export type MediaFileMetadata = {
  fileId: string;
  direction: MediaDirection;
  filename: string;
  storedFilename: string;
  path: string;
  mimeType: string;
  size: number;
  createdAt: string;
  agentId?: string;
  sessionId?: string;
};

export type MediaMetadataStore = Record<string, MediaFileMetadata>;

export const MEDIA_DIR = path.join(resolveHomeDir(), "media");
export const MEDIA_INBOUND_DIR = path.join(MEDIA_DIR, "inbound");
export const MEDIA_OUTBOUND_DIR = path.join(MEDIA_DIR, "outbound");
export const MEDIA_METADATA_PATH = path.join(MEDIA_DIR, "metadata.json");

export async function ensureMediaDirectories(): Promise<void> {
  await Promise.all([
    fs.mkdir(MEDIA_INBOUND_DIR, { recursive: true }),
    fs.mkdir(MEDIA_OUTBOUND_DIR, { recursive: true }),
  ]);
}

export async function readMediaMetadata(): Promise<MediaMetadataStore> {
  try {
    const raw = await fs.readFile(MEDIA_METADATA_PATH, "utf8");
    return JSON.parse(raw) as MediaMetadataStore;
  } catch (error) {
    if (isNotFoundError(error)) return {};
    throw error;
  }
}

export async function getMediaFileMetadata(
  fileId: string
): Promise<MediaFileMetadata | null> {
  const metadata = await readMediaMetadata();
  return metadata[fileId] ?? null;
}

export async function registerMediaFile(input: {
  direction: MediaDirection;
  filename: string;
  storedFilename: string;
  path: string;
  mimeType: string;
  size: number;
  fileId?: string;
  agentId?: string;
  sessionId?: string;
}): Promise<MediaFileMetadata> {
  await ensureMediaDirectories();

  const fileId = input.fileId ?? randomUUID();
  const entry: MediaFileMetadata = {
    fileId,
    direction: input.direction,
    filename: input.filename,
    storedFilename: input.storedFilename,
    path: input.path,
    mimeType: input.mimeType,
    size: input.size,
    createdAt: new Date().toISOString(),
    agentId: input.agentId,
    sessionId: input.sessionId,
  };

  const metadata = await readMediaMetadata();
  metadata[fileId] = entry;
  await writeMediaMetadata(metadata);

  return entry;
}

async function writeMediaMetadata(metadata: MediaMetadataStore): Promise<void> {
  await fs.mkdir(MEDIA_DIR, { recursive: true });
  const tempPath = `${MEDIA_METADATA_PATH}.${process.pid}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(metadata, null, 2)}\n`);
  await fs.rename(tempPath, MEDIA_METADATA_PATH);
}

function isNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
