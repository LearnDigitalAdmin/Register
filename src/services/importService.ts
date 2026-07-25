import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { doc, getDoc, setDoc, writeBatch, collection } from 'firebase/firestore';
import { db } from '../firebase';
import {
  ClassStructure, Student, Enrolment,
  ImportFieldKey, ImportColumnMapping, ImportRow, ImportRowIssue, ImportScope, ImportSummary,
  IMPORT_REQUIRED_FIELDS, normaliseAdmissionNo,
} from '../types';
import { normalisePhone } from '../utils/phoneValidation';
import { resolveClassCode } from './classResolver';

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

/** Known header aliases -> canonical field, used to pre-select the likely mapping.
 * Deliberately broad — real files spell these dozens of ways. Kept alias sets disjoint
 * between fields where possible (e.g. "id no" only under nationalId, not admissionNo) so
 * one ambiguous header doesn't get silently claimed by the wrong field. */
const FIELD_ALIASES: Record<ImportFieldKey, string[]> = {
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

/** Reads just the school-taught alias phrases (e.g. "admin nos" → admissionNo), without
 * touching the separate "last exact mapping" cache. */
export async function getCustomAliases(schoolId: string): Promise<Partial<Record<ImportFieldKey, string[]>>> {
  const saved = await getSavedMapping(schoolId);
  return saved?.customFieldAliases || {};
}

/** Teaches the school's field library a new phrase for `field` — persists immediately, so
 * every future import (any file) auto-detects a column with this text, not just this one. */
export async function addCustomAlias(schoolId: string, field: ImportFieldKey, alias: string): Promise<Partial<Record<ImportFieldKey, string[]>>> {
  const cleanAlias = alias.trim().toLowerCase();
  if (!cleanAlias) return getCustomAliases(schoolId);
  const saved = await getSavedMapping(schoolId);
  const current = saved?.customFieldAliases || {};
  const existing = new Set((current[field] || []).map(a => a.toLowerCase()));
  existing.add(cleanAlias);
  const next: Partial<Record<ImportFieldKey, string[]>> = { ...current, [field]: Array.from(existing) };
  await setDoc(doc(db, 'importMappings', schoolId), {
    id: schoolId, schoolId, mapping: saved?.mapping || {}, customFieldAliases: next,
    updatedAt: new Date().toISOString(),
  } as ImportColumnMapping);
  return next;
}

/** Removes a school-taught alias phrase (e.g. it was added by mistake, or was never accurate). */
export async function removeCustomAlias(schoolId: string, field: ImportFieldKey, alias: string): Promise<Partial<Record<ImportFieldKey, string[]>>> {
  const cleanAlias = alias.trim().toLowerCase();
  const saved = await getSavedMapping(schoolId);
  const current = saved?.customFieldAliases || {};
  const next: Partial<Record<ImportFieldKey, string[]>> = {
    ...current, [field]: (current[field] || []).filter(a => a.toLowerCase() !== cleanAlias),
  };
  await setDoc(doc(db, 'importMappings', schoolId), {
    id: schoolId, schoolId, mapping: saved?.mapping || {}, customFieldAliases: next,
    updatedAt: new Date().toISOString(),
  } as ImportColumnMapping);
  return next;
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

  // Rows that somehow reached here `isValid` but without a resolved class (shouldn't happen,
  // since validateRows always sets one or raises an issue) are never silently written with a
  // blank classCode — they're counted as failed instead.
  const writable = toImport.filter(r => !!r.resolvedClassCode);
  summary.failed += toImport.length - writable.length;

  /** Commits one chunk. On failure, splits it in half and retries each half (down to chunks of
   * 1) so a single bad/rejected row doesn't sink every other row that batched alongside it. */
  async function commitChunk(chunk: ImportRow[]): Promise<number> {
    try {
      const batch = writeBatch(db);
      for (const row of chunk) {
        const v = row.values;
        const studentRef = doc(collection(db, 'students'));
        const now = new Date().toISOString();
        const classCode = row.resolvedClassCode!;
        const student: Omit<Student, 'id'> = {
          name: (v.name || '').trim(),
          admissionNo: normaliseAdmissionNo(v.admissionNo || ''),
          classCode,
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
          academicYearId: activeAcademicYearId, classCode,
          status: 'active', createdAt: now,
        };
        batch.set(studentRef, { ...student, currentEnrolmentId: enrolmentId });
        batch.set(doc(db, 'enrolments', enrolmentId), enrolment);
      }
      await batch.commit();
      return chunk.length;
    } catch (e) {
      if (chunk.length === 1) {
        console.error(`Import failed for row ${chunk[0].rowIndex}:`, e);
        return 0;
      }
      console.warn(`Batch of ${chunk.length} failed, splitting and retrying:`, e);
      const mid = Math.ceil(chunk.length / 2);
      const [aOk, bOk] = await Promise.all([
        commitChunk(chunk.slice(0, mid)),
        commitChunk(chunk.slice(mid)),
      ]);
      return aOk + bOk;
    }
  }

  let done = 0;
  for (let i = 0; i < writable.length; i += BATCH_CHUNK_SIZE) {
    const chunk = writable.slice(i, i + BATCH_CHUNK_SIZE);
    const ok = await commitChunk(chunk);
    summary.imported += ok;
    summary.failed += chunk.length - ok;
    done += chunk.length;
    onProgress?.(done, writable.length);
  }

  return summary;
}

export function requiredFieldsMapped(mapping: Partial<Record<ImportFieldKey, string>>, scope: ImportScope): boolean {
  const required = scope === 'singleClass'
    ? IMPORT_REQUIRED_FIELDS.filter(f => f !== 'classCode')
    : IMPORT_REQUIRED_FIELDS;
  return required.every(f => !!mapping[f]);
}
