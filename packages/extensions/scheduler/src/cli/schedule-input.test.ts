import { describe, expect, it } from "vitest";
import {
  buildScheduleFromOpts,
  defaultJobName,
  formatMinutes,
  formatSchedule,
  parseDailyTime,
  parseDurationMinutes,
  renderJobsTable,
} from "./schedule-input.js";

describe("parseDurationMinutes", () => {
  it("parses bare minutes (no suffix)", () => {
    expect(parseDurationMinutes("30")).toBe(30);
  });
  it("parses m/h/d suffixes", () => {
    expect(parseDurationMinutes("2m")).toBe(2);
    expect(parseDurationMinutes("3h")).toBe(180);
    expect(parseDurationMinutes("1d")).toBe(1440);
  });
  it("rejects garbage", () => {
    expect(() => parseDurationMinutes("foo")).toThrow(/Invalid duration/);
    expect(() => parseDurationMinutes("0m")).toThrow(/>= 1/);
  });
});

describe("parseDailyTime", () => {
  it("parses HH:MM", () => {
    expect(parseDailyTime("09:00")).toEqual({ hour: 9, minute: 0 });
    expect(parseDailyTime("23:59")).toEqual({ hour: 23, minute: 59 });
  });
  it("rejects bad formats", () => {
    expect(() => parseDailyTime("9:00")).toThrow(/Invalid time/);
    expect(() => parseDailyTime("24:00")).toThrow(/0-23/);
    expect(() => parseDailyTime("12:60")).toThrow(/0-59/);
  });
});

describe("buildScheduleFromOpts", () => {
  it("builds interval from --every", () => {
    expect(buildScheduleFromOpts({ every: "2h" })).toEqual({
      type: "interval",
      everyMinutes: 120,
    });
  });
  it("attaches startAt to interval", () => {
    const schedule = buildScheduleFromOpts({
      every: "1h",
      startAt: "2026-05-11T09:00:00Z",
    });
    expect(schedule).toEqual({
      type: "interval",
      everyMinutes: 60,
      startAt: "2026-05-11T09:00:00.000Z",
    });
  });
  it("builds daily from --daily", () => {
    expect(buildScheduleFromOpts({ daily: "09:00" })).toEqual({
      type: "daily",
      time: "09:00",
    });
  });
  it("attaches tz to daily", () => {
    expect(
      buildScheduleFromOpts({ daily: "09:00", tz: "America/New_York" })
    ).toEqual({ type: "daily", time: "09:00", timezone: "America/New_York" });
  });
  it("rejects both --every and --daily", () => {
    expect(() => buildScheduleFromOpts({ every: "1h", daily: "09:00" })).toThrow(
      /not both/
    );
  });
  it("rejects neither", () => {
    expect(() => buildScheduleFromOpts({})).toThrow(/Schedule required/);
  });
  it("rejects --tz without --daily", () => {
    expect(() => buildScheduleFromOpts({ every: "1h", tz: "UTC" })).toThrow(
      /--tz only applies to --daily/
    );
  });
  it("rejects --start-at without --every", () => {
    expect(() =>
      buildScheduleFromOpts({ daily: "09:00", startAt: "2026-05-11T00:00:00Z" })
    ).toThrow(/--start-at only applies to --every/);
  });
  it("rejects bad iso for --start-at", () => {
    expect(() =>
      buildScheduleFromOpts({ every: "1h", startAt: "not-a-date" })
    ).toThrow(/Invalid --start-at/);
  });
});

describe("defaultJobName", () => {
  it("derives interval name", () => {
    expect(defaultJobName("ops", { type: "interval", everyMinutes: 120 })).toBe(
      "ops-every-2h"
    );
    expect(defaultJobName("ops", { type: "interval", everyMinutes: 5 })).toBe(
      "ops-every-5m"
    );
  });
  it("derives daily name", () => {
    expect(
      defaultJobName("ops", { type: "daily", time: "09:00" })
    ).toBe("ops-daily-09:00");
  });
});

describe("formatMinutes", () => {
  it("collapses to coarse unit", () => {
    expect(formatMinutes(5)).toBe("5m");
    expect(formatMinutes(60)).toBe("1h");
    expect(formatMinutes(120)).toBe("2h");
    expect(formatMinutes(1440)).toBe("1d");
  });
});

describe("formatSchedule", () => {
  it("formats interval with optional startAt", () => {
    expect(formatSchedule({ type: "interval", everyMinutes: 60 })).toBe(
      "every 1h"
    );
    expect(
      formatSchedule({
        type: "interval",
        everyMinutes: 60,
        startAt: "2026-05-11T09:00:00Z",
      })
    ).toBe("every 1h @ 2026-05-11T09:00:00Z");
  });
  it("formats daily with optional tz", () => {
    expect(formatSchedule({ type: "daily", time: "09:00" })).toBe(
      "daily 09:00"
    );
    expect(
      formatSchedule({
        type: "daily",
        time: "09:00",
        timezone: "America/New_York",
      })
    ).toBe("daily 09:00 America/New_York");
  });
});

describe("renderJobsTable", () => {
  it("renders the header and a row", () => {
    const out = renderJobsTable([
      {
        id: "abc",
        name: "Hourly",
        agentId: "ops",
        enabled: true,
        schedule: { type: "interval", everyMinutes: 60 },
        payload: { message: "go" },
        state: { nextRunAtMs: Date.UTC(2026, 4, 11, 9, 0, 0), lastStatus: "ok" },
      },
    ]);
    expect(out).toContain("| id | name | agent | schedule | next-run | last-status |");
    expect(out).toContain("abc");
    expect(out).toContain("every 1h");
    expect(out).toContain("2026-05-11T09:00:00.000Z");
    expect(out).toContain("ok");
  });
});
