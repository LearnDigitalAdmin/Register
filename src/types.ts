/** `unmarked` is the default state for every student until a teacher actually marks the
 * register (or the noon auto-unmarked job runs) — the app must never assume `present`. */
export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused' | 'unmarked';
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

/** Whether the school boards students overnight. Drives register-availability rules:
 * boarding schools mark a register every day of the year; day schools don't need one
 * on weekends/public holidays. */
export type BoardingType = 'day' | 'boarding';

/** Broad Kenyan schooling bands (CBC-aligned, but also used to describe 8-4-4 schools). */
export type SchoolLevel = 'pre-primary' | 'full-primary' | 'junior-school' | 'senior-school';

export const SCHOOL_LEVEL_LABELS: Record<SchoolLevel, string> = {
  'pre-primary':   'Pre-Primary (PP1–PP2)',
  'full-primary':  'Full Primary (Grade 1–6 / Class 1–8)',
  'junior-school': 'Junior School (Grade 7–9)',
  'senior-school': 'Senior School (Grade 10–12 / Form 1–4)',
};
export const SCHOOL_LEVELS: SchoolLevel[] = ['pre-primary', 'full-primary', 'junior-school', 'senior-school'];

export const BOARDING_TYPE_LABELS: Record<BoardingType, string> = {
  day: 'Day School',
  boarding: 'Boarding School',
};

export interface School {
  id: string;                   // KNEC code
  knecCode: string;
  name: string;
  county: string;
  /** @deprecated free-text legacy field, kept for older records — use `boardingType` and `schoolLevel`. */
  type?: string;
  boardingType: BoardingType;
  schoolLevel: SchoolLevel;
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

/** Admission numbers may be teacher-entered (letters + numbers, e.g. "ADM-2026-014") or
 * left blank to auto-generate. Normalised to uppercase with internal whitespace removed. */
export function normaliseAdmissionNo(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

export function isValidAdmissionNo(raw: string): boolean {
  const v = normaliseAdmissionNo(raw);
  return v.length >= 2 && v.length <= 24 && /^[A-Z0-9\/-]+$/.test(v);
}

/** Best-effort collision-avoiding fallback admission number when a teacher leaves the field blank. */
export function generateAdmissionNo(schoolId: string, classCode: string, existingCount: number): string {
  const seq = (existingCount + 1).toString().padStart(4, '0');
  const suffix = Math.random().toString(36).slice(2, 4).toUpperCase();
  return `${schoolId.slice(-4)}-${classCode.replace(/\s+/g, '')}-${seq}${suffix}`;
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

/** Matches http(s)/www links and bare domain-looking strings (e.g. "bit.ly/x", "example.com").
 * Deliberately broad — false positives (blocking a message that merely mentions a domain-like
 * word) are far cheaper than a false negative (a link slipping through to a parent's phone). */
const LINK_PATTERN = /((https?:\/\/|www\.)\S+)|(\b[a-z0-9-]+\.(com|co\.ke|ke|org|net|info|xyz|link|io|me|ly|app|shop)\b\S*)/gi;

export function containsLink(text: string): boolean {
  return LINK_PATTERN.test(text);
}

/** Removes any link-like substrings from a message body. Used both live in the compose box
 * and as a final belt-and-braces pass before a message is ever queued for sending. */
export function stripLinks(text: string): string {
  return text.replace(LINK_PATTERN, '[link removed]').replace(/ {2,}/g, ' ').trim();
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
  /** True once a teacher has actually saved the register. The noon auto-unmarked job writes
   * a register doc with `locked: false` so admins can see it was never marked, without
   * blocking a teacher from still marking it properly later in the day. */
  locked: boolean;
  present: number;
  absent: number;
  late: number;
  excused: number;
  unmarked: number;
  total: number;
  academicYearId?: string;
  /** True only when this doc was written by the noon scheduled job, not a teacher. */
  autoUnmarked?: boolean;
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

// ─── Bulk student import ────────────────────────────────────────────────────

/** Canonical field keys the importer can map spreadsheet columns onto. */
export type ImportFieldKey =
  | 'admissionNo'
  | 'name'
  | 'classCode'
  | 'parentName'
  | 'parentPhone'
  | 'parentWhatsApp'
  | 'nationalId';

/** Which import fields are mandatory vs optional. */
export const IMPORT_REQUIRED_FIELDS: ImportFieldKey[] = ['admissionNo', 'name', 'classCode'];
export const IMPORT_OPTIONAL_FIELDS: ImportFieldKey[] = ['parentName', 'parentPhone', 'parentWhatsApp', 'nationalId'];

export const IMPORT_FIELD_LABELS: Record<ImportFieldKey, string> = {
  admissionNo:    'Admission No.',
  name:           'Student Name',
  classCode:      'Class',
  parentName:     'Parent / Guardian Name',
  parentPhone:    'Parent Phone (SMS)',
  parentWhatsApp: 'Parent WhatsApp',
  nationalId:     'National ID / Birth Cert No.',
};

/** A saved column-mapping preset for a school, so the next import remembers it. */
export interface ImportColumnMapping {
  id: string;                 // = schoolId, doc id
  schoolId: string;
  /** spreadsheet column header -> canonical field key */
  mapping: Partial<Record<ImportFieldKey, string>>;
  updatedAt: string;
}

export type ImportRowIssueType =
  | 'missing_admission_no'
  | 'missing_name'
  | 'invalid_phone'
  | 'duplicate_admission_no'
  | 'duplicate_student'
  | 'unknown_class'
  | 'invalid_stream'
  | 'unknown_academic_year';

export interface ImportRowIssue {
  type: ImportRowIssueType;
  field?: ImportFieldKey;
  message: string;
}

/** One parsed spreadsheet row, carried through mapping → validation → import. */
export interface ImportRow {
  rowIndex: number;            // 1-based row number in the source file (excluding header)
  values: Partial<Record<ImportFieldKey, string>>;
  issues: ImportRowIssue[];
  /** True once the row has no blocking issues and is ready to import. */
  isValid: boolean;
  /** User chose to skip this row even if it's otherwise valid. */
  excluded?: boolean;
}

export interface ImportSummary {
  imported: number;
  skipped: number;
  duplicate: number;
  missingAdmissionNo: number;
  failed: number;
}

