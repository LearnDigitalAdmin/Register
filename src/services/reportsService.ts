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

/** "2025-01-27" → Date (local) */
function ymdToDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Date → "YYYY-MM-DD" */
function dateToYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Today, as "YYYY-MM-DD" in the same format every date in this file uses. */
function todayYmd(): string {
  return dateToYmd(new Date());
}

/**
 * A reporting window "is current" when it includes (or extends past) today —
 * i.e. the term/period hasn't fully concluded yet. Only current windows get
 * the live-roster merge described in the module doc comment above; a report
 * for a term that's already over should reflect history as it stood, not
 * today's roster.
 */
function isCurrentReportingWindow(endDate: string): boolean {
  return endDate >= todayYmd();
}

/** Week boundaries (Mon–Sun) containing a date */
function weekBounds(d: Date): { start: string; end: string } {
  const copy = new Date(d);
  const day  = copy.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day; // shift to Monday
  copy.setDate(copy.getDate() + diff);
  const start = dateToYmd(copy);
  copy.setDate(copy.getDate() + 6);
  const end = dateToYmd(copy);
  return { start, end };
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

export interface RawAttendanceRecord {
  studentId:   string;
  studentName: string;
  admissionNo: string;
  date:        string; // "YYYY-MM-DD"
  classCode:   string;
  schoolId:    string;
  status:      AttendanceStatus;
  note:        string;
  savedBy:     string;
  savedAt:     string;
  locked:      boolean;
  enrolmentId?:    string;
  academicYearId?: string;
}

export interface RawStudent {
  id:           string;
  name:         string;
  admissionNo:  string;
  classCode:    string;
  schoolId:     string;
  parentName:   string;
  parentPhone:  string;
  createdAt:    string;
}

export interface RawRegister {
  date:      string;
  classCode: string;
  schoolId:  string;
  savedBy:   string;
  savedAt:   string;
  locked:    boolean;
  present:   number;
  absent:    number;
  late:      number;
  excused:   number;
  total:     number;
  academicYearId?: string;
}

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

/** Per-student row in the termly report */
export interface TermlyStudentRow {
  studentId:    string;
  studentName:  string;
  admissionNo:  string;
  classCode:    string;
  totalDays:    number; // school days in term with a register that this student had the chance to be marked in
  present:      number;
  absent:       number;
  late:         number;
  excused:      number;
  rate:         number; // percentage (present / totalDays * 100), 0 when totalDays is 0
}

export interface TermlyClassSummary {
  classCode:    string;
  totalDays:    number;
  avgRate:      number;
  students:     TermlyStudentRow[];
}

export interface TermlyReport {
  schoolId:     string;
  schoolName:   string;
  termLabel:    string;
  startDate:    string;
  endDate:      string;
  generatedAt:  string;
  totalStudents: number;
  overallRate:   number;
  classes:      TermlyClassSummary[];
  /** Chronic absentees — rate < threshold (only among students with at least one tracked day) */
  chronicAbsentees: TermlyStudentRow[];
}

/** One day in the weekly summary */
export interface WeeklyDayRow {
  date:       string; // "YYYY-MM-DD"
  dayName:    string; // "Monday"
  present:    number;
  absent:     number;
  late:       number;
  excused:    number;
  total:      number;
  rate:       number;
  hasRegister: boolean;
}

export interface WeeklyClassSummary {
  classCode: string;
  days:      WeeklyDayRow[];
  avgRate:   number;
  totalPresent: number;
  totalAbsent:  number;
}

export interface WeeklySummary {
  schoolId:    string;
  schoolName:  string;
  weekStart:   string;
  weekEnd:     string;
  generatedAt: string;
  classes:     WeeklyClassSummary[];
  overallRate: number;
}

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
      where('date', '>=', startDate),
      where('date', '<=', endDate),
    )),
    getDocs(query(
      collection(db, 'registers'),
      where('schoolId', '==', schoolId),
      where('date', '>=', startDate),
      where('date', '<=', endDate),
    )),
    getKnownClassCodes(schoolId),
  ]);

  let records = attSnap.docs.map(d => d.data() as RawAttendanceRecord);
  if (academicYearId) {
    records = records.filter(r => !r.academicYearId || r.academicYearId === academicYearId);
  }
  if (classCodeFilter) {
    records = records.filter(r => r.classCode === classCodeFilter);
  }
  if (knownClassCodes) {
    records = records.filter(r => knownClassCodes.has(r.classCode));
  }

  let regDocs = regSnap.docs.map(d => d.data() as RawRegister);
  if (academicYearId) {
    regDocs = regDocs.filter(r => !r.academicYearId || r.academicYearId === academicYearId);
  }
  if (classCodeFilter) {
    regDocs = regDocs.filter(r => r.classCode === classCodeFilter);
  }
  if (knownClassCodes) {
    regDocs = regDocs.filter(r => knownClassCodes.has(r.classCode));
  }

  // Group attendance records by classCode → studentId
  const byClass: Record<string, Record<string, RawAttendanceRecord[]>> = {};
  for (const rec of records) {
    if (!byClass[rec.classCode]) byClass[rec.classCode] = {};
    if (!byClass[rec.classCode][rec.studentId]) byClass[rec.classCode][rec.studentId] = [];
    byClass[rec.classCode][rec.studentId].push(rec);
  }

  // Live roster merge — only for a window that includes today (see module doc comment).
  const rosterByClass: Record<string, Student[]> = {};
  if (isCurrentReportingWindow(endDate)) {
    const roster = await getActiveRoster(schoolId, classCodeFilter);
    for (const s of roster) {
      if (knownClassCodes && !knownClassCodes.has(s.classCode)) continue;
      if (!rosterByClass[s.classCode]) rosterByClass[s.classCode] = [];
      rosterByClass[s.classCode].push(s);
    }
  }

  const allClassCodes = new Set<string>([...Object.keys(byClass), ...Object.keys(rosterByClass)]);

  const classes: TermlyClassSummary[] = [];
  const allStudentRows: TermlyStudentRow[] = [];

  for (const classCode of allClassCodes) {
    const studentMap = byClass[classCode] || {};

    // Count distinct register days for this class
    const classDays = regDocs
      .filter(r => r.classCode === classCode)
      .map(r => r.date);
    const totalDays = new Set(classDays).size;

    const trackedRows: TermlyStudentRow[] = Object.entries(studentMap).map(
      ([studentId, recs]) => {
        const present = recs.filter(r => r.status === 'present').length;
        const absent  = recs.filter(r => r.status === 'absent').length;
        const late    = recs.filter(r => r.status === 'late').length;
        const excused = recs.filter(r => r.status === 'excused').length;
        const rate    = totalDays > 0 ? Math.round((present / totalDays) * 100) : 0;
        return {
          studentId,
          studentName: recs[0].studentName,
          admissionNo: recs[0].admissionNo,
          classCode,
          totalDays,
          present,
          absent,
          late,
          excused,
          rate,
        };
      },
    );

    // Roster students with zero attendance records yet this window (e.g. added today, before
    // their first register) — shown with 0 tracked days rather than a fabricated 0% rate.
    const trackedIds = new Set(trackedRows.map(r => r.studentId));
    const untrackedRows: TermlyStudentRow[] = (rosterByClass[classCode] || [])
      .filter(s => !trackedIds.has(s.id))
      .map(s => ({
        studentId: s.id,
        studentName: s.name,
        admissionNo: s.admissionNo,
        classCode,
        totalDays: 0,
        present: 0,
        absent: 0,
        late: 0,
        excused: 0,
        rate: 0,
      }));

    const studentRows = [...trackedRows, ...untrackedRows]
      .sort((a, b) => a.studentName.localeCompare(b.studentName));

    // Rate average only over students who've actually had at least one tracked day — a brand
    // new student with 0 tracked days shouldn't drag a class's average rate down to look worse
    // than it really is.
    const ratedRows = studentRows.filter(r => r.totalDays > 0);
    const avgRate = ratedRows.length
      ? Math.round(ratedRows.reduce((s, r) => s + r.rate, 0) / ratedRows.length)
      : 0;

    classes.push({ classCode, totalDays, avgRate, students: studentRows });
    allStudentRows.push(...studentRows);
  }

  // Sort classes alphabetically
  classes.sort((a, b) => a.classCode.localeCompare(b.classCode));

  // Distinct-student count school-wide — the fix for the double-counting bug. A student whose
  // history legitimately spans more than one classCode (an internal transfer mid-term, or —
  // pre-fix — a stray non-class record) is still only counted once here.
  const totalStudents = new Set(allStudentRows.map(r => r.studentId)).size;

  const ratedAllRows = allStudentRows.filter(r => r.totalDays > 0);
  const overallRate = ratedAllRows.length
    ? Math.round(ratedAllRows.reduce((s, r) => s + r.rate, 0) / ratedAllRows.length)
    : 0;

  const chronicAbsentees = allStudentRows
    .filter(r => r.totalDays > 0 && r.rate < absenteeThreshold)
    .sort((a, b) => a.rate - b.rate);

  return {
    schoolId,
    schoolName,
    termLabel,
    startDate,
    endDate,
    generatedAt: new Date().toISOString(),
    totalStudents,
    overallRate,
    classes,
    chronicAbsentees,
  };
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
      where('date', '>=', start),
      where('date', '<=', end),
    )),
    getKnownClassCodes(schoolId),
  ]);

  let registers = regSnap.docs.map(d => d.data() as RawRegister);
  if (academicYearId) {
    registers = registers.filter(r => !r.academicYearId || r.academicYearId === academicYearId);
  }
  if (classCodeFilter) {
    registers = registers.filter(r => r.classCode === classCodeFilter);
  }
  if (knownClassCodes) {
    registers = registers.filter(r => knownClassCodes.has(r.classCode));
  }

  // Build all 5 weekdays
  const days: string[] = [];
  const cursor = ymdToDate(start);
  for (let i = 0; i < 7; i++) {
    const ymd = dateToYmd(cursor);
    const dow = cursor.getDay();
    if (dow >= 1 && dow <= 5) days.push(ymd); // Mon–Fri only
    cursor.setDate(cursor.getDate() + 1);
  }

  // Group registers by classCode
  const byClass: Record<string, RawRegister[]> = {};
  for (const reg of registers) {
    if (!byClass[reg.classCode]) byClass[reg.classCode] = [];
    byClass[reg.classCode].push(reg);
  }

  const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  const classes: WeeklyClassSummary[] = Object.entries(byClass)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([classCode, regs]) => {
      const regByDate: Record<string, RawRegister> = {};
      regs.forEach(r => { regByDate[r.date] = r; });

      let totalPresent = 0, totalAbsent = 0;
      const dayRows: WeeklyDayRow[] = days.map(date => {
        const reg = regByDate[date];
        const d   = ymdToDate(date);
        if (!reg) return {
          date, dayName: DAY_NAMES[d.getDay()],
          present: 0, absent: 0, late: 0, excused: 0, total: 0,
          rate: 0, hasRegister: false,
        };
        totalPresent += reg.present;
        totalAbsent  += reg.absent;
        const rate = reg.total > 0 ? Math.round((reg.present / reg.total) * 100) : 0;
        return {
          date, dayName: DAY_NAMES[d.getDay()],
          present: reg.present, absent: reg.absent,
          late: reg.late, excused: reg.excused,
          total: reg.total, rate, hasRegister: true,
        };
      });

      const recordedDays  = dayRows.filter(r => r.hasRegister);
      const avgRate = recordedDays.length
        ? Math.round(recordedDays.reduce((s, r) => s + r.rate, 0) / recordedDays.length)
        : 0;

      return { classCode, days: dayRows, avgRate, totalPresent, totalAbsent };
    });

  const overallRate = classes.length
    ? Math.round(classes.reduce((s, c) => s + c.avgRate, 0) / classes.length)
    : 0;

  return {
    schoolId,
    schoolName,
    weekStart: start,
    weekEnd:   end,
    generatedAt: new Date().toISOString(),
    classes,
    overallRate,
  };
}

// ─── 3. Student Profile Report ─────────────────────────────────────────────────

/**
 * Fetches complete attendance history for a single student.
 * @param academicYearId  See generateTermlyReport — same year-scoping rationale.
 */
export async function generateStudentProfile(
  studentId:   string,
  schoolId:    string,
  schoolName:  string,
  limitDays:   number = 180,
  academicYearId?: string,
): Promise<StudentProfile | null> {
  // Pull attendance records for this student
  const attQ = query(
    collection(db, 'attendance'),
    where('studentId', '==', studentId),
    where('schoolId', '==', schoolId),
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
  const rows: string[][] = [
    [`${report.schoolName} — ${report.termLabel} Attendance Report`],
    [`Generated: ${new Date(report.generatedAt).toLocaleString('en-KE')}`],
    [],
    ['Class', 'Student Name', 'Admission No.', 'Total Days', 'Present', 'Absent', 'Late', 'Excused', 'Rate (%)'],
    ...report.classes.flatMap(c =>
      c.students.map(s => [
        s.classCode, s.studentName, s.admissionNo,
        String(s.totalDays), String(s.present), String(s.absent),
        String(s.late), String(s.excused), String(s.rate) + '%',
      ]),
    ),
  ];
  downloadCsv(`${report.schoolName}_${report.termLabel}_attendance.csv`, rows);
}

/** Export weekly summary as CSV */
export function exportWeeklyCsv(report: WeeklySummary): void {
  const rows: string[][] = [
    [`${report.schoolName} — Weekly Summary ${report.weekStart} to ${report.weekEnd}`],
    [],
    ['Class', 'Day', 'Date', 'Present', 'Absent', 'Late', 'Excused', 'Total', 'Rate (%)'],
    ...report.classes.flatMap(c =>
      c.days.map(d => [
        c.classCode, d.dayName, d.date,
        String(d.present), String(d.absent), String(d.late),
        String(d.excused), String(d.total), d.hasRegister ? String(d.rate) + '%' : 'No register',
      ]),
    ),
  ];
  downloadCsv(`${report.schoolName}_weekly_${report.weekStart}.csv`, rows);
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
