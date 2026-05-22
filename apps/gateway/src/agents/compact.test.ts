import { describe, expect, it } from "vitest";
import { compactAssistantMeta } from "./compact.js";

describe("compact agent session helpers", () => {
  it("strips assistant usage metadata before seeding retained messages", () => {
    expect(
      compactAssistantMeta({
        model: "gpt-5.2",
        provider: "openai",
        api: "responses",
        stopReason: "stop",
        usage: {
          input: 120000,
          output: 10,
          cacheRead: 5000,
          cacheWrite: 0,
          totalTokens: 125010,
        },
      })
    ).toEqual({
      model: "gpt-5.2",
      provider: "openai",
      api: "responses",
      stopReason: "stop",
    });
  });
});
