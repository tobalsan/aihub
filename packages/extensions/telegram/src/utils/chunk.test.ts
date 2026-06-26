import { describe, expect, it } from "vitest";
import { splitMessage } from "./chunk.js";

const MAX = 4096;

describe("splitMessage", () => {
  it("returns a single chunk when under the limit", () => {
    expect(splitMessage("hello world")).toEqual(["hello world"]);
  });

  it("keeps a message exactly at the limit as one chunk", () => {
    const text = "a".repeat(MAX);
    expect(splitMessage(text)).toEqual([text]);
  });

  it("splits a message one over the limit into two chunks", () => {
    const text = "a".repeat(MAX + 1);
    const chunks = splitMessage(text);
    expect(chunks.length).toBe(2);
    expect(chunks.every((c) => c.length <= MAX)).toBe(true);
    expect(chunks.join("")).toBe(text);
  });

  it("splits content exceeding the limit without dropping characters", () => {
    const text = "a".repeat(5000);
    const chunks = splitMessage(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= MAX)).toBe(true);
    expect(chunks.join("")).toBe(text);
  });

  it("preserves whitespace at split boundaries", () => {
    const text = `${"word ".repeat(900)}tail`;
    const chunks = splitMessage(text, 120);
    expect(chunks.length).toBeGreaterThan(1);
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

  it("never splits in the middle of an HTML tag", () => {
    // A long run of bold tags; force small chunks and confirm no chunk ends
    // with a half-written tag.
    const unit = "<b>x</b> ";
    const text = unit.repeat(200);
    const chunks = splitMessage(text, 50);
    for (const chunk of chunks) {
      // No dangling "<" without a matching ">" after it.
      const lastOpen = chunk.lastIndexOf("<");
      const lastClose = chunk.lastIndexOf(">");
      expect(lastClose).toBeGreaterThanOrEqual(lastOpen);
    }
  });

  it("never splits in the middle of an HTML entity", () => {
    const text = "&lt;".repeat(80);
    const chunks = splitMessage(text, 50);
    expect(chunks.join("")).toBe(text);
    for (const chunk of chunks) {
      expect(chunk).not.toMatch(/&(?:amp|lt|gt)?$/);
      expect(chunk).not.toMatch(/^;(?:amp|lt|gt)?/);
    }
  });

  it("closes and reopens a <pre> block that straddles a boundary", () => {
    const body = Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n");
    const html = `<pre>${body}</pre>`;
    const chunks = splitMessage(html, 200);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      const opens = (chunk.match(/<pre>/g) ?? []).length;
      const closes = (chunk.match(/<\/pre>/g) ?? []).length;
      expect(opens).toBe(closes);
      expect(chunk.length).toBeLessThanOrEqual(200);
    }
  });

  it("closes and reopens a <pre><code> block across a boundary", () => {
    const body = Array.from({ length: 60 }, (_, i) => `row ${i}`).join("\n");
    const html = `<pre><code class="language-ts">${body}</code></pre>`;
    const chunks = splitMessage(html, 200);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect((chunk.match(/<pre>/g) ?? []).length).toBe(
        (chunk.match(/<\/pre>/g) ?? []).length
      );
      expect((chunk.match(/<code/g) ?? []).length).toBe(
        (chunk.match(/<\/code>/g) ?? []).length
      );
    }
    // Every later chunk reopens the code block with its language class.
    for (const chunk of chunks.slice(1)) {
      expect(chunk.startsWith('<pre><code class="language-ts">')).toBe(true);
    }
  });

  it("closes and reopens a long inline <b> run that exceeds the limit", () => {
    const html = `<b>${"lorem ipsum ".repeat(60).trim()}</b>`;
    const chunks = splitMessage(html, 200);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect((chunk.match(/<b>/g) ?? []).length).toBe(
        (chunk.match(/<\/b>/g) ?? []).length
      );
      expect(chunk.length).toBeLessThanOrEqual(200);
    }
    expect(chunks[0].startsWith("<b>")).toBe(true);
    expect(chunks[0].endsWith("</b>")).toBe(true);
    expect(chunks[chunks.length - 1].endsWith("</b>")).toBe(true);
  });

  it("closes and reopens a long <blockquote> across a boundary", () => {
    const html = `<blockquote>${"quote text ".repeat(60).trim()}</blockquote>`;
    const chunks = splitMessage(html, 200);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect((chunk.match(/<blockquote>/g) ?? []).length).toBe(
        (chunk.match(/<\/blockquote>/g) ?? []).length
      );
      expect(chunk.length).toBeLessThanOrEqual(200);
    }
  });

  it("closes and reopens a long link across a boundary", () => {
    const html = `<a href="https://example.test">${"label ".repeat(80).trim()}</a>`;
    const chunks = splitMessage(html, 200);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect((chunk.match(/<a /g) ?? []).length).toBe(
        (chunk.match(/<\/a>/g) ?? []).length
      );
      expect(chunk.length).toBeLessThanOrEqual(200);
    }
  });
});
