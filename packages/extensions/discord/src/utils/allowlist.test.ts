import { describe, it, expect } from "vitest";
import {
  matchesUserAllowlist,
  matchesChannelAllowlist,
  matchesAnyUserAllowlist,
} from "./allowlist.js";

describe("matchesUserAllowlist", () => {
  const user = {
    id: "123456789",
    username: "testuser",
    discriminator: "1234",
  };

  it("returns false for empty allowlist", () => {
    expect(matchesUserAllowlist(user, [])).toBe(false);
    expect(matchesUserAllowlist(user, undefined)).toBe(false);
  });

  describe("ID matching", () => {
    it("matches string ID", () => {
      expect(matchesUserAllowlist(user, ["123456789"])).toBe(true);
    });

    it("matches number ID", () => {
      expect(matchesUserAllowlist(user, [123456789])).toBe(true);
    });

    it("is case insensitive", () => {
      const userWithUpperId = { id: "ABC123" };
      expect(matchesUserAllowlist(userWithUpperId, ["abc123"])).toBe(true);
    });
  });

  describe("username matching", () => {
    it("matches username", () => {
      expect(matchesUserAllowlist(user, ["testuser"])).toBe(true);
    });

    it("is case insensitive", () => {
      expect(matchesUserAllowlist(user, ["TESTUSER"])).toBe(true);
      expect(matchesUserAllowlist(user, ["TestUser"])).toBe(true);
    });
  });

  describe("tag matching (user#1234)", () => {
    it("matches user tag", () => {
      expect(matchesUserAllowlist(user, ["testuser#1234"])).toBe(true);
    });

    it("is case insensitive", () => {
      expect(matchesUserAllowlist(user, ["TESTUSER#1234"])).toBe(true);
    });

    it("does not match with wrong discriminator", () => {
      expect(matchesUserAllowlist(user, ["testuser#0000"])).toBe(false);
    });
  });

  describe("prefix stripping", () => {
    it("strips discord:/user: prefix", () => {
      expect(matchesUserAllowlist(user, ["discord:/user:123456789"])).toBe(true);
    });

    it("strips discord:/channel: prefix (even on user match)", () => {
      expect(matchesUserAllowlist(user, ["discord:/channel:123456789"])).toBe(true);
    });
  });

  it("returns false for non-matching entry", () => {
    expect(matchesUserAllowlist(user, ["999999999"])).toBe(false);
    expect(matchesUserAllowlist(user, ["otheruser"])).toBe(false);
  });
});

describe("matchesChannelAllowlist", () => {
  const channelId = "987654321";

  it("returns false for empty allowlist", () => {
    expect(matchesChannelAllowlist(channelId, [])).toBe(false);
    expect(matchesChannelAllowlist(channelId, undefined)).toBe(false);
  });

  it("matches string ID", () => {
    expect(matchesChannelAllowlist(channelId, ["987654321"])).toBe(true);
  });

  it("matches number ID", () => {
    expect(matchesChannelAllowlist(channelId, [987654321])).toBe(true);
  });

  it("strips discord:/channel: prefix", () => {
    expect(matchesChannelAllowlist(channelId, ["discord:/channel:987654321"])).toBe(true);
  });

  it("returns false for non-matching entry", () => {
    expect(matchesChannelAllowlist(channelId, ["111111111"])).toBe(false);
  });
});

describe("matchesAnyUserAllowlist", () => {
  const user = { id: "123", username: "test" };

  it("returns false when all allowlists are empty", () => {
    expect(matchesAnyUserAllowlist(user, [], undefined, [])).toBe(false);
  });

  it("returns true if any allowlist matches", () => {
    expect(matchesAnyUserAllowlist(user, ["999"], ["123"])).toBe(true);
    expect(matchesAnyUserAllowlist(user, ["123"], ["999"])).toBe(true);
  });

  it("returns false if no allowlist matches", () => {
    expect(matchesAnyUserAllowlist(user, ["999"], ["888"])).toBe(false);
  });
});
