import { describe, expect, it } from "vitest";
import { claimAgentToolName, sanitizeAgentToolName } from "./tool-names.js";

describe("agent tool names", () => {
  it("replaces provider-invalid characters", () => {
    expect(sanitizeAgentToolName("scratchpad.read")).toBe("scratchpad_read");
    expect(sanitizeAgentToolName("project:create")).toBe("project_create");
  });

  it("deduplicates sanitized names", () => {
    const used = new Set<string>();

    expect(claimAgentToolName("scratchpad.read", used)).toBe(
      "scratchpad_read"
    );
    expect(claimAgentToolName("scratchpad_read", used)).toMatch(
      /^scratchpad_read_[a-z0-9]+$/
    );
  });
});
