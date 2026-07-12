import { useMemo, useRef, useState } from 'react';
import {
  ClassStructure, Student, ImportFieldKey, ImportRow,
  IMPORT_REQUIRED_FIELDS, IMPORT_OPTIONAL_FIELDS, IMPORT_FIELD_LABELS, ImportSummary,
} from '../types';
import {
  parseImportFile, ParsedSheet, autoDetectMapping, getSavedMapping, saveMapping,
  resetSavedMapping, buildRows, validateRows, executeImport, requiredFieldsMapped,
} from '../services/importService';

type Step = 1 | 2 | 3;

interface Props {
  schoolId: string;
  classStructure: ClassStructure | null;
  activeAcademicYearId: string | null;
  existingStudents: Student[];
  onClose: () => void;
  /** Called once the import finishes, with a summary the caller can toast, and a signal to refresh the roster. */
  onImported: (summary: ImportSummary) => void;
}

const ALL_FIELDS: ImportFieldKey[] = [...IMPORT_REQUIRED_FIELDS, ...IMPORT_OPTIONAL_FIELDS];

export default function StudentImportWizard({
  schoolId, classStructure, activeAcademicYearId, existingStudents, onClose, onImported,
}: Props) {
  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step 1
  const [parsed, setParsed] = useState<ParsedSheet | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Step 2
  const [mapping, setMapping] = useState<Partial<Record<ImportFieldKey, string>>>({});
  const [hadSavedMapping, setHadSavedMapping] = useState(false);

  // Step 3
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  async function handleFile(file: File) {
    setError('');
    setBusy(true);
    try {
      const result = await parseImportFile(file);
      if (result.rows.length === 0) throw new Error('No data rows found in that file.');
      setParsed(result);

      const saved = await getSavedMapping(schoolId).catch(() => null);
      const auto = autoDetectMapping(result.columns);
      if (saved && Object.keys(saved.mapping).length > 0) {
        // Prefer the saved mapping, but only for columns that still exist in this file.
        const merged: Partial<Record<ImportFieldKey, string>> = {};
        (Object.keys(saved.mapping) as ImportFieldKey[]).forEach(f => {
          const col = saved.mapping[f];
          if (col && result.columns.includes(col)) merged[f] = col;
        });
        ALL_FIELDS.forEach(f => { if (!merged[f] && auto[f]) merged[f] = auto[f]; });
        setMapping(merged);
        setHadSavedMapping(true);
      } else {
        setMapping(auto);
        setHadSavedMapping(false);
      }
      setStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to parse file.');
    } finally {
      setBusy(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  }

  function resetMappingToAuto() {
    if (!parsed) return;
    setMapping(autoDetectMapping(parsed.columns));
    setHadSavedMapping(false);
  }

  async function forgetSavedMapping() {
    setBusy(true);
    try {
      await resetSavedMapping(schoolId);
      resetMappingToAuto();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reset saved mapping.');
    } finally {
      setBusy(false);
    }
  }

  async function goToPreview() {
    if (!parsed) return;
    setError('');
    if (!requiredFieldsMapped(mapping)) {
      setError('Please map all required fields before continuing.');
      return;
    }
    setBusy(true);
    try {
      await saveMapping(schoolId, mapping).catch(() => {}); // best-effort; not blocking
      const built = buildRows(parsed, mapping);
      const validated = validateRows(built, {
        classStructure, existingStudents, activeAcademicYearId,
      });
      setRows(validated);
      setStep(3);
    } finally {
      setBusy(false);
    }
  }

  function revalidate(next: ImportRow[]) {
    return validateRows(next.map(r => ({ ...r, issues: [], isValid: true })), {
      classStructure, existingStudents, activeAcademicYearId,
    });
  }

  function updateCell(rowIndex: number, field: ImportFieldKey, value: string) {
    setRows(prev => {
      const next = prev.map(r => r.rowIndex === rowIndex ? { ...r, values: { ...r.values, [field]: value } } : r);
      return revalidate(next);
    });
  }

  function toggleExclude(rowIndex: number) {
    setRows(prev => prev.map(r => r.rowIndex === rowIndex ? { ...r, excluded: !r.excluded } : r));
  }

  const stats = useMemo(() => {
    const included = rows.filter(r => !r.excluded);
    return {
      total: rows.length,
      valid: included.filter(r => r.isValid).length,
      invalid: included.filter(r => !r.isValid).length,
      excluded: rows.filter(r => r.excluded).length,
    };
  }, [rows]);

  async function runImport() {
    if (!activeAcademicYearId) { setError('No active academic year is set for this school.'); return; }
    setBusy(true);
    setError('');
    try {
      const result = await executeImport({
        schoolId, activeAcademicYearId, rows,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      setSummary(result);
      onImported(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay open" onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal" style={{ maxWidth: 920, width: '95vw' }}>
        <div className="modal-header">
          <span className="modal-title">Import Students</span>
          {!busy && <button className="modal-close" onClick={onClose}>✕</button>}
        </div>

        {/* Step indicator */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          {(['Upload', 'Map Columns', 'Preview & Import'] as const).map((label, i) => {
            const n = (i + 1) as Step;
            const active = step === n;
            const done = step > n;
            return (
              <div key={label} style={{
                flex: 1, textAlign: 'center', padding: '8px 6px', borderRadius: 8,
                fontSize: 12, fontWeight: 700,
                background: active ? 'rgba(44,111,173,.1)' : done ? 'rgba(0,200,150,.08)' : 'var(--surface-2)',
                color: active ? 'var(--blue)' : done ? 'var(--mint-d)' : 'var(--text-3)',
                border: `1px solid ${active ? 'rgba(44,111,173,.3)' : done ? 'rgba(0,200,150,.25)' : 'var(--border)'}`,
              }}>
                {done ? '✓ ' : `${n}. `}{label}
              </div>
            );
          })}
        </div>

        {error && <div className="notice notice-locked">⚠️ {error}</div>}

        {/* ── STEP 1: Upload ── */}
        {step === 1 && (
          <div>
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: `2px dashed ${dragOver ? 'var(--blue)' : 'var(--border)'}`,
                borderRadius: 12, padding: '48px 24px', textAlign: 'center', cursor: 'pointer',
                background: dragOver ? 'rgba(44,111,173,.05)' : 'var(--surface-2)',
              }}
            >
              <div style={{ fontSize: 32, marginBottom: 8 }}>📁</div>
              <div style={{ fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>
                {busy ? 'Reading file…' : 'Click to upload or drag a file here'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Supports CSV, XLS, and XLSX — large rosters are fine</div>
              <input
                ref={fileInputRef} type="file" accept=".csv,.xls,.xlsx" style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
            </div>
            {parsed && (
              <div style={{ marginTop: 16, fontSize: 13, color: 'var(--text-2)' }}>
                Loaded <strong>{parsed.fileName}</strong> — worksheet "{parsed.sheetName}", {parsed.rowCount} rows, {parsed.columns.length} columns detected.
              </div>
            )}
          </div>
        )}

        {/* ── STEP 2: Column mapping ── */}
        {step === 2 && parsed && (
          <div>
            <div className="notice notice-info">
              Detected worksheet "<strong>{parsed.sheetName}</strong>" · {parsed.rowCount} rows · {parsed.columns.length} columns.
              {hadSavedMapping && ' Using your saved mapping from a previous import.'}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {ALL_FIELDS.map(field => {
                const required = IMPORT_REQUIRED_FIELDS.includes(field);
                return (
                  <div className="form-group" key={field} style={{ margin: 0 }}>
                    <label className="form-label">
                      {IMPORT_FIELD_LABELS[field]} {required && <span style={{ color: 'var(--red)' }}>*</span>}
                    </label>
                    <select
                      className="form-input"
                      value={mapping[field] || ''}
                      onChange={e => setMapping(prev => ({ ...prev, [field]: e.target.value || undefined }))}
                    >
                      <option value="">— not mapped —</option>
                      {parsed.columns.map(col => <option key={col} value={col}>{col}</option>)}
                    </select>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 20, display: 'flex', gap: 12, justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', gap: 12 }}>
                <button className="btn-secondary" onClick={resetMappingToAuto}>↺ Reset to auto-detect</button>
                {hadSavedMapping && (
                  <button className="btn-secondary" onClick={forgetSavedMapping}>🗑 Forget saved mapping</button>
                )}
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <button className="btn-secondary" onClick={() => setStep(1)}>Back</button>
                <button className="btn-primary" disabled={busy} onClick={goToPreview}>Continue to Preview →</button>
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 3: Preview & import ── */}
        {step === 3 && (
          <div>
            {!summary ? (
              <>
                <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                  <span className="btn-xs btn-xs-mint">{stats.valid} ready</span>
                  <span className="btn-xs btn-xs-red">{stats.invalid} need fixing</span>
                  {stats.excluded > 0 && <span className="btn-xs btn-xs-gray">{stats.excluded} excluded</span>}
                </div>
                <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        {ALL_FIELDS.filter(f => mapping[f]).map(f => <th key={f}>{IMPORT_FIELD_LABELS[f]}</th>)}
                        <th>Issues</th>
                        <th>Skip</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(row => (
                        <tr key={row.rowIndex} style={{ opacity: row.excluded ? 0.45 : 1, background: !row.isValid && !row.excluded ? 'rgba(232,69,69,.05)' : undefined }}>
                          <td style={{ color: 'var(--text-3)' }}>{row.rowIndex}</td>
                          {ALL_FIELDS.filter(f => mapping[f]).map(field => {
                            const fieldIssue = row.issues.find(i => i.field === field);
                            return (
                              <td key={field}>
                                <input
                                  className="form-input"
                                  style={{
                                    padding: '4px 8px', fontSize: 12, minWidth: 110,
                                    borderColor: fieldIssue ? 'var(--red)' : undefined,
                                  }}
                                  value={row.values[field] || ''}
                                  disabled={row.excluded}
                                  onChange={e => updateCell(row.rowIndex, field, e.target.value)}
                                />
                              </td>
                            );
                          })}
                          <td style={{ fontSize: 11, color: 'var(--red)', maxWidth: 220 }}>
                            {row.issues.map((iss, idx) => <div key={idx}>{iss.message}</div>)}
                          </td>
                          <td>
                            <button className="btn-xs btn-xs-gray" onClick={() => toggleExclude(row.rowIndex)}>
                              {row.excluded ? 'Include' : 'Exclude'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ marginTop: 20, display: 'flex', gap: 12, justifyContent: 'space-between', alignItems: 'center' }}>
                  <button className="btn-secondary" disabled={busy} onClick={() => setStep(2)}>Back</button>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    {progress && <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Importing {progress.done}/{progress.total}…</span>}
                    <button className="btn-primary" disabled={busy || stats.valid === 0} onClick={runImport}>
                      {busy ? 'Importing…' : `Import ${stats.valid} Student${stats.valid !== 1 ? 's' : ''}`}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div>
                <div className="notice notice-info" style={{ fontSize: 14 }}>
                  <div style={{ fontWeight: 800, marginBottom: 8 }}>Import complete</div>
                  <div>✅ {summary.imported} Imported</div>
                  <div>⏭️ {summary.skipped} Skipped</div>
                  <div>♻️ {summary.duplicate} Duplicate</div>
                  <div>🚫 {summary.missingAdmissionNo} Missing Admission Number</div>
                  {summary.failed > 0 && <div>❌ {summary.failed} Failed (network/permission error)</div>}
                </div>
                <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
                  <button className="btn-primary" onClick={onClose}>Done</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
