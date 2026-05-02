import { describe, expect, it } from "vitest";
import { buildUserContext, renderAgentContext } from "./context-rendering.js";

describe("renderAgentContext web user context", () => {
  it("renders the web user context block", () => {
    expect(renderAgentContext(buildUserContext({ name: "Thinh" }))).toBe(
      [
        "[USER CONTEXT]",
        "context: web UI",
        "name: Thinh",
        "[END USER CONTEXT]",
      ].join("\n")
    );
  });

  it("falls back when the user name is missing", () => {
    expect(renderAgentContext(buildUserContext({ name: undefined }))).toContain(
      "name: unknown"
    );
  });
});
