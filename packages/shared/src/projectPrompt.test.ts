import { describe, expect, it } from "vitest";
import {
  buildCoordinatorPrompt,
  buildLegacyPrompt,
  buildProjectStartPrompt,
  buildReviewerPrompt,
  buildRolePrompt,
  buildWorkerPrompt,
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

describe("role-based project prompts", () => {
  const baseInput = {
    title: "PRO-151 - Role prompts",
    status: "in_progress",
    path: "/tmp/PRO-151",
    projectId: "PRO-151",
    repo: "/tmp/repo",
    runAgentLabel: "Worker Alpha",
    projectFiles: ["README.md", "THREAD.md", "SPECS.md"],
    content: "README content",
    specsPath: "/tmp/PRO-151/SPECS.md",
  } as const;

  it("builds coordinator prompt without implementation repo or commit instructions", () => {
    const out = buildCoordinatorPrompt({
      ...baseInput,
      role: "coordinator",
    });
    expect(out).toContain("## Your Role: Coordinator");
    expect(out).not.toContain("## Implementation Repository");
    expect(out).not.toContain("Run relevant tests after changes.");
    expect(out).not.toContain("apm move PRO-151 review");
    expect(out).toContain("primarily in /tmp/PRO-151/SPECS.md");
    expect(out).toContain("other relevant project markdown files");
  });

  it("builds worker prompt with implementation repo and no move-to-review", () => {
    const out = buildWorkerPrompt({
      ...baseInput,
      role: "worker",
    });
    expect(out).toContain("## Your Role: Worker");
    expect(out).toContain("## Implementation Repository");
    expect(out).toContain("Run relevant tests after changes.");
    expect(out).not.toContain("apm move PRO-151 review");
    expect(out).toContain(
      "Update task statuses and acceptance criteria notes in /tmp/PRO-151/SPECS.md."
    );
  });

  it("builds reviewer prompt with workspace list and no commit block", () => {
    const out = buildReviewerPrompt({
      ...baseInput,
      role: "reviewer",
      workerWorkspaces: [
        {
          name: "Worker Alpha",
          cli: "codex",
          path: "~/projects/.workspaces/PRO-151/worker-alpha/",
        },
      ],
    });
    expect(out).toContain("## Your Role: Reviewer");
    expect(out).toContain("## Active Worker Workspaces");
    expect(out).toContain("~/projects/.workspaces/PRO-151/worker-alpha/");
    expect(out).not.toContain("Run relevant tests after changes.");
    expect(out).not.toContain("apm move PRO-151 review");
    expect(out).toContain(
      "Update task statuses and acceptance criteria notes in /tmp/PRO-151/SPECS.md."
    );
  });

  it("keeps legacy prompt output identical to buildProjectStartPrompt", () => {
    const legacyInput = {
      title: "Legacy",
      status: "todo",
      path: "/tmp/legacy",
      content: "doc body",
      specsPath: "/tmp/legacy/README.md",
      repo: "/tmp/repo",
      customPrompt: "custom",
      runAgentLabel: "Codex",
    };
    const oldOut = buildProjectStartPrompt(legacyInput);
    const newOut = buildLegacyPrompt({
      role: "legacy",
      ...legacyInput,
    });
    expect(newOut).toBe(oldOut);
  });

  it("dispatches role prompt builder and defaults to legacy", () => {
    const workerOut = buildRolePrompt({
      ...baseInput,
      role: "worker",
    });
    expect(workerOut).toContain("## Your Role: Worker");

    const legacyOut = buildRolePrompt({
      ...baseInput,
      role: "legacy",
    });
    expect(legacyOut).toContain("## Your Role");
    expect(legacyOut).toContain("## IMPORTANT: MUST DO AFTER IMPLEMENTATION");
    expect(legacyOut).toContain("apm move <project_id> review");
  });

  it("honors include flags for legacy/custom prompt mode", () => {
    const out = buildRolePrompt({
      ...baseInput,
      role: "legacy",
      includeDefaultPrompt: false,
      includeRoleInstructions: false,
      includePostRun: false,
    });
    expect(out).not.toContain("Let's tackle the following project:");
    expect(out).not.toContain("## Your Role");
    expect(out).not.toContain("## IMPORTANT: MUST DO AFTER IMPLEMENTATION");
  });

  it("can omit role instruction section for role prompts", () => {
    const out = buildRolePrompt({
      ...baseInput,
      role: "worker",
      includeRoleInstructions: false,
    });
    expect(out).not.toContain("## Your Role: Worker");
  });
});
