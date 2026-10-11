import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { doc, getDoc, setDoc, writeBatch, collection } from 'firebase/firestore';
import { db } from '../firebase';
import {
  ImportFieldKey, ImportColumnMapping, ImportRow, ImportScope, ImportSummary,
  IMPORT_REQUIRED_FIELDS,
} from '../types';
import {
  autoDetectMapping, buildStudentWrite, rowsFromRecords, validateRows,
} from '../shared/importValidation';
import type { ValidationContext } from '../shared/importValidation';

// Column auto-detection, row building, validation and the student/enrolment documents are implemented in
// `src/shared/importValidation.ts` (shared byte-for-byte with Cloud Functions, so the Samuhia Desk delegate
// applies the same rules). Re-exported so existing imports from this module keep working.
export { autoDetectMapping, validateRows };
export type { ValidationContext };

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

// ─── Row building ──────────────────────────────────────────────────────────

export function buildRows(
  parsed: ParsedSheet,
  mapping: Partial<Record<ImportFieldKey, string>>,
): ImportRow[] {
  return rowsFromRecords(parsed.rows, mapping);
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
        const studentRef = doc(collection(db, 'students'));
        const write = buildStudentWrite(row, {
          schoolId, academicYearId: activeAcademicYearId, studentId: studentRef.id, now: new Date().toISOString(),
        });
        batch.set(studentRef, write.student);
        batch.set(doc(db, 'enrolments', write.enrolmentId), write.enrolment);
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
