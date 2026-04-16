import { describe, expect, it } from "vitest";
import { matchesUserAllowlist } from "./allowlist.js";

describe("matchesUserAllowlist", () => {
  it("returns false for empty allowlist", () => {
    expect(matchesUserAllowlist("U123", undefined)).toBe(false);
    expect(matchesUserAllowlist("U123", [])).toBe(false);
  });

  it("matches string and numeric IDs", () => {
    expect(matchesUserAllowlist("123", [123])).toBe(true);
    expect(matchesUserAllowlist("U123", ["U123"])).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(matchesUserAllowlist("UABC", ["uabc"])).toBe(true);
  });

  it("strips slack user prefix", () => {
    expect(matchesUserAllowlist("U123", ["slack:/user:U123"])).toBe(true);
  });

  it("returns false for non-matches", () => {
    expect(matchesUserAllowlist("U123", ["U999"])).toBe(false);
  });
});
