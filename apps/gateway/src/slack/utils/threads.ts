import type { SlackThreadPolicy, SlackWebClient } from "../types.js";

export type ThreadParentInfo = {
  author: string;
  content: string;
  timestamp: number;
};

const threadParentCache = new Map<string, ThreadParentInfo>();

function cacheKey(channel: string, threadTs: string): string {
  return `${channel}:${threadTs}`;
}

function slackTsToMs(ts: string | undefined): number {
  if (!ts) return Date.now();
  const parsed = Number(ts) * 1000;
  return Number.isFinite(parsed) ? parsed : Date.now();
}

export async function getThreadParent(
  client: SlackWebClient,
  channel: string,
  threadTs: string | undefined,
  messageTs?: string
): Promise<ThreadParentInfo | null> {
  if (!threadTs || threadTs === messageTs) return null;

  const key = cacheKey(channel, threadTs);
  const cached = threadParentCache.get(key);
  if (cached) return cached;

  try {
    const result = await client.conversations.history({
      channel,
      latest: threadTs,
      inclusive: true,
      limit: 1,
    });
    const parent = result.messages?.[0];
    if (!parent) return null;

    const info: ThreadParentInfo = {
      author: parent.username ?? parent.user ?? "unknown",
      content: parent.text ?? "",
      timestamp: slackTsToMs(parent.ts),
    };
    threadParentCache.set(key, info);
    return info;
  } catch {
    return null;
  }
}

export function resolveReplyThreadTs(
  policy: SlackThreadPolicy | undefined,
  messageTs: string,
  threadTs?: string
): string | undefined {
  switch (policy ?? "always") {
    case "always":
      return threadTs ?? messageTs;
    case "never":
      return undefined;
    case "follow":
      return threadTs && threadTs !== messageTs ? threadTs : undefined;
  }
}

export function clearThreadParentCache(channel?: string, threadTs?: string): void {
  if (channel && threadTs) {
    threadParentCache.delete(cacheKey(channel, threadTs));
    return;
  }
  if (channel) {
    for (const key of threadParentCache.keys()) {
      if (key.startsWith(`${channel}:`)) {
        threadParentCache.delete(key);
      }
    }
    return;
  }
  threadParentCache.clear();
}
