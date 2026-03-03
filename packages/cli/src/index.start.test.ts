import { describe, expect, it } from "vitest";
import { buildStartRequestBody } from "./index.js";

describe("apm start request body mapping", () => {
  it("sends template-only profile by default (server applies defaults)", () => {
    const { body, errors } = buildStartRequestBody({
      template: "worker",
    });

    expect(errors).toEqual([]);
    expect(body).toEqual({
      template: "worker",
    });
  });

  it("allows non-locked fields with template (slug/name/custom prompt flow)", () => {
    const { body, errors } = buildStartRequestBody({
      template: "worker",
      slug: "worker-sidebar-recent",
      name: "Worker Sidebar Recent",
    });

    expect(errors).toEqual([]);
    expect(body).toEqual({
      template: "worker",
      slug: "worker-sidebar-recent",
      name: "Worker Sidebar Recent",
    });
  });

  it("rejects locked template overrides without escape hatch", () => {
    const { body, errors } = buildStartRequestBody({
      template: "coordinator",
      agent: "codex",
    });

    expect(body).toEqual({
      template: "coordinator",
    });
    expect(errors).toEqual([
      "Template profile locked. Use --allow-template-overrides to override.",
    ]);
  });

  it("lets explicit options override template defaults with escape hatch", () => {
    const { body, errors } = buildStartRequestBody({
      template: "coordinator",
      allowTemplateOverrides: true,
      agent: "codex",
      model: "gpt-5.2",
      promptRole: "reviewer",
      mode: "worktree",
      includePostRun: true,
    });

    expect(errors).toEqual([]);
    expect(body).toMatchObject({
      template: "coordinator",
      allowTemplateOverrides: true,
      runAgent: "cli:codex",
      model: "gpt-5.2",
      promptRole: "reviewer",
      runMode: "worktree",
      includePostRun: true,
    });
  });

  it("maps template reasoning default to thinking when agent is pi", () => {
    const { body, errors } = buildStartRequestBody({
      template: "coordinator",
      allowTemplateOverrides: true,
      agent: "pi",
    });

    expect(errors).toEqual([]);
    expect(body).toMatchObject({
      template: "coordinator",
      runAgent: "cli:pi",
      runMode: "none",
      model: "qwen3.5-plus",
      thinking: "medium",
    });
    expect(body).not.toHaveProperty("reasoningEffort");
  });

  it("normalizes model and effort when agent override changes harness", () => {
    const { body, errors } = buildStartRequestBody({
      template: "custom",
      allowTemplateOverrides: true,
      agent: "claude",
    });

    expect(errors).toEqual([]);
    expect(body).toMatchObject({
      template: "custom",
      runMode: "clone",
      runAgent: "cli:claude",
      model: "opus",
      reasoningEffort: "high",
    });
    expect(body).not.toHaveProperty("thinking");
  });

  it("maps include/exclude toggles with exclude precedence", () => {
    const { body, errors } = buildStartRequestBody({
      includeDefaultPrompt: true,
      excludeDefaultPrompt: true,
      includeRoleInstructions: true,
      excludePostRun: true,
    });

    expect(errors).toEqual([]);
    expect(body).toMatchObject({
      includeDefaultPrompt: false,
      includeRoleInstructions: true,
      includePostRun: false,
    });
  });

  it("returns validation errors for invalid template values", () => {
    const { body, errors } = buildStartRequestBody({
      template: "bad",
      promptRole: "also-bad",
    });

    expect(body).toEqual({});
    expect(errors).toEqual([
      "Invalid --template value. Use coordinator|worker|reviewer|custom.",
      "Invalid --prompt-role value. Use coordinator|worker|reviewer|legacy.",
    ]);
  });
});
