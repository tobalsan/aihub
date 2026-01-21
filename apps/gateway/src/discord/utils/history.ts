/**
 * Guild history ring buffer
 * Maintains per-channel ring buffer of last N messages
 */

export type HistoryMessage = {
  author: string;
  content: string;
  timestamp: number;
};

// Per-channel ring buffers: channelId -> HistoryMessage[]
const channelHistory = new Map<string, HistoryMessage[]>();

// Per-channel seen message IDs for deduplication: channelId -> Set<messageId>
const seenMessageIds = new Map<string, Set<string>>();

// Default max size (can be overridden per-call)
const DEFAULT_MAX_SIZE = 50;

// Default max seen IDs per channel (to prevent unbounded growth)
const DEFAULT_MAX_SEEN = 100;

/**
 * Record a message in the channel's history ring buffer
 * Returns true if the message was recorded (first time seen), false if it was a duplicate
 */
export function recordMessage(
  channelId: string,
  message: HistoryMessage,
  maxSize: number = DEFAULT_MAX_SIZE,
  messageId?: string
): boolean {
  // Deduplicate by message ID if provided
  if (messageId) {
    let seen = seenMessageIds.get(channelId);
    if (!seen) {
      seen = new Set();
      seenMessageIds.set(channelId, seen);
    }

    // Skip if we've already seen this message
    if (seen.has(messageId)) {
      return false;
    }

    seen.add(messageId);

    // Trim seen IDs to prevent unbounded growth
    if (seen.size > DEFAULT_MAX_SEEN) {
      const seenArray = Array.from(seen);
      seenArray.slice(0, seenArray.length - DEFAULT_MAX_SEEN).forEach(id => seen!.delete(id));
    }
  }

  let history = channelHistory.get(channelId);
  if (!history) {
    history = [];
    channelHistory.set(channelId, history);
  }

  history.push(message);

  // Trim to max size (ring buffer behavior)
  if (history.length > maxSize) {
    history.shift();
  }

  return true;
}

/**
 * Get recent history for a channel
 * Returns up to `limit` most recent messages (oldest first)
 */
export function getHistory(channelId: string, limit: number): HistoryMessage[] {
  const history = channelHistory.get(channelId);
  if (!history || history.length === 0) return [];

  // Return last N messages
  if (limit >= history.length) {
    return [...history];
  }
  return history.slice(-limit);
}

/**
 * Clear history for a channel
 */
export function clearHistory(channelId: string): void {
  channelHistory.delete(channelId);
  seenMessageIds.delete(channelId);
}

/**
 * Clear all channel history
 */
export function clearAllHistory(): void {
  channelHistory.clear();
  seenMessageIds.clear();
}
