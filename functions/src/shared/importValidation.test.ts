import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  autoDetectMapping, rowsFromRecords, validateRows, buildStudentWrite, normaliseAdmissionNo, cellText,
  ValidationContext,
} from './importValidation';
import type { ClassStructureLike } from './classResolver';

const cs: ClassStructureLike = {
  levels: ['Grade 1', 'Grade 2'], streamsEnabled: false, streamMode: 'none', classes: ['Grade 1', 'Grade 2'],
};
const ctx = (over: Partial<ValidationContext> = {}): ValidationContext => ({
  classStructure: cs, existingStudents: [], activeAcademicYearId: '12345_2026', scope: 'wholeSchool', ...over,
});

test('autoDetectMapping maps common headers and lets exact aliases beat fuzzy ones', () => {
  const m = autoDetectMapping(['Adm No', 'Student Name', 'Class', 'Guardian Contact', 'Parent Name']);
  assert.deepEqual(m, {
    admissionNo: 'Adm No', name: 'Student Name', classCode: 'Class', parentPhone: 'Guardian Contact', parentName: 'Parent Name',
  });
});

test('autoDetectMapping honours school-taught aliases', () => {
  const m = autoDetectMapping(['admin nos', 'pupil', 'level'], { admissionNo: ['admin nos'] });
  assert.equal(m.admissionNo, 'admin nos');
});

test('rowsFromRecords stringifies numbers and trims; unmapped columns are ignored', () => {
  const rows = rowsFromRecords(
    [{ A: 1042, N: '  Amina ', X: 'ignored' }],
    { admissionNo: 'A', name: 'N' },
  );
  assert.deepEqual(rows[0].values, { admissionNo: '1042', name: 'Amina' });
  assert.equal(rows[0].rowIndex, 1);
  assert.equal(cellText(null), '');
});

test('a clean row validates and gets its class resolved', () => {
  const rows = validateRows(rowsFromRecords(
    [{ adm: 'a-1', name: 'Amina Yusuf', cls: 'grade 1', tel: '0722 123 456' }],
    { admissionNo: 'adm', name: 'name', classCode: 'cls', parentPhone: 'tel' },
  ), ctx());
  assert.equal(rows[0].isValid, true);
  assert.equal(rows[0].resolvedClassCode, 'Grade 1');
});

test('missing fields, bad phone and unknown class are reported per row', () => {
  const rows = validateRows(rowsFromRecords(
    [{ adm: '', name: '', cls: 'Form 9', tel: '123' }],
    { admissionNo: 'adm', name: 'name', classCode: 'cls', parentPhone: 'tel' },
  ), ctx());
  const types = rows[0].issues.map(i => i.type).sort();
  assert.deepEqual(types, ['invalid_phone', 'missing_admission_no', 'missing_name', 'unknown_class']);
  assert.equal(rows[0].isValid, false);
});

test('duplicates are caught against the existing roster and within the file', () => {
  const rows = validateRows(rowsFromRecords([
    { adm: 'ADM-1', name: 'Existing Pupil', cls: 'Grade 1', tel: '' },
    { adm: 'adm 2', name: 'New One', cls: 'Grade 1', tel: '' },
    { adm: 'ADM2', name: 'Other Name', cls: 'Grade 1', tel: '' },
    { adm: 'ADM-3', name: 'New One', cls: 'Grade 2', tel: '' },
  ], { admissionNo: 'adm', name: 'name', classCode: 'cls', parentPhone: 'tel' }),
  ctx({ existingStudents: [{ admissionNo: 'adm-1', name: 'x', parentPhone: '' }] }));
  assert.equal(rows[0].issues[0].type, 'duplicate_admission_no');   // exists already (normalised)
  assert.equal(rows[1].isValid, true);
  assert.equal(rows[2].issues[0].type, 'duplicate_admission_no');   // same as row 2 once normalised
  assert.equal(rows[3].issues[0].type, 'duplicate_student');        // same name + same (blank) phone as row 2
});

test('single-class scope forces the target class and ignores the class column', () => {
  const rows = validateRows(rowsFromRecords(
    [{ adm: '1', name: 'A', cls: 'nonsense' }], { admissionNo: 'adm', name: 'name', classCode: 'cls' },
  ), ctx({ scope: 'singleClass', targetClassCode: 'Grade 2' }));
  assert.equal(rows[0].isValid, true);
  assert.equal(rows[0].resolvedClassCode, 'Grade 2');
  const noTarget = validateRows(rowsFromRecords([{ adm: '1', name: 'A' }], { admissionNo: 'adm', name: 'name' }), ctx({ scope: 'singleClass' }));
  assert.equal(noTarget[0].issues[0].type, 'unknown_class');
});

test('a school with no active academic year cannot import', () => {
  const rows = validateRows(rowsFromRecords([{ adm: '1', name: 'A', cls: 'Grade 1' }],
    { admissionNo: 'adm', name: 'name', classCode: 'cls' }), ctx({ activeAcademicYearId: null }));
  assert.equal(rows[0].issues.some(i => i.type === 'unknown_academic_year'), true);
});

test('buildStudentWrite produces the student and enrolment documents the importer writes', () => {
  const [row] = validateRows(rowsFromRecords(
    [{ adm: ' adm 7 ', name: ' Amina ', cls: 'Grade 1', pn: ' Mum ', tel: '+254722123456', nid: ' 999 ' }],
    { admissionNo: 'adm', name: 'name', classCode: 'cls', parentName: 'pn', parentPhone: 'tel', nationalId: 'nid' },
  ), ctx());
  const w = buildStudentWrite(row, { schoolId: '12345', academicYearId: '12345_2026', studentId: 'stu1', now: '2026-10-11T00:00:00.000Z' });
  assert.equal(w.enrolmentId, '12345_2026_stu1');
  assert.deepEqual(w.student, {
    name: 'Amina', admissionNo: 'ADM7', classCode: 'Grade 1', schoolId: '12345', parentName: 'Mum',
    parentPhone: '0722123456', parentWhatsApp: '0722123456', createdAt: '2026-10-11T00:00:00.000Z',
    nationalId: '999', currentEnrolmentId: '12345_2026_stu1',
  });
  assert.deepEqual(w.enrolment, {
    id: '12345_2026_stu1', studentId: 'stu1', schoolId: '12345', academicYearId: '12345_2026',
    classCode: 'Grade 1', status: 'active', createdAt: '2026-10-11T00:00:00.000Z',
  });
});

test('buildStudentWrite refuses a row with no resolved class', () => {
  assert.throws(() => buildStudentWrite({ rowIndex: 3, values: {}, issues: [], isValid: true },
    { schoolId: 's', academicYearId: 'y', studentId: 'i', now: 'n' }), /no resolved class/);
});

test('normaliseAdmissionNo uppercases and removes whitespace', () => {
  assert.equal(normaliseAdmissionNo(' adm 2026 / 014 '), 'ADM2026/014');
});
