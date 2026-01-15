import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Mock fs before imports
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    default: {
      ...actual,
      readFileSync: vi.fn(() => "{}"),
      promises: {
        ...actual.promises,
        mkdir: vi.fn().mockResolvedValue(undefined),
        writeFile: vi.fn().mockResolvedValue(undefined),
        rename: vi.fn().mockResolvedValue(undefined),
      },
    },
  };
});

// Mock config to avoid loading real config
vi.mock("../config/index.js", () => ({
  loadConfig: () => ({ agents: [], sessions: {} }),
}));

describe("restoreSessionUpdatedAt", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("is a no-op when originalUpdatedAt is undefined", async () => {
    const { restoreSessionUpdatedAt } = await import("./store.js");
    const fsMock = vi.mocked(fs);

    // Should not throw
    await restoreSessionUpdatedAt("test-agent", "main", undefined);

    // Should not save (no writes)
    expect(fsMock.promises.writeFile).not.toHaveBeenCalled();
  });

  it("is a no-op when session entry does not exist", async () => {
    const { restoreSessionUpdatedAt } = await import("./store.js");
    const fsMock = vi.mocked(fs);

    // Session doesn't exist yet - should not throw
    await restoreSessionUpdatedAt("nonexistent-agent", "main", 1000);

    // Save is not called because entry doesn't exist
    expect(fsMock.promises.writeFile).not.toHaveBeenCalled();
  });

  it("restores updatedAt when session entry exists", async () => {
    // Mock store with existing entry
    const originalUpdatedAt = 1000;
    const newUpdatedAt = 2000;
    const mockStore = {
      "test-agent:main": {
        sessionId: "test-session-id",
        updatedAt: newUpdatedAt,
        createdAt: originalUpdatedAt,
      },
    };

    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockStore));

    const { restoreSessionUpdatedAt, getSessionEntry } = await import("./store.js");

    // Restore to original value
    await restoreSessionUpdatedAt("test-agent", "main", originalUpdatedAt);

    // Verify entry was updated in memory
    const entry = getSessionEntry("test-agent", "main");
    expect(entry?.updatedAt).toBe(originalUpdatedAt);

    // Verify save was called
    expect(vi.mocked(fs.promises.writeFile)).toHaveBeenCalled();
  });

  it("does not modify sessionId when restoring updatedAt", async () => {
    const originalSessionId = "original-session-id";
    const mockStore = {
      "test-agent:main": {
        sessionId: originalSessionId,
        updatedAt: 2000,
        createdAt: 1000,
      },
    };

    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockStore));

    const { restoreSessionUpdatedAt, getSessionEntry } = await import("./store.js");

    await restoreSessionUpdatedAt("test-agent", "main", 1000);

    const entry = getSessionEntry("test-agent", "main");
    expect(entry?.sessionId).toBe(originalSessionId);
  });
});

describe("getSessionEntry", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns undefined for non-existent entry", async () => {
    vi.mocked(fs.readFileSync).mockReturnValue("{}");

    const { getSessionEntry } = await import("./store.js");
    const entry = getSessionEntry("nonexistent", "main");

    expect(entry).toBeUndefined();
  });

  it("returns entry when it exists", async () => {
    const mockStore = {
      "test-agent:main": {
        sessionId: "test-session",
        updatedAt: 1000,
        createdAt: 500,
      },
    };
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockStore));

    const { getSessionEntry } = await import("./store.js");
    const entry = getSessionEntry("test-agent", "main");

    expect(entry).toEqual({
      sessionId: "test-session",
      updatedAt: 1000,
      createdAt: 500,
    });
  });
});
