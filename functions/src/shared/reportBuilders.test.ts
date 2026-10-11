import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTermlyReport, buildWeeklySummary, weekBounds, isCurrentReportingWindow, termlyCsvRows, weeklyCsvRows,
  RawAttendanceRecord, RawRegister,
} from './reportBuilders';

const att = (studentId: string, date: string, status: RawAttendanceRecord['status'], classCode = 'Grade 1'): RawAttendanceRecord => ({
  studentId, studentName: `Pupil ${studentId}`, admissionNo: `A${studentId}`, date, classCode, schoolId: 's',
  status, note: '', savedBy: 'u', savedAt: '', locked: true,
});
const reg = (date: string, present: number, total: number, classCode = 'Grade 1'): RawRegister => ({
  date, classCode, schoolId: 's', savedBy: 'u', savedAt: '', locked: true, present, absent: total - present, late: 0, excused: 0, total,
});
const base = {
  schoolId: 's', schoolName: 'Test School', startDate: '2026-02-02', endDate: '2026-02-06', termLabel: 'Term 1',
  absenteeThreshold: 80, knownClassCodes: new Set(['Grade 1']), roster: [], generatedAt: '2026-02-07T00:00:00.000Z',
};

test('termly report computes per-student rates from register days and flags chronic absentees', () => {
  const r = buildTermlyReport({
    ...base,
    attendance: [
      att('1', '2026-02-02', 'present'), att('1', '2026-02-03', 'present'),
      att('2', '2026-02-02', 'present'), att('2', '2026-02-03', 'absent'),
    ],
    registers: [reg('2026-02-02', 2, 2), reg('2026-02-03', 1, 2)],
  });
  const rows = r.classes[0].students;
  assert.equal(r.classes[0].totalDays, 2);
  assert.equal(rows.find(s => s.studentId === '1')!.rate, 100);
  assert.equal(rows.find(s => s.studentId === '2')!.rate, 50);
  assert.equal(r.overallRate, 75);
  assert.deepEqual(r.chronicAbsentees.map(s => s.studentId), ['2']);
  assert.equal(r.totalStudents, 2);
});

test('records for unknown classes and other academic years are dropped', () => {
  const r = buildTermlyReport({
    ...base, academicYearId: 'Y1',
    attendance: [
      { ...att('1', '2026-02-02', 'present'), academicYearId: 'Y1' },
      { ...att('2', '2026-02-02', 'present'), academicYearId: 'Y0' },
      att('3', '2026-02-02', 'present', 'Ghost class'),
      att('4', '2026-02-02', 'present'), // untagged legacy record is kept
    ],
    registers: [reg('2026-02-02', 2, 2)],
  });
  assert.deepEqual(r.classes[0].students.map(s => s.studentId).sort(), ['1', '4']);
});

test('roster students with no records appear with 0 tracked days and do not drag the average down', () => {
  const r = buildTermlyReport({
    ...base,
    attendance: [att('1', '2026-02-02', 'present')],
    registers: [reg('2026-02-02', 1, 1)],
    roster: [{ id: '9', name: 'New Pupil', admissionNo: 'N9', classCode: 'Grade 1' }],
  });
  const fresh = r.classes[0].students.find(s => s.studentId === '9')!;
  assert.equal(fresh.totalDays, 0);
  assert.equal(r.classes[0].avgRate, 100);
  assert.equal(r.totalStudents, 2);
});

test('a student whose history spans two classes is counted once school-wide', () => {
  const r = buildTermlyReport({
    ...base, knownClassCodes: null,
    attendance: [att('1', '2026-02-02', 'present', 'Grade 1'), att('1', '2026-02-03', 'present', 'Grade 2')],
    registers: [reg('2026-02-02', 1, 1, 'Grade 1'), reg('2026-02-03', 1, 1, 'Grade 2')],
  });
  assert.equal(r.classes.length, 2);
  assert.equal(r.totalStudents, 1);
});

test('week bounds run Monday to Sunday and the window is current until its end date passes', () => {
  const ref = new Date(2026, 1, 4); // Wed 4 Feb 2026 (local)
  const b = weekBounds(ref);
  assert.equal(new Date(b.start + 'T12:00:00Z').getUTCDay(), 1);
  assert.equal(new Date(b.end + 'T12:00:00Z').getUTCDay(), 0);
  assert.equal(isCurrentReportingWindow('2026-02-06', '2026-02-06'), true);
  assert.equal(isCurrentReportingWindow('2026-02-06', '2026-02-07'), false);
});

test('weekly summary lists Mon-Fri per class, with "no register" days', () => {
  const ref = new Date(2026, 1, 4);
  const { start } = weekBounds(ref);
  const s = buildWeeklySummary({
    schoolId: 's', schoolName: 'Test School', referenceDate: ref, knownClassCodes: null, generatedAt: 'g',
    registers: [reg(start, 8, 10)],
  });
  assert.equal(s.classes.length, 1);
  assert.equal(s.classes[0].days.length, 5);
  assert.equal(s.classes[0].days[0].hasRegister, true);
  assert.equal(s.classes[0].days[0].rate, 80);
  assert.equal(s.classes[0].days[1].hasRegister, false);
  assert.equal(s.overallRate, 80);
});

test('CSV rows keep the column layout of the existing exports', () => {
  const r = buildTermlyReport({ ...base, attendance: [att('1', '2026-02-02', 'present')], registers: [reg('2026-02-02', 1, 1)] });
  const rows = termlyCsvRows(r, () => 'T');
  assert.equal(rows[0][0], 'Test School — Term 1 Attendance Report');
  assert.equal(rows[1][0], 'Generated: T');
  assert.deepEqual(rows[3], ['Class', 'Student Name', 'Admission No.', 'Total Days', 'Present', 'Absent', 'Late', 'Excused', 'Rate (%)']);
  assert.deepEqual(rows[4], ['Grade 1', 'Pupil 1', 'A1', '1', '1', '0', '0', '0', '100%']);
  const w = weeklyCsvRows(buildWeeklySummary({ schoolId: 's', schoolName: 'S', referenceDate: new Date(2026, 1, 4), knownClassCodes: null, generatedAt: 'g', registers: [] }));
  assert.equal(w.length, 3);
});
