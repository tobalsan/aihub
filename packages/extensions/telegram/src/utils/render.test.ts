import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./render.js";

describe("renderMarkdown", () => {
  it("renders bold, italic, and strikethrough", () => {
    expect(renderMarkdown("**bold** and *italic* and ~~gone~~")).toBe(
      "<b>bold</b> and <i>italic</i> and <s>gone</s>"
    );
    expect(renderMarkdown("__also bold__ and _also italic_")).toBe(
      "<b>also bold</b> and <i>also italic</i>"
    );
  });

  it("renders inline code without interpreting its contents", () => {
    expect(renderMarkdown("use `**not bold**` here")).toBe(
      "use <code>**not bold**</code> here"
    );
  });

  it("renders fenced code blocks with a language class", () => {
    const out = renderMarkdown("```ts\nconst x = 1 < 2;\n```");
    expect(out).toBe(
      '<pre><code class="language-ts">const x = 1 &lt; 2;</code></pre>'
    );
  });

  it("escapes quotes in fenced code language attributes", () => {
    const out = renderMarkdown('```bad"lang\nx\n```');
    expect(out).toBe('<pre><code class="language-bad&quot;lang">x</code></pre>');
  });

  it("drops oversized fenced code language attributes", () => {
    const out = renderMarkdown(`\`\`\`${"x".repeat(1100)}\nx\n\`\`\``);
    expect(out).toBe("<pre>x</pre>");
  });

  it("renders fenced code blocks without a language", () => {
    expect(renderMarkdown("```\nplain\n```")).toBe("<pre>plain</pre>");
  });

  it("escapes special HTML characters in plain text", () => {
    expect(renderMarkdown("a < b && c > d")).toBe("a &lt; b &amp;&amp; c &gt; d");
  });

  it("renders links and drops image syntax", () => {
    expect(renderMarkdown("[site](https://x.io)")).toBe(
      '<a href="https://x.io">site</a>'
    );
    expect(renderMarkdown("![alt](https://x.io/p.png)")).toBe("alt");
  });

  it("does not reinterpret underscores or asterisks inside a link URL", () => {
    expect(renderMarkdown("[k](https://a.io/foo_bar_baz)")).toBe(
      '<a href="https://a.io/foo_bar_baz">k</a>'
    );
    expect(renderMarkdown("[k](https://a*b*c.io)")).toBe(
      '<a href="https://a*b*c.io">k</a>'
    );
  });

  it("escapes quotes and angle brackets in a link URL", () => {
    expect(renderMarkdown('[k](https://a.io/?q="hi"&x=1<2)')).toBe(
      '<a href="https://a.io/?q=&quot;hi&quot;&amp;x=1&lt;2">k</a>'
    );
  });

  it("renders very long link URLs as visible code instead of giant href tags", () => {
    const url = `https://a.io/${"x".repeat(1100)}`;
    expect(renderMarkdown(`[k](${url})`)).toBe(`k (<code>${url}</code>)`);
  });

  it("uses escaped href length when guarding very long link tags", () => {
    const url = `https://a.io/${'"'.repeat(260)}`;
    expect(renderMarkdown(`[k](${url})`)).toBe(`k (<code>${url}</code>)`);
  });

  it("still renders markdown inside a link label", () => {
    expect(renderMarkdown("[**bold**](https://a.io)")).toBe(
      '<a href="https://a.io"><b>bold</b></a>'
    );
  });

  it("converts headings to bold lines", () => {
    expect(renderMarkdown("# Title")).toBe("<b>Title</b>");
    expect(renderMarkdown("### Sub")).toBe("<b>Sub</b>");
  });

  it("converts bullet and ordered lists", () => {
    expect(renderMarkdown("- one\n- two")).toBe("• one\n• two");
    expect(renderMarkdown("1. first\n2. second")).toBe("1. first\n2. second");
  });

  it("renders blockquotes", () => {
    expect(renderMarkdown("> quoted")).toBe("<blockquote>quoted</blockquote>");
  });

  it("renders a markdown table as an aligned pre block", () => {
    const md = ["| Name | Age |", "| --- | --- |", "| Ann | 30 |", "| Bo | 9 |"].join(
      "\n"
    );
    const out = renderMarkdown(md);
    expect(out.startsWith("<pre>")).toBe(true);
    expect(out.endsWith("</pre>")).toBe(true);
    expect(out).toContain("Name | Age");
    expect(out).toContain("Ann  | 30");
    expect(out).toContain("Bo   | 9");
  });

  it("escapes table cell contents", () => {
    const md = ["| A | B |", "| - | - |", "| 1<2 | x&y |"].join("\n");
    expect(renderMarkdown(md)).toContain("1&lt;2 | x&amp;y");
  });

  it("does not interpret markdown inside code blocks", () => {
    const out = renderMarkdown("```\n| a | b |\n| - | - |\n| 1 | 2 |\n```");
    expect(out).toBe("<pre>| a | b |\n| - | - |\n| 1 | 2 |</pre>");
  });

  it("leaves plain text untouched aside from escaping", () => {
    expect(renderMarkdown("just words")).toBe("just words");
  });
});
