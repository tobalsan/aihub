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

// Default max size (can be overridden per-call)
const DEFAULT_MAX_SIZE = 50;

/**
 * Record a message in the channel's history ring buffer
 */
export function recordMessage(
  channelId: string,
  message: HistoryMessage,
  maxSize: number = DEFAULT_MAX_SIZE
): void {
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
}

/**
 * Clear all channel history
 */
export function clearAllHistory(): void {
  channelHistory.clear();
}
