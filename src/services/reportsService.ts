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
 */

import {
  collection,
  query,
  where,
  getDocs,
  orderBy,
  limit,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { AttendanceStatus, SmsTier } from '../types';
import { KES_RATE_PER_TOKEN } from '../types';

// ─── Shared helpers ────────────────────────────────────────────────────────────

function isoToDate(iso: string): Date {
  return new Date(iso);
}

/** "2025-01-27" → Date (local) */
function ymdToDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Date → "YYYY-MM-DD" */
function dateToYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
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
  totalDays:    number; // school days in term with a register
  present:      number;
  absent:       number;
  late:         number;
  excused:      number;
  rate:         number; // percentage (present / totalDays * 100)
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
  /** Chronic absentees — rate < threshold */
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
 * Groups by class → student and computes per-student stats.
 *
 * @param schoolId   Firestore school ID
 * @param schoolName Display name
 * @param startDate  "YYYY-MM-DD" inclusive
 * @param endDate    "YYYY-MM-DD" inclusive
 * @param termLabel  e.g. "Term 1 2025"
 */
export async function generateTermlyReport(
  schoolId:    string,
  schoolName:  string,
  startDate:   string,
  endDate:     string,
  termLabel:   string,
  absenteeThreshold = 80, // % below which student is flagged
): Promise<TermlyReport> {
  // Fetch all attendance records for this school in the date range
  const attQ = query(
    collection(db, 'attendance'),
    where('schoolId', '==', schoolId),
    where('date', '>=', startDate),
    where('date', '<=', endDate),
  );
  const attSnap = await getDocs(attQ);
  const records = attSnap.docs.map(d => d.data() as RawAttendanceRecord);

  // Fetch all registers to know which days had a register (totalDays denominator)
  const regQ = query(
    collection(db, 'registers'),
    where('schoolId', '==', schoolId),
    where('date', '>=', startDate),
    where('date', '<=', endDate),
  );
  const regSnap = await getDocs(regQ);
  const registerDates = new Set(regSnap.docs.map(d => (d.data() as RawRegister).date));

  // Group records by classCode → studentId
  const byClass: Record<string, Record<string, RawAttendanceRecord[]>> = {};
  for (const rec of records) {
    if (!byClass[rec.classCode]) byClass[rec.classCode] = {};
    if (!byClass[rec.classCode][rec.studentId]) byClass[rec.classCode][rec.studentId] = [];
    byClass[rec.classCode][rec.studentId].push(rec);
  }

  const classes: TermlyClassSummary[] = [];
  const allStudentRows: TermlyStudentRow[] = [];

  for (const [classCode, studentMap] of Object.entries(byClass)) {
    // Count distinct register days for this class
    const classDays = [...registerDates].filter(date => {
      // A day counts if any student in this class has a record on that date
      return records.some(r => r.classCode === classCode && r.date === date);
    });
    const totalDays = classDays.length || 1; // avoid /0

    const studentRows: TermlyStudentRow[] = Object.entries(studentMap).map(
      ([studentId, recs]) => {
        const present = recs.filter(r => r.status === 'present').length;
        const absent  = recs.filter(r => r.status === 'absent').length;
        const late    = recs.filter(r => r.status === 'late').length;
        const excused = recs.filter(r => r.status === 'excused').length;
        const rate    = Math.round((present / totalDays) * 100);
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

    const avgRate = studentRows.length
      ? Math.round(studentRows.reduce((s, r) => s + r.rate, 0) / studentRows.length)
      : 0;

    // Sort by name
    studentRows.sort((a, b) => a.studentName.localeCompare(b.studentName));
    classes.push({ classCode, totalDays, avgRate, students: studentRows });
    allStudentRows.push(...studentRows);
  }

  // Sort classes alphabetically
  classes.sort((a, b) => a.classCode.localeCompare(b.classCode));

  const overallRate = allStudentRows.length
    ? Math.round(allStudentRows.reduce((s, r) => s + r.rate, 0) / allStudentRows.length)
    : 0;

  const chronicAbsentees = allStudentRows
    .filter(r => r.rate < absenteeThreshold)
    .sort((a, b) => a.rate - b.rate);

  return {
    schoolId,
    schoolName,
    termLabel,
    startDate,
    endDate,
    generatedAt: new Date().toISOString(),
    totalStudents: allStudentRows.length,
    overallRate,
    classes,
    chronicAbsentees,
  };
}

// ─── 2. Weekly Summary ─────────────────────────────────────────────────────────

/**
 * Fetches register data for the Mon–Sun week containing `referenceDate`.
 */
export async function generateWeeklySummary(
  schoolId:     string,
  schoolName:   string,
  referenceDate: Date = new Date(),
): Promise<WeeklySummary> {
  const { start, end } = weekBounds(referenceDate);

  // Fetch registers for the week
  const regQ = query(
    collection(db, 'registers'),
    where('schoolId', '==', schoolId),
    where('date', '>=', start),
    where('date', '<=', end),
  );
  const regSnap = await getDocs(regQ);
  const registers = regSnap.docs.map(d => d.data() as RawRegister);

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
 */
export async function generateStudentProfile(
  studentId:   string,
  schoolId:    string,
  schoolName:  string,
  limitDays:   number = 180,
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

  const records = attSnap.docs
    .map(d => d.data() as RawAttendanceRecord)
    .sort((a, b) => a.date.localeCompare(b.date)); // ascending

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