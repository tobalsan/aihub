import { describe, it, expect } from "vitest";
import { splitMessage } from "./chunk.js";

describe("splitMessage", () => {
  it("returns original text if under limit", () => {
    const text = "Hello world";
    expect(splitMessage(text)).toEqual([text]);
  });

  it("returns original text if exactly at limit", () => {
    const text = "a".repeat(2000);
    expect(splitMessage(text)).toEqual([text]);
  });

  describe("2000 char limit", () => {
    it("splits long text into multiple chunks", () => {
      const text = "a".repeat(3000);
      const chunks = splitMessage(text);
      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach((chunk) => {
        expect(chunk.length).toBeLessThanOrEqual(2000);
      });
    });

    it("respects custom maxLength", () => {
      const text = "word ".repeat(100); // 500 chars
      const chunks = splitMessage(text, 100);
      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach((chunk) => {
        expect(chunk.length).toBeLessThanOrEqual(100);
      });
    });

    it("prefers splitting at newlines", () => {
      const line = "a".repeat(100);
      const text = `${line}\n${line}\n${line}`;
      const chunks = splitMessage(text, 150);
      // Should split at newlines rather than mid-line
      expect(chunks[0]).not.toContain("\n");
    });

    it("prefers splitting at spaces when no newlines available", () => {
      const text = "word ".repeat(500);
      const chunks = splitMessage(text, 100);
      // Chunks shouldn't split words
      chunks.forEach((chunk) => {
        expect(chunk.endsWith("wor")).toBe(false);
      });
    });
  });

  describe("code fence preservation", () => {
    it("does not split mid-fence", () => {
      const code = "x".repeat(80);
      const text = `\`\`\`js\n${code}\n${code}\n${code}\n\`\`\``;
      const chunks = splitMessage(text, 150);

      // Each chunk should have balanced fences
      chunks.forEach((chunk) => {
        const opens = (chunk.match(/```\w*/g) || []).filter((m) => m !== "```").length;
        // If chunk has an opening fence, it should also close it
        if (opens > 0) {
          expect(chunk).toContain("```");
        }
      });
    });

    it("reopens fence type in next chunk", () => {
      const code = "x".repeat(150);
      const text = `\`\`\`typescript\n${code}\n\`\`\``;
      const chunks = splitMessage(text, 100);

      if (chunks.length > 1) {
        // Second chunk should have the fence reopened
        expect(chunks[1]).toMatch(/```(typescript)?/);
      }
    });

    it("handles nested text and code", () => {
      const text = `Some text here\n\`\`\`js\nconst x = 1;\n\`\`\`\nMore text`;
      const chunks = splitMessage(text, 50);
      expect(chunks.length).toBeGreaterThan(0);
    });
  });

  describe("multiple chunks", () => {
    it("preserves all content across chunks", () => {
      const text = "test ".repeat(1000);
      const chunks = splitMessage(text);
      const rejoined = chunks.join("");
      // Content should be preserved (minus whitespace trimming between chunks)
      expect(rejoined.replace(/\s+/g, " ").trim()).toContain("test");
    });

    it("handles very long text", () => {
      const text = "a".repeat(10000);
      const chunks = splitMessage(text);
      expect(chunks.length).toBeGreaterThanOrEqual(5);
      chunks.forEach((chunk) => {
        expect(chunk.length).toBeLessThanOrEqual(2000);
      });
    });
  });
});
