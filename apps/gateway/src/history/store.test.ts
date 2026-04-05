import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    default: {
      ...actual,
      access: vi.fn().mockRejectedValue(new Error("missing")),
      appendFile: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockRejectedValue(new Error("missing")),
      readdir: vi.fn().mockRejectedValue(new Error("missing")),
    },
  };
});

vi.mock("../config/index.js", () => ({
  CONFIG_DIR: "/tmp/aihub-test",
}));

vi.mock("../sessions/store.js", () => ({
  getSessionCreatedAt: vi.fn(() => 0),
  formatSessionTimestamp: vi.fn(() => "1970-01-01T00-00-00-000Z"),
}));

vi.mock("../sessions/claude.js", () => ({
  getClaudeSessionIdForSession: vi.fn(),
}));

describe("history store isolation", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("keeps canonical history in the root dir by default", async () => {
    const { appendSessionMeta } = await import("./store.js");

    await appendSessionMeta("agent-1", "session-1", "thinkingLevel", "high");

    expect(vi.mocked(fs.appendFile)).toHaveBeenCalledWith(
      "/tmp/aihub-test/history/1970-01-01T00-00-00-000Z_agent-1-session-1.jsonl",
      expect.any(String),
      "utf-8"
    );
  });

  it("routes canonical history into the user dir when userId is provided", async () => {
    const { appendSessionMeta } = await import("./store.js");

    await appendSessionMeta(
      "agent-1",
      "session-1",
      "thinkingLevel",
      "high",
      "user-123"
    );

    expect(vi.mocked(fs.appendFile)).toHaveBeenCalledWith(
      "/tmp/aihub-test/users/user-123/history/1970-01-01T00-00-00-000Z_agent-1-session-1.jsonl",
      expect.any(String),
      "utf-8"
    );
  });

  it("caches resolved history files until invalidated", async () => {
    const { appendSessionMeta, invalidateResolvedHistoryFile } =
      await import("./store.js");

    await appendSessionMeta("agent-1", "session-1", "thinkingLevel", "high");
    await appendSessionMeta("agent-1", "session-1", "thinkingLevel", "medium");
    expect(vi.mocked(fs.readdir)).toHaveBeenCalledTimes(1);

    invalidateResolvedHistoryFile("agent-1", "session-1");
    await appendSessionMeta("agent-1", "session-1", "thinkingLevel", "low");
    expect(vi.mocked(fs.readdir)).toHaveBeenCalledTimes(2);
  });
});
