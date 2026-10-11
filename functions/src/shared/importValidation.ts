/**
 * Student-import rules shared by the app (browser) and Cloud Functions.
 *
 * This file has NO third-party or Firebase imports on purpose: `src/shared/*` is copied byte-for-byte into
 * `functions/src/shared/*` (see `functions/src/shared/sync.test.ts`, which fails if the two trees drift), so
 * the Samuhia Desk delegate validates and writes students with exactly the rules the importer wizard uses.
 * Import the types from `src/types.ts` in app code; that file re-exports them.
 */
import { normalisePhone } from './phone';
import { resolveClassCode, ClassStructureLike } from './classResolver';

// ─── Fields ────────────────────────────────────────────────────────────────

/** Canonical field keys the importer can map spreadsheet columns onto. */
export type ImportFieldKey =
  | 'admissionNo'
  | 'name'
  | 'classCode'
  | 'streamCode'
  | 'parentName'
  | 'parentPhone'
  | 'parentWhatsApp'
  | 'nationalId'
  | 'upiNumber';

/** Which import fields are mandatory vs optional (before scope is taken into account —
 * see `requiredFieldsMapped`, which is scope-aware). */
export const IMPORT_REQUIRED_FIELDS: ImportFieldKey[] = ['admissionNo', 'name', 'classCode'];
export const IMPORT_OPTIONAL_FIELDS: ImportFieldKey[] = ['streamCode', 'parentName', 'parentPhone', 'parentWhatsApp', 'nationalId', 'upiNumber'];

/**
 * Whole-school imports read the class (and optionally stream) from the file and resolve them
 * against the school's class structure for every row. Single-class imports force every row into
 * one admin/teacher-chosen class and ignore any class/stream column entirely — this is the
 * default, safer mode, since it can't accidentally scatter students across the wrong classes.
 */
export type ImportScope = 'singleClass' | 'wholeSchool';

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
  /** The canonical class code this row will actually be written with, once resolved —
   * either the extraction engine's result (wholeSchool scope) or the forced target class
   * (singleClass scope). Never derived from `values.classCode` directly at import time. */
  resolvedClassCode?: string;
  issues: ImportRowIssue[];
  /** True once the row has no blocking issues and is ready to import. */
  isValid: boolean;
  /** User chose to skip this row even if it's otherwise valid. */
  excluded?: boolean;
}

/** Admission numbers may be teacher-entered (letters + numbers, e.g. "ADM-2026-014") or
 * left blank to auto-generate. Normalised to uppercase with internal whitespace removed. */
export function normaliseAdmissionNo(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

// ─── Column auto-detection ─────────────────────────────────────────────────

/** Known header aliases -> canonical field, used to pre-select the likely mapping.
 * Deliberately broad — real files spell these dozens of ways. Kept alias sets disjoint
 * between fields where possible (e.g. "id no" only under nationalId, not admissionNo) so
 * one ambiguous header doesn't get silently claimed by the wrong field. */
export const FIELD_ALIASES: Record<ImportFieldKey, string[]> = {
  admissionNo: [
    'admission', 'admission no', 'admission no.', 'admission number', 'admission#', 'admission #',
    'adm no', 'adm no.', 'adm', 'admno', 'adm number', 'adm num',
    'reg no', 'reg no.', 'regno', 'registration no', 'registration number',
    'index no', 'index number', 'student no', 'student number', 'studentno',
    'pupil no', 'pupil number', 'learner no', 'learner number', 'roll no', 'roll number', 'serial no',
  ],
  name: [
    'student name', 'name', 'full name', 'full names', 'names',
    'learner', 'learner name', 'learner names', 'pupil name', "pupil's name",
    'student', "student's name", 'child name', "child's name", "student full name",
  ],
  classCode: [
    'class', 'class code', 'classcode', 'grade', 'form', 'stream class', 'level',
    'class/stream', 'class stream', 'class & stream', 'class and stream',
    'current class', 'grade/class', 'class level', 'class name', 'class/grade',
  ],
  streamCode: [
    'stream', 'stream code', 'streamcode', 'section', 'stream name', 'stream only', 'class stream only',
  ],
  parentName: [
    'guardian', 'parent', 'parent name', 'guardian name', 'parent/guardian', 'parent/guardian name',
    'next of kin', 'nok', 'next of kin name', 'father', 'mother', "parent's name", "guardian's name",
  ],
  parentPhone: [
    'phone', 'mobile', 'parent phone', 'guardian phone', 'contact', 'telephone', 'tel',
    'phone number', 'mobile number', 'cell', 'contact no', 'contact number',
    'parent contact', 'guardian contact', 'mobile no', 'tel no', 'sms number', 'sms no', 'phone no',
  ],
  parentWhatsApp: [
    'whatsapp', 'whatsapp no', 'whatsapp number', 'whatsapp contact', 'wa number', 'wa no',
  ],
  nationalId: [
    'national id', 'nationalid', 'id no', 'id number', 'birth cert', 'birth certificate',
    'birth cert no', 'birth certificate no', 'b/c no', 'bcert', 'national id/birth cert',
  ],
  upiNumber: [
    'upi', 'upi no', 'upi number', 'unique pupil identifier', 'nemis no', 'nemis number',
    'learner unique no', 'unique learner no', 'uln',
  ],
};

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Auto-detects the best-guess mapping from spreadsheet column headers to canonical fields.
 * `customAliases` (school-taught, persisted phrases — see `addCustomAlias`) are checked
 * alongside the built-in library, so a school's own vocabulary gets recognised too.
 *
 * Runs in two global passes rather than per-field: ALL exact-match assignments happen first,
 * across every field, before ANY fuzzy "contains" match is attempted. Otherwise field
 * processing order would decide the outcome — e.g. "Guardian Contact" has an exact alias
 * under parentPhone, but parentName's vague "guardian" alias would fuzzy-claim it first if
 * parentName happened to be checked earlier. Exact should always beat fuzzy, never lose to it. */
export function autoDetectMapping(
  columns: string[],
  customAliases?: Partial<Record<ImportFieldKey, string[]>>,
): Partial<Record<ImportFieldKey, string>> {
  const mapping: Partial<Record<ImportFieldKey, string>> = {};
  const usedColumns = new Set<string>();
  const fieldKeys = Object.keys(FIELD_ALIASES) as ImportFieldKey[];
  const aliasesByField = new Map<ImportFieldKey, string[]>(
    fieldKeys.map(f => [f, [...(customAliases?.[f] || []), ...FIELD_ALIASES[f]].map(norm)]),
  );

  // Phase 1: exact matches only, across every field.
  for (const field of fieldKeys) {
    const aliases = aliasesByField.get(field)!;
    for (const col of columns) {
      if (usedColumns.has(col)) continue;
      if (aliases.includes(norm(col))) { mapping[field] = col; usedColumns.add(col); break; }
    }
  }
  // Phase 2: fuzzy "contains" matches, only for fields still unmapped.
  for (const field of fieldKeys) {
    if (mapping[field]) continue;
    const aliases = aliasesByField.get(field)!;
    for (const col of columns) {
      if (usedColumns.has(col)) continue;
      const n = norm(col);
      if (aliases.some(a => n.includes(a) || a.includes(n))) { mapping[field] = col; usedColumns.add(col); break; }
    }
  }
  return mapping;
}

/** Spreadsheet cell / JSON value -> trimmed text. Numbers (e.g. an admission number typed as 1042) become "1042". */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

/** Turns raw records (header -> value) into importer rows using a field -> header mapping. */
export function rowsFromRecords(
  records: Array<Record<string, unknown>>,
  mapping: Partial<Record<ImportFieldKey, string>>,
): ImportRow[] {
  return records.map((raw, i) => {
    const values: Partial<Record<ImportFieldKey, string>> = {};
    (Object.keys(mapping) as ImportFieldKey[]).forEach(field => {
      const col = mapping[field];
      if (col) values[field] = cellText(raw[col]);
    });
    return { rowIndex: i + 1, values, issues: [], isValid: true };
  });
}

// ─── Validation ────────────────────────────────────────────────────────────

/** The fields of an already-enrolled student the duplicate checks read. */
export interface ExistingStudentLike {
  name: string;
  admissionNo: string;
  parentPhone?: string;
}

export interface ValidationContext {
  classStructure: ClassStructureLike | null;
  existingStudents: ExistingStudentLike[];       // already-loaded roster for this school (for dup checks)
  activeAcademicYearId: string | null;
  scope: ImportScope;
  /** Required and enforced whenever scope === 'singleClass' — every valid row gets this
   * class code regardless of what (if anything) the file itself says about class/stream. */
  targetClassCode?: string;
}

/** Validates all rows in place (mutates issues/isValid/resolvedClassCode), including
 * cross-row duplicate detection and — for `wholeSchool` scope — class/stream resolution. */
export function validateRows(rows: ImportRow[], ctx: ValidationContext): ImportRow[] {
  const seenAdmissionNos = new Map<string, number>(); // admissionNo -> first rowIndex seen in this file
  const existingAdmissionNos = new Set(ctx.existingStudents.map(s => normaliseAdmissionNo(s.admissionNo)));
  const existingNameKeys = new Set(ctx.existingStudents.map(s => `${s.name.trim().toLowerCase()}|${(s.parentPhone || '').trim()}`));
  const seenNameKeys = new Map<string, number>();

  for (const row of rows) {
    const issues: ImportRowIssue[] = [];
    const admissionNo = (row.values.admissionNo || '').trim();
    const name = (row.values.name || '').trim();
    const phone = (row.values.parentPhone || '').trim();

    if (!admissionNo) {
      issues.push({ type: 'missing_admission_no', field: 'admissionNo', message: 'Admission number is missing.' });
    } else {
      const key = normaliseAdmissionNo(admissionNo);
      if (existingAdmissionNos.has(key)) {
        issues.push({ type: 'duplicate_admission_no', field: 'admissionNo', message: `Admission No. "${admissionNo}" already exists for this school.` });
      } else if (seenAdmissionNos.has(key)) {
        issues.push({ type: 'duplicate_admission_no', field: 'admissionNo', message: `Duplicate admission number within the file (also row ${seenAdmissionNos.get(key)}).` });
      } else {
        seenAdmissionNos.set(key, row.rowIndex);
      }
    }

    if (!name) {
      issues.push({ type: 'missing_name', field: 'name', message: 'Student name is missing.' });
    } else {
      const nameKey = `${name.toLowerCase()}|${phone}`;
      if (existingNameKeys.has(nameKey)) {
        issues.push({ type: 'duplicate_student', field: 'name', message: `A student named "${name}" with the same parent phone already exists.` });
      } else if (seenNameKeys.has(nameKey)) {
        issues.push({ type: 'duplicate_student', field: 'name', message: `Duplicate student within the file (also row ${seenNameKeys.get(nameKey)}).` });
      } else {
        seenNameKeys.set(nameKey, row.rowIndex);
      }
    }

    if (phone && !normalisePhone(phone)) {
      issues.push({ type: 'invalid_phone', field: 'parentPhone', message: `"${phone}" doesn't look like a valid Kenyan phone number.` });
    }

    if (ctx.scope === 'singleClass') {
      // Class/stream columns (if mapped at all) are ignored entirely — every valid row goes
      // into the one class the importer explicitly chose before starting the import.
      if (!ctx.targetClassCode) {
        issues.push({ type: 'unknown_class', message: 'No target class was selected for this import.' });
      } else {
        row.resolvedClassCode = ctx.targetClassCode;
      }
    } else {
      const rawClass = (row.values.classCode || '').trim();
      const rawStream = (row.values.streamCode || '').trim();
      if (!rawClass && !rawStream) {
        issues.push({ type: 'unknown_class', field: 'classCode', message: 'Class is missing.' });
      } else {
        const result = resolveClassCode(rawClass, rawStream, ctx.classStructure);
        if (result.resolved) {
          row.resolvedClassCode = result.resolved;
        } else {
          const issueType: ImportRowIssue['type'] =
            result.issue === 'no_level_match' || result.issue === 'ambiguous_level' || result.issue === 'no_class_data'
              ? 'unknown_class' : 'invalid_stream';
          issues.push({ type: issueType, field: 'classCode', message: result.message || `"${(rawClass + ' ' + rawStream).trim()}" couldn't be resolved to a class.` });
        }
      }
    }

    if (!ctx.activeAcademicYearId) {
      issues.push({ type: 'unknown_academic_year', message: 'No active academic year is set for this school.' });
    }

    row.issues = issues;
    row.isValid = issues.length === 0;
  }
  return rows;
}

// ─── Documents written for one imported student ────────────────────────────

export interface StudentWriteInput {
  schoolId: string;
  academicYearId: string;
  /** Firestore id of the new `students` document. */
  studentId: string;
  /** ISO timestamp. */
  now: string;
}

export interface StudentWrite {
  studentId: string;
  enrolmentId: string;
  /** Body of `students/{studentId}`. */
  student: Record<string, unknown>;
  /** Body of `enrolments/{enrolmentId}`. */
  enrolment: Record<string, unknown>;
}

/**
 * The exact `students` + `enrolments` documents the importer writes for one valid row. Throws if the row has no
 * resolved class (a valid row always has one; an unresolved class is never written as a blank classCode).
 */
export function buildStudentWrite(row: ImportRow, input: StudentWriteInput): StudentWrite {
  const classCode = row.resolvedClassCode;
  if (!classCode) throw new Error(`Row ${row.rowIndex} has no resolved class.`);
  const v = row.values;
  const enrolmentId = `${input.academicYearId}_${input.studentId}`;
  const student: Record<string, unknown> = {
    name: (v.name || '').trim(),
    admissionNo: normaliseAdmissionNo(v.admissionNo || ''),
    classCode,
    schoolId: input.schoolId,
    parentName: (v.parentName || '').trim(),
    parentPhone: normalisePhone(v.parentPhone || '') || (v.parentPhone || '').trim(),
    parentWhatsApp: normalisePhone(v.parentWhatsApp || v.parentPhone || '') || (v.parentWhatsApp || v.parentPhone || '').trim(),
    createdAt: input.now,
    ...(v.nationalId ? { nationalId: v.nationalId.trim() } : {}),
    currentEnrolmentId: enrolmentId,
  };
  const enrolment: Record<string, unknown> = {
    id: enrolmentId, studentId: input.studentId, schoolId: input.schoolId,
    academicYearId: input.academicYearId, classCode,
    status: 'active', createdAt: input.now,
  };
  return { studentId: input.studentId, enrolmentId, student, enrolment };
}
