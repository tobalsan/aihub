import { describe, expect, it } from "vitest";
import { buildCreateBody, buildUpdateBody } from "./index.js";

describe("buildCreateBody", () => {
  it("defaults the name from agent + schedule", () => {
    const body = buildCreateBody("ops", {
      message: "run check",
      cron: "0 * * * *",
      tz: "UTC",
    });
    expect(body).toEqual({
      name: "ops-0-*-*-*-*",
      agentId: "ops",
      schedule: { cron: "0 * * * *", tz: "UTC" },
      payload: { message: "run check" },
    });
  });

  it("uses provided --name", () => {
    const body = buildCreateBody("ops", {
      message: "run check",
      cron: "0 * * * *",
      tz: "UTC",
      name: "Hourly Check",
    });
    expect(body.name).toBe("Hourly Check");
  });

  it("passes through model override", () => {
    const body = buildCreateBody("ops", {
      message: "run check",
      cron: "0 9 * * *",
      tz: "UTC",
      provider: "anthropic",
      model: "claude-sonnet-4",
    });

    expect(body.model).toEqual({ provider: "anthropic", model: "claude-sonnet-4" });
  });

  it("rejects partial model override", () => {
    expect(() =>
      buildCreateBody("ops", {
        message: "run check",
        cron: "0 9 * * *",
        tz: "UTC",
        provider: "anthropic",
      })
    ).toThrow(/Both --provider and --model/);
  });

  it("passes through --session", () => {
    const body = buildCreateBody("ops", {
      message: "run check",
      cron: "0 9 * * *",
      tz: "UTC",
      session: "agent:ops:main",
    });
    expect(body.payload).toEqual({
      message: "run check",
      sessionId: "agent:ops:main",
    });
    expect(body.schedule).toEqual({ cron: "0 9 * * *", tz: "UTC" });
  });
});

describe("buildUpdateBody", () => {
  it("maps --enable / --disable", () => {
    expect(buildUpdateBody({ enable: true })).toEqual({ enabled: true });
    expect(buildUpdateBody({ disable: true })).toEqual({ enabled: false });
  });

  it("rejects --enable + --disable together", () => {
    expect(() => buildUpdateBody({ enable: true, disable: true })).toThrow(
      /not both/
    );
  });

  it("rebuilds schedule when --cron is given", () => {
    expect(buildUpdateBody({ cron: "*/30 * * * *", tz: "UTC" })).toEqual({
      schedule: { cron: "*/30 * * * *", tz: "UTC" },
    });
  });

  it("rejects partial schedule update", () => {
    expect(() => buildUpdateBody({ tz: "UTC" })).toThrow(/--cron/);
  });

  it("maps model override", () => {
    expect(buildUpdateBody({ provider: "openai", model: "gpt-5" })).toEqual({
      model: { provider: "openai", model: "gpt-5" },
    });
  });

  it("rejects partial model update", () => {
    expect(() => buildUpdateBody({ model: "gpt-5" })).toThrow(
      /Both --provider and --model/
    );
  });

  it("rejects empty patch", () => {
    expect(() => buildUpdateBody({})).toThrow(/Nothing to update/);
  });

  it("builds payload from -m and --session", () => {
    expect(
      buildUpdateBody({ message: "new", session: "agent:x:main" })
    ).toEqual({
      payload: { message: "new", sessionId: "agent:x:main" },
    });
  });

  it("rejects --session without -m (server replaces payload)", () => {
    expect(() => buildUpdateBody({ session: "x" })).toThrow(/-m <message>/);
  });

  it("renames", () => {
    expect(buildUpdateBody({ name: "renamed" })).toEqual({ name: "renamed" });
  });
});
