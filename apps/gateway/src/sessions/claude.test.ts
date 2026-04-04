import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";

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

    expect(vi.mocked(fs.promises.rename)).toHaveBeenCalledWith(
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

    expect(vi.mocked(fs.promises.rename)).toHaveBeenCalledWith(
      expect.stringContaining(
        "/tmp/aihub-test/users/user-123/claude-sessions.json."
      ),
      "/tmp/aihub-test/users/user-123/claude-sessions.json"
    );
  });
});
