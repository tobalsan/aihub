import { describe, expect, it } from "vitest";
import { getMaxContextTokens } from "./model-context.js";

describe("getMaxContextTokens", () => {
  it("uses the 1M context window for gpt-5.4 and gpt-5.3-codex", () => {
    expect(getMaxContextTokens("gpt-5.4")).toBe(1_000_000);
    expect(getMaxContextTokens("gpt-5.3-codex")).toBe(1_000_000);
  });

  it("keeps spark on the smaller context window", () => {
    expect(getMaxContextTokens("gpt-5.3-codex-spark")).toBe(200_000);
  });
});
