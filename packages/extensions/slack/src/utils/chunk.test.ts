import { describe, expect, it } from "vitest";
import { splitMessage } from "./chunk.js";

describe("splitMessage", () => {
  it("returns original text under the Slack limit", () => {
    expect(splitMessage("hello")).toEqual(["hello"]);
  });

  it("returns original text exactly at the Slack limit", () => {
    const text = "a".repeat(4000);
    expect(splitMessage(text)).toEqual([text]);
  });

  it("splits long text into 4000-char chunks", () => {
    const chunks = splitMessage("a".repeat(8500));
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4000);
    }
  });

  it("prefers splitting at spaces", () => {
    const chunks = splitMessage("word ".repeat(100), 80);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.endsWith("wor")).toBe(false);
      expect(chunk.length).toBeLessThanOrEqual(80);
    }
  });

  it("preserves code fences across chunks", () => {
    const text = `\`\`\`ts\n${"const x = 1;\n".repeat(20)}\`\`\``;
    const chunks = splitMessage(text, 120);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(120);
      const fenceCount = chunk.match(/```/g)?.length ?? 0;
      expect(fenceCount % 2).toBe(0);
    }
  });
});
