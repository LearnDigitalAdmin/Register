import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { doc, getDoc, setDoc, writeBatch, collection } from 'firebase/firestore';
import { db } from '../firebase';
import {
  ClassStructure, Student, Enrolment,
  ImportFieldKey, ImportColumnMapping, ImportRow, ImportRowIssue, ImportSummary,
  IMPORT_REQUIRED_FIELDS, normaliseAdmissionNo,
} from '../types';
import { normalisePhone } from '../utils/phoneValidation';

// ─── Parsing ────────────────────────────────────────────────────────────────

export interface ParsedSheet {
  fileName: string;
  sheetName: string;
  columns: string[];
  rows: Record<string, string>[]; // raw string values keyed by original column header
  rowCount: number;
}

const MAX_IMPORT_ROWS = 20000; // sane ceiling to keep the browser responsive on "very large" files

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}

/** Parses a CSV file using PapaParse (streamed, worker-free but chunked so large files don't block). */
function parseCsv(file: File): Promise<ParsedSheet> {
  return new Promise((resolve, reject) => {
    const rows: Record<string, string>[] = [];
    let columns: string[] = [];
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      worker: true,
      chunk: (results) => {
        if (columns.length === 0) columns = results.meta.fields || [];
        for (const r of results.data) {
          if (rows.length >= MAX_IMPORT_ROWS) break;
          const clean: Record<string, string> = {};
          for (const k of Object.keys(r)) clean[k] = cellToString((r as Record<string, unknown>)[k]);
          rows.push(clean);
        }
      },
      complete: () => resolve({
        fileName: file.name, sheetName: 'CSV', columns, rows, rowCount: rows.length,
      }),
      error: (err) => reject(err),
    });
  });
}

/** Parses XLS/XLSX using SheetJS, reading only the first worksheet. */
async function parseExcel(file: File): Promise<ParsedSheet> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '', raw: false });
  const columns = json.length > 0 ? Object.keys(json[0]) : (XLSX.utils.sheet_to_json(ws, { header: 1 })[0] as string[] || []);
  const rows: Record<string, string>[] = json.slice(0, MAX_IMPORT_ROWS).map(r => {
    const clean: Record<string, string> = {};
    for (const k of Object.keys(r)) clean[k] = cellToString(r[k]);
    return clean;
  });
  return { fileName: file.name, sheetName, columns, rows, rowCount: rows.length };
}

export async function parseImportFile(file: File): Promise<ParsedSheet> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'csv') return parseCsv(file);
  if (ext === 'xls' || ext === 'xlsx') return parseExcel(file);
  throw new Error('Unsupported file type. Please upload a CSV, XLS, or XLSX file.');
}

// ─── Column auto-detection ─────────────────────────────────────────────────

/** Known header aliases -> canonical field, used to pre-select the likely mapping. */
const FIELD_ALIASES: Record<ImportFieldKey, string[]> = {
  admissionNo: ['admission', 'admission no', 'admission number', 'adm no', 'adm', 'admno', 'reg no', 'registration no', 'index no'],
  name: ['student name', 'name', 'full name', 'learner', 'learner name', 'pupil name', 'student'],
  classCode: ['class', 'class code', 'classcode', 'grade', 'form', 'stream class', 'level'],
  parentName: ['guardian', 'parent', 'parent name', 'guardian name', 'parent/guardian', 'next of kin', 'father', 'mother'],
  parentPhone: ['phone', 'mobile', 'parent phone', 'guardian phone', 'contact', 'telephone', 'tel', 'phone number', 'mobile number', 'cell'],
  parentWhatsApp: ['whatsapp', 'whatsapp no', 'whatsapp number'],
  nationalId: ['national id', 'nationalid', 'id no', 'birth cert', 'birth certificate', 'birth cert no'],
};

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Auto-detects the best-guess mapping from spreadsheet column headers to canonical fields. */
export function autoDetectMapping(columns: string[]): Partial<Record<ImportFieldKey, string>> {
  const mapping: Partial<Record<ImportFieldKey, string>> = {};
  const usedColumns = new Set<string>();

  const fieldKeys = Object.keys(FIELD_ALIASES) as ImportFieldKey[];
  for (const field of fieldKeys) {
    const aliases = FIELD_ALIASES[field].map(norm);
    // exact match first, then "contains"
    let best: string | null = null;
    for (const col of columns) {
      if (usedColumns.has(col)) continue;
      if (aliases.includes(norm(col))) { best = col; break; }
    }
    if (!best) {
      for (const col of columns) {
        if (usedColumns.has(col)) continue;
        const n = norm(col);
        if (aliases.some(a => n.includes(a) || a.includes(n))) { best = col; break; }
      }
    }
    if (best) { mapping[field] = best; usedColumns.add(best); }
  }
  return mapping;
}

// ─── Saved column mappings (per school) ────────────────────────────────────

export async function getSavedMapping(schoolId: string): Promise<ImportColumnMapping | null> {
  const snap = await getDoc(doc(db, 'importMappings', schoolId));
  return snap.exists() ? (snap.data() as ImportColumnMapping) : null;
}

export async function saveMapping(schoolId: string, mapping: Partial<Record<ImportFieldKey, string>>): Promise<void> {
  const record: ImportColumnMapping = {
    id: schoolId, schoolId, mapping, updatedAt: new Date().toISOString(),
  };
  await setDoc(doc(db, 'importMappings', schoolId), record);
}

export async function resetSavedMapping(schoolId: string): Promise<void> {
  await setDoc(doc(db, 'importMappings', schoolId), {
    id: schoolId, schoolId, mapping: {}, updatedAt: new Date().toISOString(),
  } as ImportColumnMapping);
}

// ─── Row building + validation ─────────────────────────────────────────────

export function buildRows(
  parsed: ParsedSheet,
  mapping: Partial<Record<ImportFieldKey, string>>,
): ImportRow[] {
  return parsed.rows.map((raw, i) => {
    const values: Partial<Record<ImportFieldKey, string>> = {};
    (Object.keys(mapping) as ImportFieldKey[]).forEach(field => {
      const col = mapping[field];
      if (col) values[field] = (raw[col] || '').trim();
    });
    return { rowIndex: i + 1, values, issues: [], isValid: true };
  });
}

export interface ValidationContext {
  classStructure: ClassStructure | null;
  existingStudents: Student[];       // already-loaded roster for this school (for dup checks)
  activeAcademicYearId: string | null;
}

/** Validates all rows in place (mutates issues/isValid), including cross-row duplicate detection. */
export function validateRows(rows: ImportRow[], ctx: ValidationContext): ImportRow[] {
  const seenAdmissionNos = new Map<string, number>(); // admissionNo -> first rowIndex seen in this file
  const existingAdmissionNos = new Set(ctx.existingStudents.map(s => normaliseAdmissionNo(s.admissionNo)));
  const existingNameKeys = new Set(ctx.existingStudents.map(s => `${s.name.trim().toLowerCase()}|${(s.parentPhone || '').trim()}`));
  const seenNameKeys = new Map<string, number>();

  for (const row of rows) {
    const issues: ImportRowIssue[] = [];
    const admissionNo = (row.values.admissionNo || '').trim();
    const name = (row.values.name || '').trim();
    const classCode = (row.values.classCode || '').trim();
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

    if (!classCode) {
      issues.push({ type: 'unknown_class', field: 'classCode', message: 'Class is missing.' });
    } else if (ctx.classStructure) {
      const known = ctx.classStructure.classes.some(c => c.toLowerCase() === classCode.toLowerCase());
      if (!known) {
        // Distinguish "unknown level" vs "known level, invalid/unrecognised stream suffix"
        const levelMatch = ctx.classStructure.levels.find(l => classCode.toLowerCase().startsWith(l.toLowerCase()));
        if (levelMatch && ctx.classStructure.streamsEnabled) {
          issues.push({ type: 'invalid_stream', field: 'classCode', message: `"${classCode}" isn't a recognised stream for ${levelMatch}.` });
        } else {
          issues.push({ type: 'unknown_class', field: 'classCode', message: `"${classCode}" isn't a class at this school.` });
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

// ─── Import execution ───────────────────────────────────────────────────────

const BATCH_CHUNK_SIZE = 200; // 2 writes/student (student + enrolment) → 400 ops, under Firestore's 500/batch cap

export interface ImportParams {
  schoolId: string;
  activeAcademicYearId: string;
  rows: ImportRow[];
  onProgress?: (done: number, total: number) => void;
}

/** Imports all valid, non-excluded rows. Invalid/excluded rows are skipped individually — never aborts the whole batch. */
export async function executeImport(params: ImportParams): Promise<ImportSummary> {
  const { schoolId, activeAcademicYearId, rows, onProgress } = params;
  const summary: ImportSummary = { imported: 0, skipped: 0, duplicate: 0, missingAdmissionNo: 0, failed: 0 };

  const importable = rows.filter(r => !r.excluded);
  const toImport = importable.filter(r => r.isValid);

  for (const r of importable) {
    if (r.isValid) continue;
    if (r.issues.some(i => i.type === 'duplicate_admission_no' || i.type === 'duplicate_student')) summary.duplicate++;
    else if (r.issues.some(i => i.type === 'missing_admission_no')) summary.missingAdmissionNo++;
    else summary.skipped++;
  }
  summary.skipped += rows.length - importable.length; // manually excluded rows

  let done = 0;
  for (let i = 0; i < toImport.length; i += BATCH_CHUNK_SIZE) {
    const chunk = toImport.slice(i, i + BATCH_CHUNK_SIZE);
    try {
      const batch = writeBatch(db);
      for (const row of chunk) {
        const v = row.values;
        const studentRef = doc(collection(db, 'students'));
        const now = new Date().toISOString();
        const student: Omit<Student, 'id'> = {
          name: (v.name || '').trim(),
          admissionNo: (v.admissionNo || '').trim(),
          classCode: (v.classCode || '').trim(),
          schoolId,
          parentName: (v.parentName || '').trim(),
          parentPhone: normalisePhone(v.parentPhone || '') || (v.parentPhone || '').trim(),
          parentWhatsApp: normalisePhone(v.parentWhatsApp || v.parentPhone || '') || (v.parentWhatsApp || v.parentPhone || '').trim(),
          createdAt: now,
          ...(v.nationalId ? { nationalId: v.nationalId.trim() } : {}),
        };
        const enrolmentId = `${activeAcademicYearId}_${studentRef.id}`;
        const enrolment: Enrolment = {
          id: enrolmentId, studentId: studentRef.id, schoolId,
          academicYearId: activeAcademicYearId, classCode: student.classCode,
          status: 'active', createdAt: now,
        };
        batch.set(studentRef, { ...student, currentEnrolmentId: enrolmentId });
        batch.set(doc(db, 'enrolments', enrolmentId), enrolment);
      }
      await batch.commit();
      summary.imported += chunk.length;
    } catch (e) {
      console.error('Import batch failed:', e);
      summary.failed += chunk.length;
    }
    done += chunk.length;
    onProgress?.(done, toImport.length);
  }

  return summary;
}

export function requiredFieldsMapped(mapping: Partial<Record<ImportFieldKey, string>>): boolean {
  return IMPORT_REQUIRED_FIELDS.every(f => !!mapping[f]);
}
