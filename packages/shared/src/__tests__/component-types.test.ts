import { describe, expect, it } from "vitest";
import {
  CapabilitiesResponseSchema,
  ComponentsConfigSchema,
  DiscordComponentConfigSchema,
  LangfuseComponentConfigSchema,
  type Component,
  type ComponentContext,
  type ValidationResult,
} from "../types.js";

describe("component config schemas", () => {
  it("parses discord component config", () => {
    const result = DiscordComponentConfigSchema.parse({
      token: "$env:DISCORD_TOKEN",
      channels: {
        "123": { agent: "main" },
      },
      dm: { enabled: true, agent: "main" },
      historyLimit: 20,
      replyToMode: "off",
    });

    expect(result.channels?.["123"]?.agent).toBe("main");
    expect(result.dm?.agent).toBe("main");
  });

  it("rejects invalid discord component config", () => {
    const result = DiscordComponentConfigSchema.safeParse({
      token: "$env:DISCORD_TOKEN",
      historyLimit: -1,
    });

    expect(result.success).toBe(false);
  });

  it("parses and rejects langfuse component config", () => {
    const valid = LangfuseComponentConfigSchema.parse({
      enabled: true,
      baseUrl: "https://cloud.langfuse.com",
      publicKey: "$env:LANGFUSE_PUBLIC_KEY",
      secretKey: "$env:LANGFUSE_SECRET_KEY",
      flushAt: 15,
      flushInterval: 10000,
      debug: false,
    });

    const invalid = LangfuseComponentConfigSchema.safeParse({
      enabled: true,
      debug: "no",
    });

    expect(valid.flushAt).toBe(15);
    expect(invalid.success).toBe(false);
  });

  it("parses component map", () => {
    const result = ComponentsConfigSchema.parse({
      scheduler: { tickSeconds: 60 },
      heartbeat: { enabled: true },
      projects: { root: "~/projects" },
      langfuse: {
        enabled: true,
        publicKey: "$env:LANGFUSE_PUBLIC_KEY",
        secretKey: "$env:LANGFUSE_SECRET_KEY",
      },
    });

    if (!result) {
      throw new Error("Expected components config");
    }
    expect(result.scheduler?.tickSeconds).toBe(60);
    expect(result.projects?.root).toBe("~/projects");
    expect(result.langfuse?.enabled).toBe(true);
  });

  it("parses capabilities response", () => {
    const result = CapabilitiesResponseSchema.parse({
      version: 2,
      components: { scheduler: true, projects: false },
      agents: ["main"],
      multiUser: false,
    });

    expect(result.components.scheduler).toBe(true);
  });

  it("exports component contracts", () => {
    const validation: ValidationResult = { valid: true, errors: [] };
    const ctx = {} as ComponentContext;
    const component: Component = {
      id: "scheduler",
      displayName: "Scheduler",
      dependencies: [],
      requiredSecrets: [],
      routePrefixes: ["/api/schedules"],
      validateConfig: () => validation,
      registerRoutes: () => undefined,
      start: async (_context) => {
        void _context;
      },
      stop: async () => undefined,
      capabilities: () => ["schedules"],
    };

    expect(component.validateConfig({})).toEqual(validation);
    expect(ctx).toBeDefined();
  });
});
