/**
 * Shared types + token math for message scheduling (Cloud Functions side).
 * Mirrors src/types.ts on the frontend — if you change the shape of a scheduled message,
 * the audience/frequency/status enums, or the token-cost formula here, change it there too.
 */

export type ScheduleAudienceType =
  | 'teachers_all'      // internal — every teacher at the school
  | 'teachers_selected' // internal — specific teacher(s)
  | 'parents_school'    // every parent at the school
  | 'parents_class'     // every parent in one class
  | 'parents_selected'  // specific student(s)' parent(s)
  | 'holiday_notice';   // goodbye / welcome-back broadcast tied to a holiday period

export type ScheduleFrequency = 'once' | 'daily' | 'weekly';

export type ScheduleStatus =
  | 'active'             // waiting on nextRunAt
  | 'insufficientTokens' // due to fire, but the funding balance couldn't cover it
  | 'stopped'            // manually ended before completion — terminal, unused tokens refunded
  | 'completed';         // ran its full course — terminal

export type ScheduleFundingSource = 'own' | 'school';

export type HolidayNoticeVariant = 'goodbye' | 'welcomeBack';

/** Firestore doc shape for `scheduledMessages/{id}`. One doc per schedule — a school or
 * class may have many active at once, each tracked and funded independently. */
export interface ScheduledMessage {
  id: string;
  schoolId: string;
  createdBy: string;          // uid of the schoolAdmin or teacherAdmin who created it
  createdByRole: 'schoolAdmin' | 'teacherAdmin';
  audienceType: ScheduleAudienceType;

  /** Required for 'teachers_selected' (teacher uids) and 'parents_selected' (student ids). */
  recipientUids?: string[];
  recipientStudentIds?: string[];
  /** Required for 'parents_class'; also set for 'teachers_selected' when scoped to one class. */
  classCode?: string;

  messageBody: string;        // raw body — wrapped the same way sendBroadcast wraps it, at send time
  frequency: ScheduleFrequency;
  timeOfDay: string;           // 'HH:mm', Africa/Nairobi
  startDate: string;            // 'YYYY-MM-DD'
  endDate?: string;             // 'YYYY-MM-DD', inclusive — required for daily/weekly
  includeWeekends: boolean;     // only meaningful for daily/weekly; holidays are never overridable

  fundingSource: ScheduleFundingSource;
  fundingSourceUid: string;     // whose messageTokens balance this draws from
  tokensRequired: number;       // full cost of the schedule as originally/last calculated
  tokensAllocated: number;      // actually reserved out of fundingSourceUid's balance so far
                                 // (< tokensRequired only when the account couldn't cover it all)
  tokensUsed: number;           // consumed so far across occurrences already sent — always
                                 // drawn from tokensAllocated, never straight from the user's balance
  insufficientTokens: boolean;  // true while tokensAllocated < tokensRequired

  status: ScheduleStatus;
  nextRunAt: string | null;     // ISO datetime (UTC) of the next scheduled fire, null once terminal
  lastRunAt?: string;           // ISO datetime of the most recent successful fire
  occurrencesPlanned: number;   // total sends expected over the run, as of the last create/edit
  occurrencesSent: number;

  linkedHolidayPeriodId?: string;         // set for audienceType === 'holiday_notice'
  holidayNoticeVariant?: HolidayNoticeVariant;

  createdAt: string;
  updatedAt: string;
}

/** Firestore doc shape for `schoolHolidays/{id}`. */
export interface HolidayPeriod {
  id: string;
  schoolId: string;
  name: string;
  startDate: string;   // 'YYYY-MM-DD'
  endDate: string;      // 'YYYY-MM-DD', inclusive — equals startDate for a single day
  kind: 'public' | 'custom'; // 'public' = a gazetted holiday the school added manually; 'custom' = e.g. mid-term break
  sendGoodbye: boolean;
  goodbyeMessage?: string;
  goodbyeScheduleId?: string;      // set once the goodbye ScheduledMessage doc is created
  sendWelcomeBack: boolean;
  welcomeBackMessage?: string;
  welcomeBackScheduleId?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** Firestore doc shape for `teacherTokenAllocations/{id}` — immutable audit log, same
 * philosophy as `transfers`/`teacherTransfers`: never edited or deleted after creation. */
export interface TeacherTokenAllocation {
  id: string;
  schoolId: string;
  teacherUid: string;
  amount: number;
  performedBy: string;     // schoolAdmin uid
  performedAt: string;
  teacherBalanceAfter: number;
  adminBalanceAfter: number;
}

/** SMS segment length + multiplier constants — must match src/types.ts exactly. */
export const SMS_SEGMENT_LENGTH = 140;
export const SCHEDULE_TOKEN_MULTIPLIER = 1.2;

/** Segments used by a message body of this length (0 chars = 0 segments). */
export function countSmsSegments(text: string): number {
  const len = text.length;
  if (len === 0) return 0;
  return Math.ceil(len / SMS_SEGMENT_LENGTH);
}

/**
 * Token cost of ONE occurrence of a scheduled send: segments × recipients × 1.2, rounded
 * to the nearest whole token (standard rounding — 7.2 → 7, 7.6 → 8). This is charged once
 * per firing; the schedule's total reservation is this multiplied by occurrencesPlanned.
 */
export function calcScheduleOccurrenceTokenCost(cleanedMessageText: string, recipientCount: number): number {
  const segments = countSmsSegments(cleanedMessageText);
  return Math.round(segments * recipientCount * SCHEDULE_TOKEN_MULTIPLIER);
}

/** Total tokens to reserve for a schedule given its per-occurrence cost and how many
 * occurrences it's planned to run. */
export function calcScheduleTotalTokenCost(occurrenceCost: number, occurrencesPlanned: number): number {
  return occurrenceCost * occurrencesPlanned;
}
