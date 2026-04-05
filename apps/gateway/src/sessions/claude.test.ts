import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    default: {
      ...actual,
      readFile: vi.fn().mockResolvedValue("{}"),
      mkdir: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
      rename: vi.fn().mockResolvedValue(undefined),
    },
  };
});

vi.mock("../config/index.js", () => ({
  CONFIG_DIR: "/tmp/aihub-test",
}));

describe("claude session store isolation", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("keeps single-user mappings in the root store", async () => {
    const { setClaudeSessionId } = await import("./claude.js");

    await setClaudeSessionId("agent-1", "session-1", "claude-1", "model-1");

    expect(vi.mocked(fs.rename)).toHaveBeenCalledWith(
      expect.stringContaining("/tmp/aihub-test/claude-sessions.json."),
      "/tmp/aihub-test/claude-sessions.json"
    );
  });

  it("writes multi-user mappings to the user store", async () => {
    const { setClaudeSessionId } = await import("./claude.js");

    await setClaudeSessionId(
      "agent-1",
      "session-1",
      "claude-1",
      "model-1",
      "user-123"
    );

    expect(vi.mocked(fs.rename)).toHaveBeenCalledWith(
      expect.stringContaining(
        "/tmp/aihub-test/users/user-123/claude-sessions.json."
      ),
      "/tmp/aihub-test/users/user-123/claude-sessions.json"
    );
  });

  it("uses unique temp files for concurrent saves", async () => {
    let releaseWrites: (() => void) | undefined;
    const writesStarted = new Promise<void>((resolve) => {
      releaseWrites = resolve;
    });
    let blocked = true;
    vi.mocked(fs.writeFile).mockImplementation(async () => {
      if (blocked) {
        await writesStarted;
      }
    });

    const { setClaudeSessionId } = await import("./claude.js");

    const first = setClaudeSessionId("agent-1", "session-1", "claude-1", "model-1");
    const second = setClaudeSessionId("agent-1", "session-2", "claude-2", "model-1");

    while (vi.mocked(fs.writeFile).mock.calls.length < 2) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    blocked = false;
    releaseWrites?.();
    await Promise.all([first, second]);

    const tempFiles = vi
      .mocked(fs.writeFile)
      .mock.calls.map(([file]) => String(file));
    expect(new Set(tempFiles).size).toBe(tempFiles.length);
  });
});
