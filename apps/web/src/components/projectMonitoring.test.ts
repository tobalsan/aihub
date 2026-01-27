import { describe, expect, it } from "vitest";
import { buildProjectSummary, buildStartPrompt } from "./projectMonitoring";

describe("project monitoring prompts", () => {
  it("builds project summary", () => {
    const summary = buildProjectSummary("Demo", "todo", "/Users/thinh/projects/PRO-1_demo", "Body");
    expect(summary).toBe(
      "Let's tackle the following project:\n\nDemo\ntodo\nProject folder: /Users/thinh/projects/PRO-1_demo\nBody"
    );
  });

  it("builds start prompt with tools", () => {
    const prompt = buildStartPrompt("Summary");
    expect(prompt).toContain("Summary");
    expect(prompt).toContain("subagent.spawn");
  });
});
