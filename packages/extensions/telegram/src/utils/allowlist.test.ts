import { describe, expect, it } from "vitest";
import { matchesChatAllowlist, matchesUserAllowlist } from "./allowlist.js";

describe("matchesUserAllowlist", () => {
  it("matches a numeric user id (number entry)", () => {
    expect(matchesUserAllowlist({ id: 42 }, [42])).toBe(true);
  });

  it("matches a numeric user id (string entry)", () => {
    expect(matchesUserAllowlist({ id: 42 }, ["42"])).toBe(true);
  });

  it("matches a username case-insensitively", () => {
    expect(
      matchesUserAllowlist({ id: 1, username: "Alice" }, ["alice"])
    ).toBe(true);
  });

  it("matches a username regardless of a leading @", () => {
    expect(
      matchesUserAllowlist({ id: 1, username: "alice" }, ["@alice"])
    ).toBe(true);
    expect(
      matchesUserAllowlist({ id: 1, username: "@alice" }, ["alice"])
    ).toBe(true);
  });

  it("matches a telegram:/user: prefixed entry", () => {
    expect(matchesUserAllowlist({ id: 99 }, ["telegram:/user:99"])).toBe(true);
  });

  it("denies a user not on the list", () => {
    expect(
      matchesUserAllowlist({ id: 7, username: "bob" }, [42, "alice"])
    ).toBe(false);
  });

  it("fails closed for an empty allowlist", () => {
    expect(matchesUserAllowlist({ id: 42 }, [])).toBe(false);
  });

  it("fails closed for an omitted allowlist", () => {
    expect(matchesUserAllowlist({ id: 42 }, undefined)).toBe(false);
  });

  it("denies when the user id is undefined and only ids are listed", () => {
    expect(matchesUserAllowlist({ id: undefined }, [42])).toBe(false);
  });

  it("matches by username even when the id is undefined", () => {
    expect(
      matchesUserAllowlist({ id: undefined, username: "alice" }, ["alice"])
    ).toBe(true);
  });
});

describe("matchesChatAllowlist", () => {
  it("matches a numeric chat id", () => {
    expect(matchesChatAllowlist({ id: -100123 }, [-100123])).toBe(true);
  });

  it("matches a chat id given as a string entry", () => {
    expect(matchesChatAllowlist({ id: -100123 }, ["-100123"])).toBe(true);
  });

  it("matches a public chat by @username", () => {
    expect(
      matchesChatAllowlist({ id: -1, username: "TeamRoom" }, ["@teamroom"])
    ).toBe(true);
  });

  it("matches a telegram:/chat: prefixed entry", () => {
    expect(
      matchesChatAllowlist({ id: 555 }, ["telegram:/chat:555"])
    ).toBe(true);
  });

  it("denies a chat not on the list", () => {
    expect(matchesChatAllowlist({ id: 999 }, [-100123, "teamroom"])).toBe(
      false
    );
  });

  it("fails closed for an empty allowlist", () => {
    expect(matchesChatAllowlist({ id: -100123 }, [])).toBe(false);
  });

  it("fails closed for an omitted allowlist", () => {
    expect(matchesChatAllowlist({ id: -100123 }, undefined)).toBe(false);
  });
});
