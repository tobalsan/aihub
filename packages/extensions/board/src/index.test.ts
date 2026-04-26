import { describe, expect, it } from "vitest";
import { boardExtension } from "./index.js";

describe("board extension system prompt contribution", () => {
  it("contributes scratchpad tool guidance through the extension hook", async () => {
    const contribution = boardExtension.getSystemPromptContributions?.({
      id: "lead",
      name: "Lead",
      workspace: "/tmp/aihub-board-test",
      sdk: "pi",
      model: { model: "test" },
      queueMode: "queue",
    });
    const resolved = await Promise.resolve(contribution);
    const text = Array.isArray(resolved) ? resolved.join("\n") : resolved ?? "";

    expect(text).toContain("Board scratchpad tools");
    expect(text).toContain("scratchpad.read");
    expect(text).toContain("scratchpad.write");
  });
});
