import { afterEach, describe, expect, it, vi } from "vitest";
import {
  endImpersonation,
  getImpersonation,
  logImpersonationEvent,
  startImpersonation,
} from "./impersonation.js";

afterEach(() => {
  endImpersonation("session-1");
  vi.restoreAllMocks();
});

describe("impersonation state", () => {
  it("stores impersonation by admin session", () => {
    startImpersonation("session-1", "user-2");

    expect(getImpersonation("session-1")?.targetUserId).toBe("user-2");
    expect(getImpersonation("other-session")).toBeNull();
  });

  it("clears impersonation", () => {
    startImpersonation("session-1", "user-2");
    endImpersonation("session-1");

    expect(getImpersonation("session-1")).toBeNull();
  });

  it("logs audit line", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    logImpersonationEvent({ action: "start", adminId: "admin-1", targetId: "user-2" });

    expect(info).toHaveBeenCalledWith(expect.stringMatching(/^\[impersonate\] admin=admin-1 target=user-2 action=start ts=/));
  });
});
