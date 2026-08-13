/**
 * Pure occurrence-calendar math for message scheduling — mirrors functions/src/scheduleCalendar.ts
 * exactly (see the note there on why this is a separate copy, not a shared import). Used here
 * for the live "N sends, X tokens" preview in ScheduleComposerModal; the Cloud Function
 * re-derives the authoritative figures at create/edit time.
 */
import { ScheduleFrequency } from '../types';

const MAX_LOOKAHEAD_DAYS = 730;

function toDate(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00Z');
}
function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(dateStr: string, days: number): string {
  const d = toDate(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return toDateStr(d);
}

export function findNextValidDate(
  frequency: ScheduleFrequency,
  fromDateInclusive: string,
  isBlocked: (dateStr: string) => boolean,
  endDate?: string,
): string | null {
  const step = frequency === 'weekly' ? 7 : 1;
  let candidate = fromDateInclusive;
  for (let i = 0; i < MAX_LOOKAHEAD_DAYS; i++) {
    if (endDate && candidate > endDate) return null;
    if (!isBlocked(candidate)) return candidate;
    candidate = addDays(candidate, step);
  }
  return null;
}

export function findNextOccurrenceAfter(
  frequency: ScheduleFrequency,
  fromDate: string,
  isBlocked: (dateStr: string) => boolean,
  endDate?: string,
): string | null {
  if (frequency === 'once') return null;
  const step = frequency === 'weekly' ? 7 : 1;
  return findNextValidDate(frequency, addDays(fromDate, step), isBlocked, endDate);
}

export function countOccurrences(
  frequency: ScheduleFrequency,
  startDate: string,
  endDate: string | undefined,
  isBlocked: (dateStr: string) => boolean,
): number {
  if (frequency === 'once') {
    return isBlocked(startDate) ? 0 : 1;
  }
  if (!endDate) return 0;
  const step = frequency === 'weekly' ? 7 : 1;
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
