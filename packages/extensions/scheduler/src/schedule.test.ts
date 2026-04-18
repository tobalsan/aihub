import { describe, it, expect } from "vitest";
import { computeNextRunAtMs } from "./schedule.js";
import type { IntervalSchedule, DailySchedule } from "@aihub/shared";

describe("computeNextRunAtMs", () => {
  describe("interval schedule", () => {
    it("computes next run for interval without startAt", () => {
      const schedule: IntervalSchedule = {
        type: "interval",
        everyMinutes: 5,
      };

      const now = Date.now();
      const next = computeNextRunAtMs(schedule, now);

      // Next run should be 5 minutes from now
      expect(next).toBe(now + 5 * 60 * 1000);
    });

    it("computes next run for interval with startAt in past", () => {
      const startAt = new Date("2024-01-01T00:00:00Z");
      const schedule: IntervalSchedule = {
        type: "interval",
        everyMinutes: 60,
        startAt: startAt.toISOString(),
      };

      // 30 minutes after start
      const now = startAt.getTime() + 30 * 60 * 1000;
      const next = computeNextRunAtMs(schedule, now);

      // Next run should be at 1 hour after start
      expect(next).toBe(startAt.getTime() + 60 * 60 * 1000);
    });

    it("computes next run for interval with startAt in future", () => {
      const now = Date.now();
      const startAt = new Date(now + 10 * 60 * 1000); // 10 min in future
      const schedule: IntervalSchedule = {
        type: "interval",
        everyMinutes: 5,
        startAt: startAt.toISOString(),
      };

      const next = computeNextRunAtMs(schedule, now);

      // Next run should be startAt time
      expect(next).toBe(startAt.getTime());
    });
  });

  describe("daily schedule", () => {
    it("computes next run for daily schedule", () => {
      const schedule: DailySchedule = {
        type: "daily",
        time: "09:00",
        timezone: "UTC",
      };

      // Use fixed date for consistent testing
      const date = new Date("2024-06-15T08:00:00Z"); // 8 AM UTC
      const next = computeNextRunAtMs(schedule, date.getTime());

      // Next run should be at 9 AM on same day
      expect(new Date(next).toISOString()).toContain("09:00:00");
    });

    it("schedules for next day if time has passed", () => {
      const schedule: DailySchedule = {
        type: "daily",
        time: "09:00",
        timezone: "UTC",
      };

      // 10 AM UTC - past scheduled time
      const date = new Date("2024-06-15T10:00:00Z");
      const next = computeNextRunAtMs(schedule, date.getTime());

      // Next run should be at 9 AM next day
      expect(next).toBeGreaterThan(date.getTime());
      expect(new Date(next).toISOString()).toContain("09:00:00");
    });

    it("handles non-UTC timezone correctly", () => {
      const schedule: DailySchedule = {
        type: "daily",
        time: "09:00",
        timezone: "America/New_York", // UTC-5 in winter
      };

      // Midnight UTC on winter day (NY UTC-5)
      const date = new Date("2024-01-15T00:00:00Z");
      const next = computeNextRunAtMs(schedule, date.getTime());

      // 9 AM New York time should be 14:00 UTC in winter (UTC-5)
      const nextDate = new Date(next);
      expect(nextDate.getUTCHours()).toBe(14);
      expect(nextDate.getUTCMinutes()).toBe(0);
    });

    it("handles timezone crossing month boundary correctly", () => {
      const schedule: DailySchedule = {
        type: "daily",
        time: "01:00",
        timezone: "Europe/Berlin", // UTC+1 winter, UTC+2 summer
      };

      // Jan 31 23:30 UTC -> Berlin Feb 1 00:30
      const date = new Date("2024-01-31T23:30:00Z");
      const next = computeNextRunAtMs(schedule, date.getTime());

      // In Berlin, Feb 1 00:30, so 01:00 Berlin still ahead
      // 01:00 Berlin = 00:00 UTC in winter
      const nextDate = new Date(next);
      expect(nextDate.getUTCMonth()).toBe(1); // February
      expect(nextDate.getUTCDate()).toBe(1);
      expect(nextDate.getUTCHours()).toBe(0);
    });

    it("handles month boundary correctly", () => {
      const schedule: DailySchedule = {
        type: "daily",
        time: "09:00",
        timezone: "UTC",
      };

      // Last day of January, after 9 AM
      const date = new Date("2024-01-31T10:00:00Z");
      const next = computeNextRunAtMs(schedule, date.getTime());

      // Should be Feb 1
      const nextDate = new Date(next);
      expect(nextDate.getUTCMonth()).toBe(1); // February
      expect(nextDate.getUTCDate()).toBe(1);
    });
  });
});
