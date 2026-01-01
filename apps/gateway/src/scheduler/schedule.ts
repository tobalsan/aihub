import type { Schedule, IntervalSchedule, DailySchedule } from "@aihub/shared";

export function computeNextRunAtMs(schedule: Schedule, nowMs: number): number {
  if (schedule.type === "interval") {
    return computeIntervalNext(schedule, nowMs);
  }
  return computeDailyNext(schedule, nowMs);
}

function computeIntervalNext(schedule: IntervalSchedule, nowMs: number): number {
  const intervalMs = schedule.everyMinutes * 60 * 1000;

  if (schedule.startAt) {
    const startMs = new Date(schedule.startAt).getTime();
    if (startMs > nowMs) return startMs;

    const elapsed = nowMs - startMs;
    const intervals = Math.floor(elapsed / intervalMs);
    return startMs + (intervals + 1) * intervalMs;
  }

  // No startAt: next run is now + interval
  return nowMs + intervalMs;
}

/**
 * Get the UTC offset in minutes for a timezone at a specific instant.
 * Uses Intl.DateTimeFormat to get the local representation, then computes
 * the difference using Date.UTC for accurate month/year boundary handling.
 */
function getTimezoneOffsetMinutes(tz: string, date: Date): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const getPart = (type: string) => parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10);

  const tzYear = getPart("year");
  const tzMonth = getPart("month");
  const tzDay = getPart("day");
  const tzHour = getPart("hour");
  const tzMinute = getPart("minute");
  const tzSecond = getPart("second");

  // Construct the same wall-clock time as UTC to get the offset
  const tzAsUtcMs = Date.UTC(tzYear, tzMonth - 1, tzDay, tzHour, tzMinute, tzSecond);
  const actualUtcMs = date.getTime();

  // Offset = how much the TZ is ahead of UTC (positive = east of UTC)
  return Math.round((tzAsUtcMs - actualUtcMs) / 60000);
}

/**
 * Convert a local time in a timezone to UTC milliseconds.
 * Uses binary search to handle DST edge cases.
 */
function localTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz: string
): number {
  // Start with the naive assumption (treat local as UTC)
  const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0);

  // Get the offset at this approximate time
  const offset = getTimezoneOffsetMinutes(tz, new Date(naiveUtcMs));

  // The actual UTC time is earlier if TZ is ahead of UTC
  const candidateUtcMs = naiveUtcMs - offset * 60000;

  // Verify by checking the offset at the candidate time (handles DST)
  const verifyOffset = getTimezoneOffsetMinutes(tz, new Date(candidateUtcMs));
  if (verifyOffset !== offset) {
    // DST transition - use the verified offset
    return naiveUtcMs - verifyOffset * 60000;
  }

  return candidateUtcMs;
}

function computeDailyNext(schedule: DailySchedule, nowMs: number): number {
  const [hours, minutes] = schedule.time.split(":").map(Number);
  const tz = schedule.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Get the current date/time in the target timezone
  const now = new Date(nowMs);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const getPart = (type: string) => parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10);

  const currentHour = getPart("hour");
  const currentMinute = getPart("minute");
  const currentYear = getPart("year");
  const currentMonth = getPart("month");
  const currentDay = getPart("day");

  // Check if we've passed today's scheduled time
  const todayPassed =
    currentHour > hours || (currentHour === hours && currentMinute >= minutes);

  // Calculate the target date (today or tomorrow in target timezone)
  let targetYear = currentYear;
  let targetMonth = currentMonth;
  let targetDay = currentDay;

  if (todayPassed) {
    // Increment day, handling month/year boundaries
    const daysInMonth = new Date(targetYear, targetMonth, 0).getDate();
    targetDay++;
    if (targetDay > daysInMonth) {
      targetDay = 1;
      targetMonth++;
      if (targetMonth > 12) {
        targetMonth = 1;
        targetYear++;
      }
    }
  }

  // Convert the target local time to UTC
  return localTimeToUtc(targetYear, targetMonth, targetDay, hours, minutes, tz);
}
