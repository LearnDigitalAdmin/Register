/**
 * Attendance-report maths shared by the app (browser) and Cloud Functions.
 *
 * Pure functions only — no Firebase, no DOM, no imports. `src/shared/*` is copied byte-for-byte into
 * `functions/src/shared/*` (`functions/src/shared/sync.test.ts` fails if the two trees drift), so the report the
 * Samuhia Desk delegate produces for a school is computed by exactly the code the Reports screen uses.
 * The browser fetches with the web SDK (src/services/reportsService.ts) and the delegate fetches with the Admin SDK;
 * both then hand the raw records to the builders below.
 *
 * ─── Counting model (unchanged from the original reportsService) ─────────────
 * Student *counts* come from the live roster for any window that includes today, so a student with no register yet
 * still appears (0 tracked days, not a fabricated 0% rate). `totalStudents` is a distinct-student count, never a sum of
 * class buckets. For a closed historical window the live roster is NOT used. Records whose classCode isn't one of the
 * school's configured classes are dropped before grouping.
 */

export type ReportAttendanceStatus = 'present' | 'absent' | 'late' | 'excused' | 'unmarked';

// ─── Raw Firestore shapes ──────────────────────────────────────────────────

export interface RawAttendanceRecord {
  studentId:   string;
  studentName: string;
  admissionNo: string;
  date:        string; // "YYYY-MM-DD"
  classCode:   string;
  schoolId:    string;
  status:      ReportAttendanceStatus;
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

/** The roster fields the termly report reads. */
export interface RosterStudentLike {
  id: string;
  name: string;
  admissionNo: string;
  classCode: string;
}

// ─── Report output types ───────────────────────────────────────────────────

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

// ─── Date helpers ──────────────────────────────────────────────────────────

/** "2025-01-27" → Date (local) */
export function ymdToDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Date → "YYYY-MM-DD" using the LOCAL calendar date (the inverse of `ymdToDate`). The original used
 * `toISOString()`, which for a local-midnight date east of UTC (Kenya) yields the previous day and shifted every week
 * boundary back by one; local components are correct in every timezone and identical on UTC servers. */
export function dateToYmd(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Week boundaries (Mon–Sun) containing a date */
export function weekBounds(d: Date): { start: string; end: string } {
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
 * A reporting window "is current" when it includes (or extends past) today — i.e. the term/period hasn't fully
 * concluded yet. Only current windows get the live-roster merge; a report for a term that's already over should
 * reflect history as it stood, not today's roster.
 */
export function isCurrentReportingWindow(endDate: string, todayYmd: string): boolean {
  return endDate >= todayYmd;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ─── 1. Termly attendance report ───────────────────────────────────────────

export interface TermlyReportInput {
  schoolId:    string;
  schoolName:  string;
  startDate:   string;
  endDate:     string;
  termLabel:   string;
  /** % below which a student is flagged. */
  absenteeThreshold: number;
  /** When set, only records tagged with this year (or untagged pre-enrolment legacy records) are included. */
  academicYearId?: string;
  /** When set, scope the whole report to just this class. */
  classCodeFilter?: string;
  /** Every attendance record in [startDate, endDate]. */
  attendance:  RawAttendanceRecord[];
  /** Every register in [startDate, endDate]. */
  registers:   RawRegister[];
  /** The school's configured class codes, or null to skip the "known class" filter (school still mid-setup). */
  knownClassCodes: Set<string> | null;
  /** The live roster — pass [] for a closed historical window (see `isCurrentReportingWindow`). */
  roster:      RosterStudentLike[];
  generatedAt: string;
}

export function buildTermlyReport(input: TermlyReportInput): TermlyReport {
  const {
    schoolId, schoolName, startDate, endDate, termLabel, absenteeThreshold,
    academicYearId, classCodeFilter, knownClassCodes, roster, generatedAt,
  } = input;

  let records = input.attendance;
  if (academicYearId) {
    records = records.filter(r => !r.academicYearId || r.academicYearId === academicYearId);
  }
  if (classCodeFilter) {
    records = records.filter(r => r.classCode === classCodeFilter);
  }
  if (knownClassCodes) {
    records = records.filter(r => knownClassCodes.has(r.classCode));
  }

  let regDocs = input.registers;
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

  // Live roster merge — only students of the (optionally filtered) class and of a known class.
  const rosterByClass: Record<string, RosterStudentLike[]> = {};
  for (const s of roster) {
    if (classCodeFilter && s.classCode !== classCodeFilter) continue;
    if (knownClassCodes && !knownClassCodes.has(s.classCode)) continue;
    if (!rosterByClass[s.classCode]) rosterByClass[s.classCode] = [];
    rosterByClass[s.classCode].push(s);
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

  // Distinct-student count school-wide — a student whose history legitimately spans more than one classCode
  // (an internal transfer mid-term) is still only counted once here.
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
    generatedAt,
    totalStudents,
    overallRate,
    classes,
    chronicAbsentees,
  };
}

// ─── 2. Weekly summary ─────────────────────────────────────────────────────

export interface WeeklySummaryInput {
  schoolId:     string;
  schoolName:   string;
  /** Any date inside the Mon–Sun week to report on. */
  referenceDate: Date;
  academicYearId?: string;
  classCodeFilter?: string;
  /** Every register in the week (see `weekBounds`). */
  registers:    RawRegister[];
  knownClassCodes: Set<string> | null;
  generatedAt:  string;
}

export function buildWeeklySummary(input: WeeklySummaryInput): WeeklySummary {
  const { schoolId, schoolName, referenceDate, academicYearId, classCodeFilter, knownClassCodes, generatedAt } = input;
  const { start, end } = weekBounds(referenceDate);

  let registers = input.registers;
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
    generatedAt,
    classes,
    overallRate,
  };
}

// ─── CSV rows ──────────────────────────────────────────────────────────────

const defaultFormatTimestamp = (iso: string): string => new Date(iso).toLocaleString('en-KE');

/** Rows of the termly CSV export (header block, blank row, column titles, one row per student). */
export function termlyCsvRows(report: TermlyReport, formatTimestamp: (iso: string) => string = defaultFormatTimestamp): string[][] {
  return [
    [`${report.schoolName} — ${report.termLabel} Attendance Report`],
    [`Generated: ${formatTimestamp(report.generatedAt)}`],
    [],
    ['Class', 'Student Name', 'Admission No.', 'Total Days', 'Present', 'Absent', 'Late', 'Excused', 'Rate (%)'],
    ...report.classes.reduce<string[][]>((acc, c) => acc.concat(
      c.students.map(s => [
        s.classCode, s.studentName, s.admissionNo,
        String(s.totalDays), String(s.present), String(s.absent),
        String(s.late), String(s.excused), String(s.rate) + '%',
      ]),
    ), []),
  ];
}

/** Rows of the weekly CSV export. */
export function weeklyCsvRows(report: WeeklySummary): string[][] {
  return [
    [`${report.schoolName} — Weekly Summary ${report.weekStart} to ${report.weekEnd}`],
    [],
    ['Class', 'Day', 'Date', 'Present', 'Absent', 'Late', 'Excused', 'Total', 'Rate (%)'],
    ...report.classes.reduce<string[][]>((acc, c) => acc.concat(
      c.days.map(d => [
        c.classCode, d.dayName, d.date,
        String(d.present), String(d.absent), String(d.late),
        String(d.excused), String(d.total), d.hasRegister ? String(d.rate) + '%' : 'No register',
      ]),
    ), []),
  ];
}
