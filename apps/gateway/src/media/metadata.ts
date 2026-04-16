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

export function getMediaDir(): string {
  return path.join(resolveHomeDir(), "media");
}

export function getMediaInboundDir(): string {
  return path.join(getMediaDir(), "inbound");
}

export function getMediaOutboundDir(): string {
  return path.join(getMediaDir(), "outbound");
}

export function getMetadataPath(): string {
  return path.join(getMediaDir(), "metadata.json");
}

export const MEDIA_DIR = getMediaDir();
export const MEDIA_INBOUND_DIR = getMediaInboundDir();
export const MEDIA_OUTBOUND_DIR = getMediaOutboundDir();
export const MEDIA_METADATA_PATH = getMetadataPath();

export async function ensureMediaDirectories(): Promise<void> {
  await Promise.all([
    fs.mkdir(getMediaInboundDir(), { recursive: true }),
    fs.mkdir(getMediaOutboundDir(), { recursive: true }),
  ]);
}

export async function readMediaMetadata(): Promise<MediaMetadataStore> {
  try {
    const raw = await fs.readFile(getMetadataPath(), "utf8");
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
  const metadataPath = getMetadataPath();
  await fs.mkdir(getMediaDir(), { recursive: true });
  const tempPath = `${metadataPath}.${process.pid}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(metadata, null, 2)}\n`);
  await fs.rename(tempPath, metadataPath);
}

function isNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
