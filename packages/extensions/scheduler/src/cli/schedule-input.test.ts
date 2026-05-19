import { describe, expect, it } from "vitest";
import {
  buildScheduleFromOpts,
  defaultJobName,
  renderJobsTable,
} from "./schedule-input.js";

describe("buildScheduleFromOpts", () => {
  it("builds cron schedule", () => {
    expect(buildScheduleFromOpts({ cron: "0 8 * * *", tz: "UTC" })).toEqual({
      cron: "0 8 * * *",
      tz: "UTC",
    });
  });

  it("attaches startAt", () => {
    expect(
      buildScheduleFromOpts({
        cron: "*/30 * * * *",
        tz: "Europe/Paris",
        startAt: "2026-05-11T09:00:00Z",
      })
    ).toEqual({
      cron: "*/30 * * * *",
      tz: "Europe/Paris",
      startAt: "2026-05-11T09:00:00.000Z",
    });
  });

  it("requires cron and timezone", () => {
    expect(() => buildScheduleFromOpts({ tz: "UTC" })).toThrow(/--cron/);
    expect(() => buildScheduleFromOpts({ cron: "* * * * *" })).toThrow(/--tz/);
  });
});

describe("defaultJobName", () => {
  it("derives cron name", () => {
    expect(defaultJobName("ops", { cron: "0 8 * * *", tz: "UTC" })).toBe(
      "ops-0-8-*-*-*"
    );
  });
});

describe("renderJobsTable", () => {
  it("renders the header and a row", () => {
    const out = renderJobsTable([
      {
        id: "abc",
        name: "Morning",
        agentId: "ops",
        enabled: true,
        schedule: { cron: "0 8 * * *", tz: "UTC" },
        payload: { message: "go" },
        state: { nextRunAtMs: Date.UTC(2026, 4, 11, 9, 0, 0), lastStatus: "ok" },
      },
    ]);
    expect(out).toContain("| id | name | agent | schedule | next-run | last-status |");
    expect(out).toContain("abc");
    expect(out).toContain("0 8 * * * UTC");
    expect(out).toContain("2026-05-11T09:00:00.000Z");
    expect(out).toContain("ok");
  });
});
