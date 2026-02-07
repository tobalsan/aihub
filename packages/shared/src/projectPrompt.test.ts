import { describe, expect, it } from "vitest";
import {
  buildRalphPromptFromTemplate,
  renderTemplate,
} from "./projectPrompt.js";

describe("projectPrompt template helpers", () => {
  it("replaces all placeholders", () => {
    const template =
      "A {{PROJECT_FILE}} B {{SCOPES_FILE}} C {{PROGRESS_FILE}} D {{SOURCE_DIR}}";
    const out = buildRalphPromptFromTemplate({
      template,
      vars: {
        PROJECT_FILE: "/tmp/README.md",
        SCOPES_FILE: "/tmp/SCOPES.md",
        PROGRESS_FILE: "/tmp/progress.md",
        SOURCE_DIR: "/tmp/repo",
      },
    });
    expect(out).toBe(
      "A /tmp/README.md B /tmp/SCOPES.md C /tmp/progress.md D /tmp/repo"
    );
  });

  it("replaces repeated placeholders", () => {
    const out = renderTemplate("{{A}} + {{A}}", { A: "x" });
    expect(out).toBe("x + x");
  });

  it("keeps unknown placeholders", () => {
    const out = renderTemplate("{{KNOWN}} {{UNKNOWN}}", { KNOWN: "ok" });
    expect(out).toBe("ok {{UNKNOWN}}");
  });

  it("handles paths with spaces", () => {
    const out = renderTemplate("{{PATH}}", {
      PATH: "/tmp/my folder/file.md",
    });
    expect(out).toBe("/tmp/my folder/file.md");
  });

  it("throws when required vars are missing", () => {
    expect(() =>
      buildRalphPromptFromTemplate({
        template: "{{PROJECT_FILE}}",
        vars: { PROJECT_FILE: "/tmp/README.md" },
      })
    ).toThrow("Missing required template vars");
  });
});
