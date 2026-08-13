/**
 * Pure occurrence-calendar math for message scheduling. Deliberately has no Firestore
 * access — callers (scheduleManagement.ts, scheduledMessagesPoller.ts) fetch the school's
 * custom holiday periods once, build an `isBlocked` predicate with
 * `kenyanHolidays.isDateBlockedForSchool`, and pass it in here.
 *
 * Mirrored on the frontend at src/utils/scheduleCalendar.ts for live cost previews — keep
 * both in sync.
 */

import { ScheduleFrequency } from "./scheduleTypes";

/** Safety cap so a misconfigured schedule (e.g. all dates blocked) can't loop forever. */
const MAX_LOOKAHEAD_DAYS = 730;

function toDate(dateStr: string): Date {
  return new Date(dateStr + "T00:00:00Z");
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = toDate(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return toDateStr(d);
}

/**
 * First valid (non-blocked) date at or after `fromDateInclusive`, stepping by 1 day for
 * 'once'/'daily' schedules or 7 days for 'weekly' ones. Returns null if nothing valid is
 * found within MAX_LOOKAHEAD_DAYS (e.g. every date in range is a holiday) or `endDate` is
 * passed before a valid date is found.
 */
export function findNextValidDate(
  frequency: ScheduleFrequency,
  fromDateInclusive: string,
  isBlocked: (dateStr: string) => boolean,
  endDate?: string,
): string | null {
  const step = frequency === "weekly" ? 7 : 1;
  let candidate = fromDateInclusive;
  for (let i = 0; i < MAX_LOOKAHEAD_DAYS; i++) {
    if (endDate && candidate > endDate) return null;
    if (!isBlocked(candidate)) return candidate;
    candidate = addDays(candidate, step);
  }
  return null;
}

/**
 * The date STRICTLY after `fromDate` on the schedule's cadence — used to advance a schedule
 * once an occurrence has fired. For 'once' schedules this always returns null (there is no
 * next occurrence).
 */
export function findNextOccurrenceAfter(
  frequency: ScheduleFrequency,
  fromDate: string,
  isBlocked: (dateStr: string) => boolean,
  endDate?: string,
): string | null {
  if (frequency === "once") return null;
  const step = frequency === "weekly" ? 7 : 1;
  return findNextValidDate(frequency, addDays(fromDate, step), isBlocked, endDate);
}

/**
 * Total number of valid occurrences a schedule will run between startDate and endDate
 * inclusive, honouring the cadence and the blocked-date predicate. Used at creation/edit
 * time to size the token reservation. For 'once', this is 1 if startDate itself is valid,
 * else 0 (caller should reject/ask the admin to pick a different date in that case).
 */
export function countOccurrences(
  frequency: ScheduleFrequency,
  startDate: string,
  endDate: string | undefined,
  isBlocked: (dateStr: string) => boolean,
): number {
  if (frequency === "once") {
    return isBlocked(startDate) ? 0 : 1;
  }
  if (!endDate) {
    throw new Error("endDate is required for daily/weekly schedules.");
  }
  const step = frequency === "weekly" ? 7 : 1;
  let count = 0;
  let candidate = startDate;
  let guard = 0;
  while (candidate <= endDate && guard < MAX_LOOKAHEAD_DAYS) {
    if (!isBlocked(candidate)) count++;
    candidate = addDays(candidate, step);
    guard++;
  }
  return count;
}

/** Combines a 'YYYY-MM-DD' date and 'HH:mm' Africa/Nairobi time into a UTC ISO datetime
 * string (Nairobi is UTC+3, no DST). */
export function toNairobiIsoDateTime(dateStr: string, timeOfDay: string): string {
  const [h, m] = timeOfDay.split(":").map(Number);
  const utcHour = h - 3; // Africa/Nairobi = UTC+3
  const d = toDate(dateStr);
  d.setUTCHours(utcHour, m || 0, 0, 0);
  return d.toISOString();
}
