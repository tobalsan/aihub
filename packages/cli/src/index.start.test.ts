import { describe, expect, it } from "vitest";
import { buildStartRequestBody } from "./index.js";

describe("apm start request body mapping", () => {
  it("maps template and role options", () => {
    const { body, errors } = buildStartRequestBody({
      agent: "codex",
      mode: "worktree",
      template: "worker",
      promptRole: "reviewer",
    });

    expect(errors).toEqual([]);
    expect(body).toMatchObject({
      runAgent: "cli:codex",
      runMode: "worktree",
      template: "worker",
      promptRole: "reviewer",
    });
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
