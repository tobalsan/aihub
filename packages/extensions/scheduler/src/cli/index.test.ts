import { describe, expect, it } from "vitest";
import { buildCreateBody, buildUpdateBody } from "./index.js";

describe("buildCreateBody", () => {
  it("defaults the name from agent + schedule", () => {
    const body = buildCreateBody({
      agent: "ops",
      message: "run check",
      every: "1h",
    });
    expect(body).toEqual({
      name: "ops-every-1h",
      agentId: "ops",
      schedule: { type: "interval", everyMinutes: 60 },
      payload: { message: "run check" },
    });
  });

  it("uses provided --name", () => {
    const body = buildCreateBody({
      agent: "ops",
      message: "run check",
      every: "1h",
      name: "Hourly Check",
    });
    expect(body.name).toBe("Hourly Check");
  });

  it("passes through --session", () => {
    const body = buildCreateBody({
      agent: "ops",
      message: "run check",
      daily: "09:00",
      session: "agent:ops:main",
    });
    expect(body.payload).toEqual({
      message: "run check",
      sessionId: "agent:ops:main",
    });
    expect(body.schedule).toEqual({ type: "daily", time: "09:00" });
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

  it("rebuilds schedule when --every is given", () => {
    expect(buildUpdateBody({ every: "30m" })).toEqual({
      schedule: { type: "interval", everyMinutes: 30 },
    });
  });

  it("rejects --tz alone (no --daily) as a partial schedule update", () => {
    expect(() => buildUpdateBody({ tz: "UTC" })).toThrow(
      /Schedule changes require/
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
