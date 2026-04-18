import { describe, expect, it } from "vitest";

describe("multi-user isolation paths", () => {
  it("keeps single-user paths at data root", async () => {
    const { getUserSessionsPath, getUserHistoryDir } = await import(
      "./isolation.js"
    );

    expect(getUserSessionsPath(undefined, "/tmp/aihub-test")).toBe(
      "/tmp/aihub-test/sessions.json"
    );
    expect(getUserHistoryDir(undefined, "/tmp/aihub-test")).toBe(
      "/tmp/aihub-test/history"
    );
  });

  it("routes multi-user paths under user data dir", async () => {
    const { getUserDataDir, getUserSessionsPath, getUserHistoryDir } =
      await import("./isolation.js");

    expect(getUserDataDir("user-123", "/tmp/aihub-test")).toBe(
      "/tmp/aihub-test/users/user-123"
    );
    expect(getUserSessionsPath("user-123", "/tmp/aihub-test")).toBe(
      "/tmp/aihub-test/users/user-123/sessions.json"
    );
    expect(getUserHistoryDir("user-123", "/tmp/aihub-test")).toBe(
      "/tmp/aihub-test/users/user-123/history"
    );
  });
});
