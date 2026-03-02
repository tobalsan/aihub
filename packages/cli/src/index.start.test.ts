import { describe, expect, it } from "vitest";
import { buildStartRequestBody } from "./index.js";

describe("apm start request body mapping", () => {
  it("maps template defaults from UI presets", () => {
    const { body, errors } = buildStartRequestBody({
      template: "worker",
    });

    expect(errors).toEqual([]);
    expect(body).toMatchObject({
      template: "worker",
      runAgent: "cli:codex",
      model: "gpt-5.3-codex",
      reasoningEffort: "medium",
      includeDefaultPrompt: true,
      includeRoleInstructions: true,
      includePostRun: true,
    });
  });

  it("lets explicit options override template defaults", () => {
    const { body, errors } = buildStartRequestBody({
      template: "coordinator",
      agent: "codex",
      model: "gpt-5.2",
      promptRole: "reviewer",
      includePostRun: true,
    });

    expect(errors).toEqual([]);
    expect(body).toMatchObject({
      template: "coordinator",
      runAgent: "cli:codex",
      model: "gpt-5.2",
      promptRole: "reviewer",
      includePostRun: true,
    });
  });

  it("maps template reasoning default to thinking when agent is pi", () => {
    const { body, errors } = buildStartRequestBody({
      template: "coordinator",
      agent: "pi",
    });

    expect(errors).toEqual([]);
    expect(body).toMatchObject({
      template: "coordinator",
      runAgent: "cli:pi",
      model: "qwen3.5-plus",
      thinking: "medium",
    });
    expect(body).not.toHaveProperty("reasoningEffort");
  });

  it("normalizes model and effort when agent override changes harness", () => {
    const { body, errors } = buildStartRequestBody({
      template: "custom",
      agent: "claude",
    });

    expect(errors).toEqual([]);
    expect(body).toMatchObject({
      template: "custom",
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
