import { describe, expect, it } from "vitest";
import { markdownToMrkdwn } from "./mrkdwn.js";

describe("markdownToMrkdwn", () => {
  it("converts bold and italic markdown", () => {
    expect(markdownToMrkdwn("Use **bold** and __italic__.")).toBe(
      "Use *bold* and _italic_."
    );
  });

  it("converts markdown links to Slack links", () => {
    expect(markdownToMrkdwn("Read [docs](https://example.com/docs).")).toBe(
      "Read <https://example.com/docs|docs>."
    );
  });

  it("does not convert formatting inside inline or fenced code", () => {
    const input = [
      "Keep `**literal**` as code.",
      "```",
      "[link](https://example.com)",
      "**bold**",
      "```",
    ].join("\n");

    expect(markdownToMrkdwn(input)).toBe(input);
  });

  it("converts markdown tables to bullet lists", () => {
    const input = [
      "| Name | Status |",
      "| --- | --- |",
      "| Build | Green |",
      "| Lint | Passing |",
    ].join("\n");

    expect(markdownToMrkdwn(input)).toBe(
      ["- Name: Build; Status: Green", "- Name: Lint; Status: Passing"].join(
        "\n"
      )
    );
  });

  it("strips images and HTML tags", () => {
    expect(
      markdownToMrkdwn("Before ![alt](https://x.test/a.png) <b>bold</b>")
    ).toBe("Before  bold");
  });
});
