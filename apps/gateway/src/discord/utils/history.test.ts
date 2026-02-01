import { describe, it, expect, beforeEach } from "vitest";
import { recordMessage, getHistory, clearHistory, clearAllHistory } from "./history.js";

describe("history", () => {
  beforeEach(() => {
    clearAllHistory();
  });

  describe("recordMessage", () => {
    it("records messages in history", () => {
      recordMessage("channel-1", { author: "alice", content: "Hello", timestamp: 1 }, 10);
      recordMessage("channel-1", { author: "bob", content: "Hi", timestamp: 2 }, 10);

      const history = getHistory("channel-1", 10);
      expect(history).toHaveLength(2);
      expect(history[0]).toEqual({ author: "alice", content: "Hello", timestamp: 1 });
      expect(history[1]).toEqual({ author: "bob", content: "Hi", timestamp: 2 });
    });

    it("returns true when message is recorded", () => {
      const result = recordMessage("channel-1", { author: "alice", content: "Hello", timestamp: 1 }, 10);
      expect(result).toBe(true);
    });

    it("deduplicates messages by messageId", () => {
      // Record same message ID 3 times
      const result1 = recordMessage("channel-1", { author: "alice", content: "Hello", timestamp: 1 }, 10, "msg-1");
      const result2 = recordMessage("channel-1", { author: "alice", content: "Hello", timestamp: 1 }, 10, "msg-1");
      const result3 = recordMessage("channel-1", { author: "alice", content: "Hello", timestamp: 1 }, 10, "msg-1");

      // Only first call should record
      expect(result1).toBe(true);
      expect(result2).toBe(false);
      expect(result3).toBe(false);

      // History should only have 1 message
      const history = getHistory("channel-1", 10);
      expect(history).toHaveLength(1);
    });

    it("deduplicates per channel", () => {
      // Same message ID in different channels
      recordMessage("channel-1", { author: "alice", content: "Hello", timestamp: 1 }, 10, "msg-1");
      recordMessage("channel-2", { author: "bob", content: "Hi", timestamp: 2 }, 10, "msg-1");

      const history1 = getHistory("channel-1", 10);
      const history2 = getHistory("channel-2", 10);

      expect(history1).toHaveLength(1);
      expect(history2).toHaveLength(1);
    });

    it("allows different message IDs", () => {
      recordMessage("channel-1", { author: "alice", content: "Hello", timestamp: 1 }, 10, "msg-1");
      recordMessage("channel-1", { author: "bob", content: "Hi", timestamp: 2 }, 10, "msg-2");

      const history = getHistory("channel-1", 10);
      expect(history).toHaveLength(2);
    });

    it("trims to maxSize", () => {
      for (let i = 0; i < 15; i++) {
        recordMessage("channel-1", { author: `user-${i}`, content: `msg-${i}`, timestamp: i }, 10, `msg-${i}`);
      }

      const history = getHistory("channel-1", 10);
      expect(history).toHaveLength(10);
      expect(history[0].author).toBe("user-5"); // Oldest in buffer
      expect(history[9].author).toBe("user-14"); // Newest
    });

    it("does not deduplicate when messageId is not provided", () => {
      const result1 = recordMessage("channel-1", { author: "alice", content: "Hello", timestamp: 1 }, 10);
      const result2 = recordMessage("channel-1", { author: "alice", content: "Hello", timestamp: 2 }, 10);

      // Both should be recorded
      expect(result1).toBe(true);
      expect(result2).toBe(true);

      const history = getHistory("channel-1", 10);
      expect(history).toHaveLength(2);
    });

    it("limits seen IDs to prevent unbounded growth", () => {
      // Record more than DEFAULT_MAX_SEEN messages
      for (let i = 0; i < 150; i++) {
        recordMessage("channel-1", { author: `user-${i}`, content: `msg-${i}`, timestamp: i }, 10, `msg-${i}`);
      }

      // Try to record one of the earliest messages again
      const result = recordMessage("channel-1", { author: "user-0", content: "msg-0", timestamp: 0 }, 10, "msg-0");

      // Should not be deduplicated since the seen ID was trimmed
      expect(result).toBe(true);

      const history = getHistory("channel-1", 10);
      expect(history).toHaveLength(10);
    });
  });

  describe("getHistory", () => {
    it("returns empty array for unknown channel", () => {
      const history = getHistory("unknown", 10);
      expect(history).toEqual([]);
    });

    it("returns last N messages", () => {
      for (let i = 0; i < 5; i++) {
        recordMessage("channel-1", { author: `user-${i}`, content: `msg-${i}`, timestamp: i }, 10, `msg-${i}`);
      }

      const history = getHistory("channel-1", 3);
      expect(history).toHaveLength(3);
      expect(history[0].author).toBe("user-2");
      expect(history[2].author).toBe("user-4");
    });

    it("returns all messages if limit >= history length", () => {
      for (let i = 0; i < 5; i++) {
        recordMessage("channel-1", { author: `user-${i}`, content: `msg-${i}`, timestamp: i }, 10, `msg-${i}`);
      }

      const history = getHistory("channel-1", 10);
      expect(history).toHaveLength(5);
    });
  });

  describe("clearHistory", () => {
    it("clears history and seen IDs for channel", () => {
      recordMessage("channel-1", { author: "alice", content: "Hello", timestamp: 1 }, 10, "msg-1");

      clearHistory("channel-1");

      const history = getHistory("channel-1", 10);
      expect(history).toEqual([]);

      // Recording same message ID should work again
      const result = recordMessage("channel-1", { author: "alice", content: "Hello", timestamp: 2 }, 10, "msg-1");
      expect(result).toBe(true);
    });

    it("does not affect other channels", () => {
      recordMessage("channel-1", { author: "alice", content: "Hello", timestamp: 1 }, 10, "msg-1");
      recordMessage("channel-2", { author: "bob", content: "Hi", timestamp: 2 }, 10, "msg-2");

      clearHistory("channel-1");

      expect(getHistory("channel-1", 10)).toEqual([]);
      expect(getHistory("channel-2", 10)).toHaveLength(1);
    });
  });

  describe("clearAllHistory", () => {
    it("clears all channels", () => {
      recordMessage("channel-1", { author: "alice", content: "Hello", timestamp: 1 }, 10, "msg-1");
      recordMessage("channel-2", { author: "bob", content: "Hi", timestamp: 2 }, 10, "msg-2");

      clearAllHistory();

      expect(getHistory("channel-1", 10)).toEqual([]);
      expect(getHistory("channel-2", 10)).toEqual([]);
    });
  });
});
