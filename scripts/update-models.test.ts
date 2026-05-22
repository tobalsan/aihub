import { describe, expect, it } from "vitest";

import {
  addMissingFromModelsDev,
  collectConfiguredModels,
  contextFromModelsConfig,
  contextFromOpenRouter,
} from "./update-models.js";

describe("update-models helpers", () => {
  it("collects models from aihub.json and models.json providers", () => {
    const models = collectConfiguredModels(
      {
        agents: [
          {
            model: { model: "openrouter-model" },
            subagents: [{ model: "subagent-model" }],
          },
        ],
      },
      {
        providers: {
          custom: {
            models: [
              {
                id: "custom-array-model",
                displayName: "Custom",
                contextWindow: 321_000,
              },
            ],
          },
          overrides: {
            modelOverrides: {
              "override-model": { contextWindow: 654_000 },
            },
          },
        },
      }
    );

    expect([...models].sort()).toEqual([
      "custom-array-model",
      "openrouter-model",
      "override-model",
      "subagent-model",
    ]);
  });

  it("uses context windows defined in models.json", () => {
    expect(
      contextFromModelsConfig({
        providers: {
          custom: {
            models: [{ id: "custom-model", contextWindow: 321_000 }],
            modelOverrides: {
              "override-model": { contextWindow: 654_000 },
            },
          },
        },
      })
    ).toEqual({
      "custom-model": 321_000,
      "override-model": 654_000,
    });
  });

  it("fills only missing configured models from models.dev fallback", () => {
    const configured = new Set([
      "openrouter-model",
      "fallback-model",
      "router/kimi-k2.5",
    ]);
    const openRouterResult = contextFromOpenRouter(
      [
        { id: "openrouter-model", context_length: 123_000 },
        { id: "unconfigured-model", context_length: 456_000 },
      ],
      configured,
      false
    );

    const result = addMissingFromModelsDev(
      openRouterResult,
      {
        provider: {
          models: {
            "openrouter-model": {
              id: "openrouter-model",
              limit: { context: 999_000 },
            },
            "fallback-model": {
              id: "fallback-model",
              limit: { context: 789_000 },
            },
            "kimi-k2.5": {
              id: "kimi-k2.5",
              limit: { context: 262_000 },
            },
          },
        },
      },
      configured,
      false
    );

    expect(result).toEqual({
      "fallback-model": 789_000,
      "openrouter-model": 123_000,
      "router/kimi-k2.5": 262_000,
    });
  });
});
