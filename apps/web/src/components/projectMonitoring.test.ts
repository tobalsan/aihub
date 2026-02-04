import { describe, expect, it } from "vitest";
import { buildProjectSummary, buildStartPrompt } from "./projectMonitoring";

describe("project monitoring prompts", () => {
  it("builds project summary", () => {
    const summary = buildProjectSummary("Demo", "todo", "/Users/thinh/projects/PRO-1_demo", "Body");
    expect(summary).toBe(
      "Let's tackle the following project:\n\nDemo\ntodo\n## Project Documentation\nPath: /Users/thinh/projects/PRO-1_demo\n(Read-only context: README, SPECS.md, docs. Do NOT implement code here.)\nBody"
    );
  });

  it("builds start prompt", () => {
    const prompt = buildStartPrompt("Summary");
    expect(prompt).toBe("Summary");
  });
});
