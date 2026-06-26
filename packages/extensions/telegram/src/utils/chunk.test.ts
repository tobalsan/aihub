import { describe, expect, it } from "vitest";
import { splitMessage } from "./chunk.js";

describe("splitMessage", () => {
  it("returns a single chunk when under the limit", () => {
    expect(splitMessage("hello world")).toEqual(["hello world"]);
  });

  it("splits content exceeding the limit without dropping characters", () => {
    const text = "a".repeat(5000);
    const chunks = splitMessage(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 4096)).toBe(true);
    expect(chunks.join("")).toBe(text);
  });

  it("splits on whitespace boundaries and preserves words", () => {
    const line = "word ".repeat(500).trim();
    const text = `${line}\n${line}\n${line}`;
    const chunks = splitMessage(text, 1200);
    expect(chunks.every((chunk) => chunk.length <= 1200)).toBe(true);
    // No word is broken mid-token: rejoining on whitespace yields the same words.
    const words = (s: string) => s.split(/\s+/).filter(Boolean);
    expect(chunks.flatMap(words)).toEqual(words(text));
  });
});
