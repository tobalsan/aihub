export type HistoryMessage = {
  author: string;
  content: string;
  timestamp: number;
};

const DEFAULT_MAX_SIZE = 50;
const DEFAULT_MAX_SEEN = 100;

const channelHistory = new Map<string, HistoryMessage[]>();
const seenMessageIds = new Map<string, Set<string>>();

export function recordMessage(
  channelId: string,
  message: HistoryMessage,
  maxSize = DEFAULT_MAX_SIZE,
  messageId?: string
): boolean {
  if (messageId) {
    let seen = seenMessageIds.get(channelId);
    if (!seen) {
      seen = new Set();
      seenMessageIds.set(channelId, seen);
    }
    if (seen.has(messageId)) return false;
    seen.add(messageId);

    if (seen.size > DEFAULT_MAX_SEEN) {
      const seenArray = Array.from(seen);
      for (const id of seenArray.slice(0, seenArray.length - DEFAULT_MAX_SEEN)) {
        seen.delete(id);
      }
    }
  }

  let history = channelHistory.get(channelId);
  if (!history) {
    history = [];
    channelHistory.set(channelId, history);
  }

  history.push(message);
  if (history.length > maxSize) {
    history.shift();
  }
  return true;
}

export function getHistory(channelId: string, limit: number): HistoryMessage[] {
  const history = channelHistory.get(channelId);
  if (!history || history.length === 0) return [];
  return limit >= history.length ? [...history] : history.slice(-limit);
}

export function clearHistory(channelId: string): void {
  channelHistory.delete(channelId);
  seenMessageIds.delete(channelId);
}

export function clearAllHistory(): void {
  channelHistory.clear();
  seenMessageIds.clear();
}
