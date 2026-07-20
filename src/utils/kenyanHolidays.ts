/**
 * Kenyan public holiday calendar + weekday helpers, used to decide whether a register is
 * even required on a given day: day schools don't need one on weekends or gazetted public
 * holidays; boarding schools always do (students are on-site regardless).
 *
 * IMPORTANT: this file is mirrored (not imported) in `functions/src/kenyanHolidays.ts` because
 * the Cloud Functions build is a separate TypeScript project with no shared package configured.
 * If you change the holiday list here, update the other copy too.
 */
import { BoardingType } from '../types';

/** Computes Easter Sunday (Gregorian) for a given year — Anonymous Gregorian algorithm. */
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
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
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

/**
 * Gazetted Kenyan public holidays that fall on a fixed date every year, plus the two
 * Easter-derived ones (computed). Moveable Islamic holidays (Eid al-Fitr, Eid al-Haji) are
 * lunar-based and gazetted year by year — add confirmed dates to `MANUALLY_GAZETTED` below
 * once the Kenyan government announces them; they cannot be reliably computed in advance.
 */
const FIXED_HOLIDAYS: { month: number; day: number; name: string }[] = [
  { month: 1, day: 1,   name: "New Year's Day" },
  { month: 5, day: 1,   name: 'Labour Day' },
  { month: 6, day: 1,   name: 'Madaraka Day' },
  { month: 10, day: 20, name: 'Mashujaa Day' },
  { month: 12, day: 12, name: 'Jamhuri Day' },
  { month: 12, day: 25, name: 'Christmas Day' },
  { month: 12, day: 26, name: 'Boxing Day' },
];

/** Confirmed-by-gazette moveable holidays, keyed by ISO date. Extend as each year's dates
 * (Eid al-Fitr, Eid al-Haji, and any one-off gazetted public holiday) are announced. */
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

/** ISO date string ('YYYY-MM-DD') -> true if Saturday or Sunday. */
export function isWeekend(dateStr: string): boolean {
  const day = new Date(dateStr + 'T00:00:00Z').getUTCDay();
  return day === 0 || day === 6;
}

/**
 * Whether a register is expected to be marked on this date for this school.
 * Boarding schools mark every day regardless of weekend/holiday status — students remain
 * on-site. Day schools skip weekends and gazetted public holidays entirely.
 */
export function isRegisterRequired(dateStr: string, boardingType: BoardingType | undefined): { required: boolean; reason?: string } {
  if (boardingType === 'boarding') return { required: true };
  const holiday = getKenyanHolidayName(dateStr);
  if (holiday) return { required: false, reason: `Public holiday — ${holiday}` };
  if (isWeekend(dateStr)) return { required: false, reason: 'Weekend' };
  return { required: true };
}
