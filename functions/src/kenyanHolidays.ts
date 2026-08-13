/**
 * Server-side mirror of `src/utils/kenyanHolidays.ts`. Kept in sync manually — this is a
 * separate TypeScript build (Cloud Functions) with no shared package configured against the
 * frontend. If you change the holiday list in one file, change it in the other too.
 */

export type BoardingType = 'day' | 'boarding';

function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, days: number): Date {
  const copy = new Date(d.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

const FIXED_HOLIDAYS: { month: number; day: number; name: string }[] = [
  { month: 1, day: 1,   name: "New Year's Day" },
  { month: 5, day: 1,   name: 'Labour Day' },
  { month: 6, day: 1,   name: 'Madaraka Day' },
  { month: 10, day: 20, name: 'Mashujaa Day' },
  { month: 12, day: 12, name: 'Jamhuri Day' },
  { month: 12, day: 25, name: 'Christmas Day' },
  { month: 12, day: 26, name: 'Boxing Day' },
];

// Mirror MANUALLY_GAZETTED in src/utils/kenyanHolidays.ts when updating.
const MANUALLY_GAZETTED: Record<string, string> = {
  // '2026-03-20': 'Eid al-Fitr (provisional)',
};

export function getKenyanHolidayName(dateStr: string): string | null {
  const d = new Date(dateStr + 'T00:00:00Z');
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();

  const fixed = FIXED_HOLIDAYS.find(h => h.month === month && h.day === day);
  if (fixed) return fixed.name;

  const easter = easterSunday(year);
  if (toDateStr(addDays(easter, -2)) === dateStr) return 'Good Friday';
  if (toDateStr(addDays(easter, 1)) === dateStr) return 'Easter Monday';

  if (MANUALLY_GAZETTED[dateStr]) return MANUALLY_GAZETTED[dateStr];

  return null;
}

export function isKenyanHoliday(dateStr: string): boolean {
  return getKenyanHolidayName(dateStr) !== null;
}

export function isWeekend(dateStr: string): boolean {
  const day = new Date(dateStr + 'T00:00:00Z').getUTCDay();
  return day === 0 || day === 6;
}

export function isRegisterRequired(dateStr: string, boardingType: BoardingType | undefined): { required: boolean; reason?: string } {
  if (boardingType === 'boarding') return { required: true };
  const holiday = getKenyanHolidayName(dateStr);
  if (holiday) return { required: false, reason: `Public holiday — ${holiday}` };
  if (isWeekend(dateStr)) return { required: false, reason: 'Weekend' };
  return { required: true };
}

/**
 * A school-defined holiday period — mid-term breaks, school-specific closures, or a
 * public holiday the school has added manually (e.g. one gazetted late/regionally, before
 * MANUALLY_GAZETTED above is updated). Single-day holidays have startDate === endDate.
 * Mirrors the shape of the `schoolHolidays` Firestore doc — kept minimal here since this
 * file has no Firestore access; callers pass in whatever periods they've already fetched.
 */
export interface HolidayPeriodRange {
  startDate: string; // 'YYYY-MM-DD'
  endDate: string;   // 'YYYY-MM-DD', inclusive
}

/** True if dateStr falls within any of the given (inclusive) custom holiday periods. */
export function isInCustomHolidayPeriod(dateStr: string, periods: HolidayPeriodRange[]): boolean {
  return periods.some(p => dateStr >= p.startDate && dateStr <= p.endDate);
}

/**
 * Combined check used by both register reminders and message scheduling: is this date
 * one on which nothing automated should fire for this school? Considers, in order: boarding
 * override, gazetted public holidays, the school's own custom holiday periods, and (only if
 * `includeWeekends` is false) weekends. `includeWeekends` defaults to false to match the
 * existing day-school register behaviour; pass `true` for schedules that explicitly opt in
 * to running on weekends.
 */
export function isDateBlockedForSchool(
  dateStr: string,
  boardingType: BoardingType | undefined,
  customPeriods: HolidayPeriodRange[],
  includeWeekends = false,
): { blocked: boolean; reason?: string } {
  // Boarding schools ignore public holidays and weekends for the register itself, but a
  // school-defined closure (mid-term break, students sent home, etc.) still applies.
  const holiday = getKenyanHolidayName(dateStr);
  if (holiday && boardingType !== 'boarding') return { blocked: true, reason: `Public holiday — ${holiday}` };
  if (isInCustomHolidayPeriod(dateStr, customPeriods)) return { blocked: true, reason: 'School holiday period' };
  if (!includeWeekends && isWeekend(dateStr) && boardingType !== 'boarding') return { blocked: true, reason: 'Weekend' };
  return { blocked: false };
}

/** Today's date in East Africa Time (UTC+3, no DST) as 'YYYY-MM-DD'. */
export function todayEAT(): string {
  const now = new Date();
  const eat = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  return eat.toISOString().slice(0, 10);
}
