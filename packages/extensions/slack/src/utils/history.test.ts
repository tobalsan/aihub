import { beforeEach, describe, expect, it } from "vitest";
import {
  clearAllHistory,
  clearHistory,
  getHistory,
  recordMessage,
} from "./history.js";

describe("Slack history", () => {
  beforeEach(() => {
    clearAllHistory();
  });

  it("records messages oldest first", () => {
    recordMessage("C1", { author: "U1", content: "one", timestamp: 1 }, 10);
    recordMessage("C1", { author: "U2", content: "two", timestamp: 2 }, 10);
    expect(getHistory("C1", 10)).toEqual([
      { author: "U1", content: "one", timestamp: 1 },
      { author: "U2", content: "two", timestamp: 2 },
    ]);
  });

  it("deduplicates by Slack ts per channel", () => {
    expect(
      recordMessage("C1", { author: "U1", content: "one", timestamp: 1 }, 10, "1.1")
    ).toBe(true);
    expect(
      recordMessage("C1", { author: "U1", content: "one", timestamp: 1 }, 10, "1.1")
    ).toBe(false);
    expect(getHistory("C1", 10)).toHaveLength(1);
  });

  it("trims to max size", () => {
    for (let i = 0; i < 5; i++) {
      recordMessage("C1", { author: `U${i}`, content: `${i}`, timestamp: i }, 3);
    }
    expect(getHistory("C1", 10).map((message) => message.content)).toEqual([
      "2",
      "3",
      "4",
    ]);
  });

  it("returns the last requested messages", () => {
    for (let i = 0; i < 5; i++) {
      recordMessage("C1", { author: `U${i}`, content: `${i}`, timestamp: i }, 10);
    }
    expect(getHistory("C1", 2).map((message) => message.content)).toEqual([
      "3",
      "4",
    ]);
  });

  it("clears one channel", () => {
    recordMessage("C1", { author: "U1", content: "one", timestamp: 1 }, 10);
    recordMessage("C2", { author: "U2", content: "two", timestamp: 2 }, 10);
    clearHistory("C1");
    expect(getHistory("C1", 10)).toEqual([]);
    expect(getHistory("C2", 10)).toHaveLength(1);
  });
});
