export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';
export type UserRole = 'schoolAdmin' | 'teacherAdmin';

export interface UserProfile {
  uid: string;
  email: string | null;
  phone: string | null;
  displayName: string;
  role: UserRole;
  schoolId: string;
  schoolName: string;
  /** @deprecated kept for backward compatibility with existing accounts/queries — use `assignedClasses`.
   * Always kept in sync as assignedClasses[0] (or unset for whole-school teachers). */
  classCode?: string;
  /**
   * Classes this teacherAdmin currently teaches. Absent/empty = whole-school access
   * (e.g. a deputy-style teacher admin). A schoolAdmin ignores this — it always has
   * full-school access regardless of this field.
   */
  assignedClasses?: string[];
  /** Class this teacher was last viewing in the dashboard (persisted so it survives a refresh). */
  lastActiveClass?: string;
  createdAt: string;
  messageTokens: number;
}

/** Kenyan curricula supported for class-level generation */
export type Curriculum = 'CBC' | '8-4-4';

/** Ordered base class levels (no streams) for each curriculum */
export const CURRICULUM_LEVELS: Record<Curriculum, string[]> = {
  'CBC': [
    'PP1', 'PP2',
    'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6',
    'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12',
  ],
  '8-4-4': [
    'Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5', 'Class 6', 'Class 7', 'Class 8',
    'Form 1', 'Form 2', 'Form 3', 'Form 4',
  ],
};

export type StreamMode = 'none' | 'uniform' | 'perClass';

/** Resolved academic structure for a school: levels + streams + final class list */
export interface ClassStructure {
  schoolId: string;            // = KNEC code, doc id
  curriculum: Curriculum;
  startingClass: string;
  graduatingClass: string;
  levels: string[];            // ordered base levels, startingClass..graduatingClass inclusive
  streamsEnabled: boolean;
  streamMode: StreamMode;
  uniformStreams?: string[];           // e.g. ['A','B'] — used for every level when streamMode === 'uniform'
  perClassStreams?: Record<string, string[]>; // level -> streams, used when streamMode === 'perClass'
  classes: string[];           // fully resolved, e.g. ['Grade 1A','Grade 1B',...] or ['Grade 1',...] if no streams
  updatedAt: string;
}

export type AcademicYearStatus = 'active' | 'closed';

export interface AcademicYear {
  id: string;                  // `${schoolId}_${label}`
  schoolId: string;
  label: string;                // e.g. '2026'
  status: AcademicYearStatus;
  startDate: string;
  closedAt?: string;
  promotedFromYearId?: string;  // previous year this was promoted from, if any
  promotionAppliedAt?: string;  // set once promotion has been applied INTO this year — guards double-promotion
  createdAt: string;
}

export type EnrolmentStatus = 'active' | 'repeating' | 'transferred' | 'graduated';

/** A student's placement in one academic year. Attendance should reference this, not the student directly. */
export interface Enrolment {
  id: string;
  studentId: string;
  schoolId: string;
  academicYearId: string;
  classCode: string;            // resolved class for that year, e.g. 'Grade 5A'
  status: EnrolmentStatus;
  createdAt: string;
  /** True when this student is repeating the level they were in during the previous academic year. */
  isRepeater?: boolean;
  /** classCode this enrolment repeats from, if isRepeater. Informational only. */
  repeatingClassCode?: string;
  /** Set when this enrolment was closed out by a transfer (any kind) rather than promotion/graduation. */
  closedByTransferId?: string;
  /** ISO timestamp this enrolment stopped being the student's active one, if applicable. */
  closedAt?: string;
}

export type TransferType =
  | 'transfer_in'        // new student joining from another school
  | 'transfer_out'       // student leaving to another school
  | 'internal_class'     // same level, moved to a different class/stream within school
  | 'internal_stream'    // alias of internal_class, kept distinct for reporting clarity
  | 'cross_year';         // transfer recorded against a different (usually prior) academic year

export type TransferStatus = 'completed' | 'reversed';

/**
 * Immutable audit record of a single student transfer. Never edited after creation —
 * a reversal creates its own compensating record rather than mutating this one, so
 * transfer history is always fully preserved.
 */
export interface TransferRecord {
  id: string;
  schoolId: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  type: TransferType;
  academicYearId: string;
  fromClassCode?: string;
  toClassCode?: string;
  fromSchoolId?: string;    // for transfer_in: the school the student is coming from (free text, may be unknown)
  toSchoolId?: string;      // for transfer_out: destination school (free text, may be unknown)
  fromEnrolmentId?: string;
  toEnrolmentId?: string;
  reason?: string;
  status: TransferStatus;
  performedBy: string;      // uid
  performedAt: string;
}

/**
 * Explicit teacher-to-class assignment, separate from `UserProfile.assignedClasses` so
 * assignment history (who was assigned what, and when it ended) is preserved even after
 * a teacher is moved or removed. One doc per (teacherUid, schoolId, classCode) triple.
 */
export interface TeacherAssignment {
  id: string;               // `${schoolId}_${teacherUid}_${classCode}`
  schoolId: string;
  teacherUid: string;
  teacherName: string;
  classCode: string;
  assignedAt: string;
  assignedBy: string;       // uid of the admin who made the assignment
  active: boolean;
  endedAt?: string;
  endedReason?: 'removed' | 'class_transfer' | 'stream_transfer' | 'school_transfer';
}

export type TeacherTransferType = 'class_transfer' | 'stream_transfer' | 'school_transfer';

/**
 * Immutable log of a teacher moving classes, streams, or schools. School transfers revoke all
 * access/assignments at the old school, but this record (and the assignment history above)
 * is preserved permanently as the historical activity trail.
 */
export interface TeacherTransferRecord {
  id: string;
  teacherUid: string;
  teacherName: string;
  type: TeacherTransferType;
  fromSchoolId: string;
  toSchoolId: string;        // same as fromSchoolId unless type === 'school_transfer'
  fromClasses: string[];
  toClasses: string[];
  performedBy: string;       // uid of the admin who performed the transfer
  performedAt: string;
  reason?: string;
}

export interface School {
  id: string;                   // KNEC code
  knecCode: string;
  name: string;
  county: string;
  type: string;                 // Primary / Secondary / Mixed Day / Boarding etc.
  curriculum: Curriculum;
  startingClass: string;
  graduatingClass: string;
  streamsEnabled: boolean;
  activeAcademicYearId: string;
  adminUid: string;
  adminEmail?: string;
  adminPhone?: string;
  phone?: string;
  createdAt: string;
}

export interface Student {
  id: string;
  name: string;
  admissionNo: string;
  classCode: string;
  schoolId: string;
  parentName: string;
  parentPhone: string;
  parentWhatsApp: string;
  createdAt: string;
  nationalId?: string;
  currentEnrolmentId?: string;  // set once Phase 2 (promotion engine) is wired in
  archived?: boolean;           // true once graduated into the global archivedStudents collection
}

export interface AttendanceRecord {
  id: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  date: string;
  classCode: string;
  schoolId: string;
  status: AttendanceStatus;
  note: string;
  savedBy: string;
  savedAt: string;
  locked: boolean;
  enrolmentId?: string;      // set once Phase 2 wiring runs; older records may not have it
  academicYearId?: string;
}

/** SMS pricing tiers based on recipient count snapshot */
export type SmsTier = 'small' | 'medium' | 'large';

export function getSmsTier(recipientCount: number): SmsTier {
  if (recipientCount <= 100) return 'small';
  if (recipientCount <= 300) return 'medium';
  return 'large';
}

/**
 * KES cost per token by tier.
 * 1 SMS part (140 chars) per recipient = 1 token.
 * Token value in KES depends on school size.
 */
export const KES_RATE_PER_TOKEN: Record<SmsTier, number> = {
  small: 0.7,   // ≤100 recipients → 0.7 KES/token
  medium: 0.5,  // 101–300 recipients → 0.5 KES/token
  large: 0.4,   // >300 recipients → 0.4 KES/token
};

export const SMS_SEGMENT_LENGTH = 140;
export const SMS_MAX_LENGTH = 400; // 3 segments max

/** Count how many 140-char segments a message uses */
export function countSmsSegments(text: string): number {
  const len = text.length;
  if (len === 0) return 0;
  return Math.ceil(len / SMS_SEGMENT_LENGTH);
}

/** Strip emojis and non-text characters */
export function sanitiseSmsText(raw: string): string {
  return raw
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    .replace(/[\u{2600}-\u{27BF}]/gu, '')
    .replace(/[\u{FE00}-\u{FE0F}]/gu, '')
    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '')
    .replace(/[^\x20-\x7E\u00A0-\u00FF\u0100-\u024F\r\n]/g, '')
    .replace(/ {2,}/g, ' ')
    .trim();
}

/**
 * Calculate total token cost.
 * 1 token = 1 SMS part per recipient (regardless of tier).
 * Tier only affects KES price of tokens, not how many tokens are used.
 */
export function calcTokenCost(cleanedText: string, recipientCount: number): number {
  const segments = countSmsSegments(cleanedText);
  return segments * recipientCount; // 1 token per SMS part per recipient
}

/**
 * Calculate KES price for a given number of tokens at a tier.
 */
export function tokensToKes(tokens: number, tier: SmsTier): number {
  return Math.round(tokens * KES_RATE_PER_TOKEN[tier] * 100) / 100;
}

/**
 * Reverse calculation: given KES amount, how many tokens?
 * Truncated to nearest whole token.
 */
export function kesToTokens(kes: number, tier: SmsTier): number {
  return Math.floor(kes / KES_RATE_PER_TOKEN[tier]);
}

/** Fixed token package sizes */
export const TOKEN_PACKAGES = [50, 100, 200, 500, 1000];

export interface Message {
  id: string;
  schoolId: string;
  sentBy: string;
  type: 'attendance' | 'assignment' | 'notice' | 'activity' | 'alert' | 'custom';
  channel: 'sms';
  recipients: string;
  recipientCount: number;
  rawContent: string;
  content: string;
  smsSegments: number;
  smsTier: SmsTier;
  costPerSegment: number;
  tokensUsed: number;
  sentAt: string;
  delivered: number;
  total: number;
  status: 'sent' | 'failed' | 'partial';
}

export interface RegisterDay {
  date: string;
  classCode: string;
  schoolId: string;
  savedBy: string;
  savedAt: string;
  locked: boolean;
  present: number;
  absent: number;
  late: number;
  excused: number;
  total: number;
  academicYearId?: string;
}

/** A per-academic-year snapshot kept on an archived (graduated) student record. */
export interface ArchivedYearRecord {
  academicYearId: string;
  yearLabel: string;
  classCode: string;
  presentDays: number;
  absentDays: number;
  lateDays: number;
  excusedDays: number;
  totalDays: number;
}

/**
 * Global archive — NOT nested under a school — so graduates from any school can be
 * looked up (e.g. by a future employer) by admission number, national ID, or name.
 * Written once at graduation. Never updated or deleted after that.
 */
export interface ArchivedStudent {
  id: string;                    // = original student id, so it's never duplicated
  name: string;
  admissionNo: string;
  nationalId?: string;
  schoolId: string;
  schoolName: string;
  graduatingClass: string;
  graduatedAt: string;
  years: ArchivedYearRecord[];   // one entry per academic year the student was enrolled
}


