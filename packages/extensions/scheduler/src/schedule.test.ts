import { describe, it, expect } from "vitest";
import { computeNextRunAtMs } from "./schedule.js";

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

describe("computeNextRunAtMs", () => {
  it("computes next cron run in UTC", () => {
    const next = computeNextRunAtMs(
      { cron: "0 9 * * *", tz: "UTC" },
      new Date("2024-06-15T08:00:00Z").getTime()
    );

    expect(iso(next)).toBe("2024-06-15T09:00:00.000Z");
  });

  it("schedules next day when today's cron time has passed", () => {
    const next = computeNextRunAtMs(
      { cron: "0 9 * * *", tz: "UTC" },
      new Date("2024-06-15T10:00:00Z").getTime()
    );

    expect(iso(next)).toBe("2024-06-16T09:00:00.000Z");
  });

  it("uses timezone", () => {
    const next = computeNextRunAtMs(
      { cron: "0 9 * * *", tz: "America/New_York" },
      new Date("2024-01-15T00:00:00Z").getTime()
    );

    expect(iso(next)).toBe("2024-01-15T14:00:00.000Z");
  });
});
