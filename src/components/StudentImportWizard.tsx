import { useMemo, useRef, useState } from 'react';
import {
  ClassStructure, Student, ImportFieldKey, ImportRow, ImportScope,
  IMPORT_REQUIRED_FIELDS, IMPORT_OPTIONAL_FIELDS, IMPORT_FIELD_LABELS, ImportSummary,
} from '../types';
import {
  parseImportFile, ParsedSheet, autoDetectMapping, getSavedMapping, saveMapping,
  resetSavedMapping, buildRows, validateRows, executeImport, requiredFieldsMapped,
  addCustomAlias, removeCustomAlias,
} from '../services/importService';

type Step = 0 | 1 | 2 | 3;

interface Props {
  schoolId: string;
  classStructure: ClassStructure | null;
  activeAcademicYearId: string | null;
  existingStudents: Student[];
  /** Classes this user may import into. Admins get the full school list (and can therefore
   * also choose "whole school"); teachers only get their own assigned classes. */
  availableClasses: string[];
  /** Whole-school imports (extracting class/stream from the file) are only offered to admins —
   * a class-restricted teacher can only ever import into one of their own classes. */
  canImportWholeSchool: boolean;
  onClose: () => void;
  /** Called once the import finishes, with a summary the caller can toast, and a signal to refresh the roster. */
  onImported: (summary: ImportSummary) => void;
}

const ALL_FIELDS: ImportFieldKey[] = [...IMPORT_REQUIRED_FIELDS, ...IMPORT_OPTIONAL_FIELDS];

export default function StudentImportWizard({
  schoolId, classStructure, activeAcademicYearId, existingStudents,
  availableClasses, canImportWholeSchool, onClose, onImported,
}: Props) {
  const [step, setStep] = useState<Step>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step 0 — scope: which class(es) this import may touch.
  // Single-class is the safe default: it can never scatter students into the wrong class.
  const [scope, setScope] = useState<ImportScope>('singleClass');
  const [targetClassCode, setTargetClassCode] = useState<string>(availableClasses[0] || '');

  // Step 1
  const [parsed, setParsed] = useState<ParsedSheet | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // Step 2
  const [mapping, setMapping] = useState<Partial<Record<ImportFieldKey, string>>>({});
  const [hadSavedMapping, setHadSavedMapping] = useState(false);
  // School's persisted field-alias library (e.g. "admin nos" -> admissionNo), separate from
  // the one-shot "last exact column mapping" cache. Loaded once the file is parsed.
  const [customAliases, setCustomAliases] = useState<Partial<Record<ImportFieldKey, string[]>>>({});
  const [showFieldLibrary, setShowFieldLibrary] = useState(false);
  const [newAliasField, setNewAliasField] = useState<ImportFieldKey>('admissionNo');
  const [newAliasText, setNewAliasText] = useState('');

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
      const aliases = saved?.customFieldAliases || {};
      setCustomAliases(aliases);
      const auto = autoDetectMapping(result.columns, aliases);
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
    setMapping(autoDetectMapping(parsed.columns, customAliases));
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

  /** Teaches the school's field library the column header currently mapped to `field`, so a
   * future file with a different exact header but the same wording still auto-detects. */
  async function teachAliasFromMapping(field: ImportFieldKey) {
    const col = mapping[field];
    if (!col) return;
    setBusy(true);
    try {
      const next = await addCustomAlias(schoolId, field, col);
      setCustomAliases(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save this label to the field library.');
    } finally {
      setBusy(false);
    }
  }

  /** Adds a manually-typed phrase (not necessarily a column in this file) to the field library —
   * covers the "this school always calls it X" case even before a file using that spelling shows up. */
  async function addManualAlias() {
    if (!newAliasText.trim()) return;
    setBusy(true);
    try {
      const next = await addCustomAlias(schoolId, newAliasField, newAliasText);
      setCustomAliases(next);
      setNewAliasText('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save this alias.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteAlias(field: ImportFieldKey, alias: string) {
    setBusy(true);
    try {
      const next = await removeCustomAlias(schoolId, field, alias);
      setCustomAliases(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove this alias.');
    } finally {
      setBusy(false);
    }
  }

  async function goToPreview() {
    if (!parsed) return;
    setError('');
    if (scope === 'singleClass' && !targetClassCode) {
      setError('Please choose which class this import is for.');
      return;
    }
    if (!requiredFieldsMapped(mapping, scope)) {
      setError('Please map all required fields before continuing.');
      return;
    }
    setBusy(true);
    try {
      await saveMapping(schoolId, mapping).catch(() => {}); // best-effort; not blocking
      const built = buildRows(parsed, mapping);
      const validated = validateRows(built, {
        classStructure, existingStudents, activeAcademicYearId, scope, targetClassCode,
      });
      setRows(validated);
      setStep(3);
    } finally {
      setBusy(false);
    }
  }

  function revalidate(next: ImportRow[]) {
    return validateRows(next.map(r => ({ ...r, issues: [], isValid: true })), {
      classStructure, existingStudents, activeAcademicYearId, scope, targetClassCode,
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
          {(['Scope', 'Upload', 'Map Columns', 'Preview & Import'] as const).map((label, i) => {
            const n = i as Step;
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
                {done ? '✓ ' : `${n + 1}. `}{label}
              </div>
            );
          })}
        </div>

        {error && <div className="notice notice-locked">⚠️ {error}</div>}

        {/* ── STEP 0: Scope ── */}
        {step === 0 && (
          <div>
            <div className="notice notice-info">
              Choose what this import is allowed to touch. <strong>Single class</strong> is the
              safer default — every row lands in the one class you pick below, and any class or
              stream column in the file is ignored completely.
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
              <label style={{
                flex: 1, padding: 16, borderRadius: 10, cursor: 'pointer',
                border: `2px solid ${scope === 'singleClass' ? 'var(--blue)' : 'var(--border)'}`,
                background: scope === 'singleClass' ? 'rgba(44,111,173,.06)' : 'var(--surface-2)',
              }}>
                <input
                  type="radio" name="importScope" style={{ marginRight: 8 }}
                  checked={scope === 'singleClass'}
                  onChange={() => setScope('singleClass')}
                />
                <strong>Single class</strong>
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 6 }}>
                  Import into one class you choose now. Recommended for a normal class roster upload.
                </div>
              </label>
              <label style={{
                flex: 1, padding: 16, borderRadius: 10,
                cursor: canImportWholeSchool ? 'pointer' : 'not-allowed',
                opacity: canImportWholeSchool ? 1 : 0.5,
                border: `2px solid ${scope === 'wholeSchool' ? 'var(--blue)' : 'var(--border)'}`,
                background: scope === 'wholeSchool' ? 'rgba(44,111,173,.06)' : 'var(--surface-2)',
              }}>
                <input
                  type="radio" name="importScope" style={{ marginRight: 8 }}
                  checked={scope === 'wholeSchool'} disabled={!canImportWholeSchool}
                  onChange={() => setScope('wholeSchool')}
                />
                <strong>Whole school</strong>
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 6 }}>
                  {canImportWholeSchool
                    ? 'Reads class/stream from the file and places each student automatically. Requires clear class data in the file.'
                    : 'Only a school admin can run a whole-school import.'}
                </div>
              </label>
            </div>
            {scope === 'singleClass' && (
              <div className="form-group" style={{ marginTop: 16 }}>
                <label className="form-label">Import into class *</label>
                <select
                  className="form-input" value={targetClassCode}
                  onChange={e => setTargetClassCode(e.target.value)}
                >
                  <option value="">— choose a class —</option>
                  {availableClasses.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}
            <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
              <button
                className="btn-primary"
                disabled={scope === 'singleClass' && !targetClassCode}
                onClick={() => setStep(1)}
              >
                Continue →
              </button>
            </div>
          </div>
        )}

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
            <div style={{ marginTop: 20 }}>
              <button className="btn-secondary" disabled={busy} onClick={() => setStep(0)}>Back</button>
            </div>
          </div>
        )}

        {/* ── STEP 2: Column mapping ── */}
        {step === 2 && parsed && (
          <div>
            <div className="notice notice-info">
              Detected worksheet "<strong>{parsed.sheetName}</strong>" · {parsed.rowCount} rows · {parsed.columns.length} columns.
              {hadSavedMapping && ' Using your saved mapping from a previous import.'}
              {scope === 'singleClass' && ` Importing into "${targetClassCode}" — any class/stream column is ignored.`}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {ALL_FIELDS
                .filter(field => !(scope === 'singleClass' && (field === 'classCode' || field === 'streamCode')))
                .map(field => {
                const required = IMPORT_REQUIRED_FIELDS.includes(field);
                return (
                  <div className="form-group" key={field} style={{ margin: 0 }}>
                    <label className="form-label">
                      {IMPORT_FIELD_LABELS[field]} {required && <span style={{ color: 'var(--red)' }}>*</span>}
                    </label>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <select
                        className="form-input"
                        value={mapping[field] || ''}
                        onChange={e => setMapping(prev => ({ ...prev, [field]: e.target.value || undefined }))}
                      >
                        <option value="">— not mapped —</option>
                        {parsed.columns.map(col => <option key={col} value={col}>{col}</option>)}
                      </select>
                      {mapping[field] && (
                        <button
                          type="button" className="btn-xs btn-xs-gray" disabled={busy}
                          title={`Remember "${mapping[field]}" as a label for ${IMPORT_FIELD_LABELS[field]} in future imports`}
                          onClick={() => teachAliasFromMapping(field)}
                        >
                          + Remember
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: 16 }}>
              <button className="btn-secondary" onClick={() => setShowFieldLibrary(v => !v)}>
                {showFieldLibrary ? '▾' : '▸'} Field library {Object.values(customAliases).some(a => a && a.length > 0) ? `(${Object.values(customAliases).reduce((n, a) => n + (a?.length || 0), 0)} saved)` : ''}
              </button>
              {showFieldLibrary && (
                <div style={{ marginTop: 10, padding: 14, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-2)' }}>
                  <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 10 }}>
                    Labels this school has taught the importer, in addition to the built-in library.
                    They apply automatically to every future import, even in a differently-named file.
                  </div>
                  {ALL_FIELDS.map(field => {
                    const aliases = customAliases[field] || [];
                    if (aliases.length === 0) return null;
                    return (
                      <div key={field} style={{ marginBottom: 8 }}>
                        <strong style={{ fontSize: 12 }}>{IMPORT_FIELD_LABELS[field]}:</strong>{' '}
                        {aliases.map(a => (
                          <span key={a} className="btn-xs btn-xs-gray" style={{ marginRight: 6, marginBottom: 4, display: 'inline-block' }}>
                            {a} <button type="button" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--red)' }} onClick={() => deleteAlias(field, a)}>✕</button>
                          </span>
                        ))}
                      </div>
                    );
                  })}
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
                    <select className="form-input" style={{ maxWidth: 220 }} value={newAliasField} onChange={e => setNewAliasField(e.target.value as ImportFieldKey)}>
                      {ALL_FIELDS.map(f => <option key={f} value={f}>{IMPORT_FIELD_LABELS[f]}</option>)}
                    </select>
                    <input
                      className="form-input" placeholder='e.g. "admin nos"' value={newAliasText}
                      onChange={e => setNewAliasText(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') addManualAlias(); }}
                    />
                    <button className="btn-secondary" disabled={busy || !newAliasText.trim()} onClick={addManualAlias}>+ Add</button>
                  </div>
                </div>
              )}
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
                        <th>Class</th>
                        {ALL_FIELDS.filter(f => mapping[f]).map(f => <th key={f}>{IMPORT_FIELD_LABELS[f]}</th>)}
                        <th>Issues</th>
                        <th>Skip</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(row => (
                        <tr key={row.rowIndex} style={{ opacity: row.excluded ? 0.45 : 1, background: !row.isValid && !row.excluded ? 'rgba(232,69,69,.05)' : undefined }}>
                          <td style={{ color: 'var(--text-3)' }}>{row.rowIndex}</td>
                          <td style={{ fontSize: 12, fontWeight: row.resolvedClassCode ? 700 : 400, color: row.resolvedClassCode ? 'var(--ink)' : 'var(--red)' }}>
                            {row.resolvedClassCode || '—'}
                          </td>
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
