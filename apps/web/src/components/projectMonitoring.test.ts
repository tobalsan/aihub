import { describe, expect, it } from "vitest";
import { buildProjectSummary, buildStartPrompt } from "./projectMonitoring";

describe("project monitoring prompts", () => {
  it("builds project summary", () => {
    const summary = buildProjectSummary("Demo", "todo", "Body");
    expect(summary).toBe("Let's tackle the following project:\n\nDemo\ntodo\nBody");
  });

  it("builds start prompt with tools", () => {
    const prompt = buildStartPrompt("Summary");
    expect(prompt).toContain("Summary");
    expect(prompt).toContain("subagent.spawn");
  });
});
