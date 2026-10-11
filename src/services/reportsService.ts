/**
 * src/services/reportingService.ts
 *
 * Queries Firestore collections (attendance, students, registers, messages)
 * to produce structured data for the three main report types:
 *   1. Termly Attendance Report
 *   2. Weekly Summary
 *   3. Student Profile Report
 *
 * All functions are pure async — they fetch and return data; rendering is
 * handled by the modal components.
 *
 * ─── Counting model ─────────────────────────────────────────────────────────
 * Two things used to be conflated: "how many students does this class/school
 * have" and "how many distinct students show up in the attendance history for
 * this period". Those aren't the same question, and answering the first one
 * with the second is what caused reports to disagree with the Students panel:
 *   - A brand-new student with no register taken yet was invisible in reports
 *     until their first attendance record existed.
 *   - A stray classCode (e.g. a pseudo "class" that was never a real class, or
 *     a class a student has since moved out of) was treated as its own class
 *     bucket, so the same physical student could be counted more than once in
 *     the school-wide total.
 *
 * The fix has two parts:
 *   1. Student *counts* (per class and school-wide) are sourced from the live
 *      roster — the same `students` collection the Students panel already
 *      reads from — for any reporting window that includes today. That's the
 *      single source of truth for "who's enrolled right now", so it can never
 *      drift from what every other panel shows. A student with zero
 *      attendance records yet still appears, with 0 tracked days rather than
 *      a fabricated rate.
 *   2. `totalStudents` is always a *distinct*-student count across the whole
 *      report, not a sum of each class bucket's count. A student whose
 *      attendance history legitimately spans two classCodes (an internal
 *      transfer mid-term, for instance — see transferService, which
 *      deliberately preserves old-class history) is still only counted once
 *      at the school level.
 * For a *closed* historical window (the whole date range is in the past),
 * the live roster is intentionally NOT used to inject students — a past
 * term's report should reflect who was actually being tracked back then, not
 * who happens to be enrolled today. The distinct-student dedup still applies
 * either way, since it only ever removes double-counting, never invents rows.
 *
 * Both report generators also defensively drop any attendance/register record
 * whose classCode isn't one of the school's actual configured classes (see
 * `getKnownClassCodes`) before grouping anything by classCode. That's a second
 * line of defense against a record ever having been saved under something
 * that was never a real class (e.g. a stray "All School" pseudo-class) — such
 * records simply can't form their own phantom class bucket in a report.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { AttendanceStatus, ClassStructure, SmsTier, Student } from '../types';
import { KES_RATE_PER_TOKEN } from '../types';

// ─── Shared helpers ────────────────────────────────────────────────────────────

// The report maths (grouping, rates, roster merge, week bounds, CSV rows) lives in `src/shared/reportBuilders.ts`,
// which is copied byte-for-byte into Cloud Functions so the Samuhia Desk delegate produces identical reports.
// This module only fetches (web SDK) and hands the raw records to the builders.
import {
  buildTermlyReport, buildWeeklySummary, isCurrentReportingWindow, weekBounds, ymdToDate, dateToYmd,
  termlyCsvRows, weeklyCsvRows,
} from '../shared/reportBuilders';
import type {
  RawAttendanceRecord, RawStudent, RawRegister,
  TermlyStudentRow, TermlyClassSummary, TermlyReport,
  WeeklyDayRow, WeeklyClassSummary, WeeklySummary,
} from '../shared/reportBuilders';
export type {
  RawAttendanceRecord, RawStudent, RawRegister,
  TermlyStudentRow, TermlyClassSummary, TermlyReport,
  WeeklyDayRow, WeeklyClassSummary, WeeklySummary,
};

/** Today, as "YYYY-MM-DD" in the same format every date in this file uses. */
function todayYmd(): string {
  return dateToYmd(new Date());
}

/**
 * Fetches the school's actual configured class list (from `classStructures`),
 * used to defensively filter out any attendance/register record whose
 * classCode isn't a real class at this school. Returns `null` (meaning "don't
 * filter") if the school has no class structure doc yet, rather than risk
 * hiding every record for a school that's still mid-setup.
 */
async function getKnownClassCodes(schoolId: string): Promise<Set<string> | null> {
  try {
    const snap = await getDoc(doc(db, 'classStructures', schoolId));
    if (!snap.exists()) return null;
    const structure = snap.data() as ClassStructure;
    if (!Array.isArray(structure.classes) || structure.classes.length === 0) return null;
    return new Set(structure.classes);
  } catch {
    return null;
  }
}

/**
 * The live, current roster for a school — the exact same source of truth the
 * Students panel reads from (`students` where schoolId matches, archived
 * students excluded). Optionally scoped to one class.
 */
async function getActiveRoster(schoolId: string, classCodeFilter?: string): Promise<Student[]> {
  const q = query(collection(db, 'students'), where('schoolId', '==', schoolId));
  const snap = await getDocs(q);
  const roster = snap.docs
    .map(d => ({ id: d.id, ...d.data() } as Student))
    .filter(s => !s.archived);
  return classCodeFilter ? roster.filter(s => s.classCode === classCodeFilter) : roster;
}

// ─── Raw Firestore types ───────────────────────────────────────────────────────
// (RawAttendanceRecord, RawStudent and RawRegister are re-exported from the shared builders above.)

export interface RawMessage {
  id:             string;
  schoolId:       string;
  sentBy:         string;
  type:           string;
  channel:        string;
  recipients:     string;
  recipientCount: number;
  rawContent:     string;
  content:        string;
  smsSegments:    number;
  smsTier:        SmsTier;
  costPerSegment: number;
  tokensUsed:     number;
  sentAt:         string;
  delivered:      number;
  total:          number;
  status:         'sent' | 'failed' | 'partial';
}

// ─── Report output types ───────────────────────────────────────────────────────
// (Termly*/Weekly* types are re-exported from the shared builders above.)

/** Single day entry in a student profile */
export interface StudentAttendanceDay {
  date:    string;
  dayName: string;
  status:  AttendanceStatus;
  note:    string;
}

export interface StudentProfile {
  studentId:    string;
  studentName:  string;
  admissionNo:  string;
  classCode:    string;
  parentName:   string;
  parentPhone:  string;
  totalDays:    number;
  present:      number;
  absent:       number;
  late:         number;
  excused:      number;
  rate:         number;
  streak:       number; // current consecutive present days
  longestStreak: number;
  history:      StudentAttendanceDay[];
  recentAbsences: StudentAttendanceDay[];
  schoolName:   string;
  generatedAt:  string;
}

// ─── 1. Termly Attendance Report ──────────────────────────────────────────────

/**
 * Fetches all attendance records for the school between startDate and endDate.
 * Groups by class → student and computes per-student stats. For a reporting
 * window that includes today, the live roster is merged in so a student
 * added today (even with no register taken for them yet) is reflected
 * immediately — see the module doc comment for the full rationale.
 *
 * @param schoolId   Firestore school ID
 * @param schoolName Display name
 * @param startDate  "YYYY-MM-DD" inclusive
 * @param endDate    "YYYY-MM-DD" inclusive
 * @param termLabel  e.g. "Term 1 2025"
 * @param absenteeThreshold % below which a student is flagged
 * @param academicYearId  When provided, only records tagged with this year (or untagged
 *   pre-Phase-2 legacy records, which predate the enrolment system and can't be mis-attributed
 *   to a *different* year) are included. Without this, a report run just after a promotion could
 *   blend last year's "Grade 5A" with this year's "Grade 5A", since class codes are reused yearly.
 * @param classCodeFilter when set, scope the whole report to just this class
 */
export async function generateTermlyReport(
  schoolId:    string,
  schoolName:  string,
  startDate:   string,
  endDate:     string,
  termLabel:   string,
  absenteeThreshold = 80, // % below which student is flagged
  academicYearId?: string,
  classCodeFilter?: string,
): Promise<TermlyReport> {
  const [attSnap, regSnap, knownClassCodes] = await Promise.all([
    getDocs(query(
      collection(db, 'attendance'),
      where('schoolId', '==', schoolId),
      ...(classCodeFilter ? [where('classCode', '==', classCodeFilter)] : []),
      where('date', '>=', startDate),
      where('date', '<=', endDate),
    )),
    getDocs(query(
      collection(db, 'registers'),
      where('schoolId', '==', schoolId),
      ...(classCodeFilter ? [where('classCode', '==', classCodeFilter)] : []),
      where('date', '>=', startDate),
      where('date', '<=', endDate),
    )),
    getKnownClassCodes(schoolId),
  ]);

  // Live roster merge — only for a window that includes today (see the shared builder's doc comment).
  const roster = isCurrentReportingWindow(endDate, todayYmd())
    ? await getActiveRoster(schoolId, classCodeFilter)
    : [];

  return buildTermlyReport({
    schoolId, schoolName, startDate, endDate, termLabel, absenteeThreshold, academicYearId, classCodeFilter,
    attendance: attSnap.docs.map(d => d.data() as RawAttendanceRecord),
    registers: regSnap.docs.map(d => d.data() as RawRegister),
    knownClassCodes,
    roster,
    generatedAt: new Date().toISOString(),
  });
}

// ─── 2. Weekly Summary ─────────────────────────────────────────────────────────

/**
 * Fetches register data for the Mon–Sun week containing `referenceDate`.
 * @param academicYearId  See generateTermlyReport — same year-scoping rationale.
 * @param classCodeFilter when set, scope the whole summary to just this class
 */
export async function generateWeeklySummary(
  schoolId:     string,
  schoolName:   string,
  referenceDate: Date = new Date(),
  academicYearId?: string,
  classCodeFilter?: string,
): Promise<WeeklySummary> {
  const { start, end } = weekBounds(referenceDate);

  const [regSnap, knownClassCodes] = await Promise.all([
    getDocs(query(
      collection(db, 'registers'),
      where('schoolId', '==', schoolId),
      ...(classCodeFilter ? [where('classCode', '==', classCodeFilter)] : []),
      where('date', '>=', start),
      where('date', '<=', end),
    )),
    getKnownClassCodes(schoolId),
  ]);

  return buildWeeklySummary({
    schoolId, schoolName, referenceDate, academicYearId, classCodeFilter,
    registers: regSnap.docs.map(d => d.data() as RawRegister),
    knownClassCodes,
    generatedAt: new Date().toISOString(),
  });
}

// ─── 3. Student Profile Report ─────────────────────────────────────────────────

/**
 * Fetches complete attendance history for a single student.
 * @param academicYearId  See generateTermlyReport — same year-scoping rationale.
 * @param allowedClassCodes  Pass a class-restricted teacher's assigned classes to scope the
 *   query to just those classes — required for the read to be provable under firestore.rules'
 *   per-class access check (a teacher can't read attendance under a classCode they don't have
 *   access to, even historical records from a student's prior class). Omit entirely for an
 *   admin/whole-school viewer, whose access isn't classCode-scoped at all.
 */
export async function generateStudentProfile(
  studentId:   string,
  schoolId:    string,
  schoolName:  string,
  limitDays:   number = 180,
  academicYearId?: string,
  allowedClassCodes?: string[],
): Promise<StudentProfile | null> {
  // Pull attendance records for this student
  const attQ = query(
    collection(db, 'attendance'),
    where('studentId', '==', studentId),
    where('schoolId', '==', schoolId),
    // Firestore 'in' supports up to 30 values — comfortably more than any real teacher's
    // assigned-class list — and, combined with the composite index on
    // (studentId, schoolId, classCode, date), makes this query provable under the
    // classCode-scoped `hasClassAccess` rule instead of being rejected outright.
    ...(allowedClassCodes && allowedClassCodes.length > 0
      ? [where('classCode', 'in', allowedClassCodes.slice(0, 30))] : []),
    orderBy('date', 'desc'),
    limit(limitDays),
  );
  const attSnap = await getDocs(attQ);
  if (attSnap.empty) return null;

  let records = attSnap.docs
    .map(d => d.data() as RawAttendanceRecord)
    .sort((a, b) => a.date.localeCompare(b.date)); // ascending
  if (academicYearId) {
    records = records.filter(r => !r.academicYearId || r.academicYearId === academicYearId);
  }
  if (records.length === 0) return null;

  const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  const history: StudentAttendanceDay[] = records.map(r => ({
    date:    r.date,
    dayName: DAY_NAMES[ymdToDate(r.date).getDay()],
    status:  r.status,
    note:    r.note || '',
  }));

  const present = records.filter(r => r.status === 'present').length;
  const absent  = records.filter(r => r.status === 'absent').length;
  const late    = records.filter(r => r.status === 'late').length;
  const excused = records.filter(r => r.status === 'excused').length;
  const total   = records.length;
  const rate    = total > 0 ? Math.round((present / total) * 100) : 0;

  // Current streak (backwards from last record)
  let streak = 0;
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i].status === 'present') streak++;
    else break;
  }

  // Longest streak
  let longestStreak = 0, cur = 0;
  for (const r of records) {
    if (r.status === 'present') { cur++; longestStreak = Math.max(longestStreak, cur); }
    else cur = 0;
  }

  const recentAbsences = history
    .filter(h => h.status === 'absent' || h.status === 'late')
    .slice(-10)
    .reverse();

  const first = records[0];
  return {
    studentId,
    studentName:  first.studentName,
    admissionNo:  first.admissionNo,
    classCode:    first.classCode,
    parentName:   '', // not in attendance records, filled by caller
    parentPhone:  '',
    totalDays:    total,
    present,
    absent,
    late,
    excused,
    rate,
    streak,
    longestStreak,
    history,
    recentAbsences,
    schoolName,
    generatedAt:  new Date().toISOString(),
  };
}

// ─── Utilities for display ────────────────────────────────────────────────────

/** Format a "YYYY-MM-DD" date to "27 Jan 2025" */
export function fmtDate(ymd: string): string {
  return new Date(ymd + 'T00:00:00').toLocaleDateString('en-KE', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

/** Rate → colour token */
export function rateColor(rate: number): string {
  if (rate >= 90) return 'var(--mint-d)';
  if (rate >= 75) return '#c4800a';
  return 'var(--red)';
}

export function rateTag(rate: number): string {
  if (rate >= 90) return 'tag-mint';
  if (rate >= 75) return 'tag-gold';
  return 'tag-red';
}

/** Simple CSV export helper */
export function downloadCsv(filename: string, rows: string[][]): void {
  const csv = rows
    .map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

/** Export termly report as CSV */
export function exportTermlyCsv(report: TermlyReport): void {
  downloadCsv(`${report.schoolName}_${report.termLabel}_attendance.csv`, termlyCsvRows(report));
}

/** Export weekly summary as CSV */
export function exportWeeklyCsv(report: WeeklySummary): void {
  downloadCsv(`${report.schoolName}_weekly_${report.weekStart}.csv`, weeklyCsvRows(report));
}

/** Export student profile as CSV */
export function exportStudentCsv(profile: StudentProfile): void {
  const rows: string[][] = [
    [`${profile.schoolName} — Student Profile: ${profile.studentName}`],
    [`Class: ${profile.classCode}`, `Admission No: ${profile.admissionNo}`],
    [`Attendance Rate: ${profile.rate}%`, `Total Days: ${profile.totalDays}`],
    [],
    ['Date', 'Day', 'Status', 'Note'],
    ...profile.history.map(h => [h.date, h.dayName, h.status, h.note]),
  ];
  downloadCsv(`${profile.studentName.replace(/\s+/g, '_')}_profile.csv`, rows);
}
