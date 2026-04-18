import { describe, expect, it, vi } from "vitest";

vi.mock("../../config/index.js", () => ({
  CONFIG_DIR: "/tmp/aihub-test",
}));

describe("multi-user isolation paths", () => {
  it("keeps single-user paths at the config root", async () => {
    const {
      getUserSessionsPath,
      getUserHistoryDir,
    } = await import("./isolation.js");

    expect(getUserSessionsPath()).toBe("/tmp/aihub-test/sessions.json");
    expect(getUserHistoryDir()).toBe("/tmp/aihub-test/history");
  });

  it("routes multi-user paths under the user data dir", async () => {
    const {
      getUserDataDir,
      getUserSessionsPath,
      getUserHistoryDir,
    } = await import("./isolation.js");

    expect(getUserDataDir("user-123")).toBe("/tmp/aihub-test/users/user-123");
    expect(getUserSessionsPath("user-123")).toBe(
      "/tmp/aihub-test/users/user-123/sessions.json"
    );
    expect(getUserHistoryDir("user-123")).toBe(
      "/tmp/aihub-test/users/user-123/history"
    );
  });
});
