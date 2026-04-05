import fs from "node:fs/promises";
import path from "node:path";

export function legacySessionFileName(
  agentId: string,
  sessionId: string
): string {
  return `${agentId}-${sessionId}.jsonl`;
}

export function formatSessionTimestamp(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number, len = 2) => n.toString().padStart(len, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(
    d.getUTCDate()
  )}T${pad(d.getUTCHours())}-${pad(d.getUTCMinutes())}-${pad(
    d.getUTCSeconds()
  )}-${pad(d.getUTCMilliseconds(), 3)}Z`;
}

export function timestampedSessionFileName(
  timestamp: number,
  agentId: string,
  sessionId: string
): string {
  return `${formatSessionTimestamp(timestamp)}_${agentId}-${sessionId}.jsonl`;
}

export async function findTimestampedSessionFile(
  dir: string,
  agentId: string,
  sessionId: string
): Promise<string | null> {
  const suffix = `_${agentId}-${sessionId}.jsonl`;
  try {
    const files = await fs.readdir(dir);
    const match = files.filter((file) => file.endsWith(suffix)).sort().at(-1);
    return match ? path.join(dir, match) : null;
  } catch {
    return null;
  }
}

export async function resolveSessionDataFile(params: {
  dir: string;
  agentId: string;
  sessionId: string;
  createdAt?: number;
  createIfMissing: boolean;
}): Promise<string | null> {
  const { dir, agentId, sessionId, createdAt, createIfMissing } = params;

  if (createIfMissing) {
    await fs.mkdir(dir, { recursive: true });
  }

  if (createdAt) {
    const exactPath = path.join(
      dir,
      timestampedSessionFileName(createdAt, agentId, sessionId)
    );
    try {
      await fs.access(exactPath);
      return exactPath;
    } catch {
      // Continue to broader lookup.
    }
  }

  const timestampedPath = await findTimestampedSessionFile(dir, agentId, sessionId);
  if (timestampedPath) {
    return timestampedPath;
  }

  const legacyPath = path.join(dir, legacySessionFileName(agentId, sessionId));
  try {
    await fs.access(legacyPath);
    return legacyPath;
  } catch {
    if (!createIfMissing) {
      return null;
    }
  }

  return path.join(
    dir,
    timestampedSessionFileName(createdAt ?? Date.now(), agentId, sessionId)
  );
}
