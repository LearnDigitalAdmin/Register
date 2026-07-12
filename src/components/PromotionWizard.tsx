import { useState } from 'react';
import { ClassStructure } from '../types';
import { getClassStructure } from '../services/academicYearService';
import {
  applyPromotion, buildPromotionPreview, PromotionAction, PromotionEntry, PromotionPreview,
} from '../services/promotionService';

type Step = 'setup' | 'preview' | 'applying' | 'done' | 'error';

export default function PromotionWizard({
  schoolId, onClose, onApplied,
}: {
  schoolId: string;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [step, setStep]           = useState<Step>('setup');
  const [yearLabel, setYearLabel] = useState(String(new Date().getFullYear() + 1));
  const [preview, setPreview]     = useState<PromotionPreview | null>(null);
  const [structure, setStructure] = useState<ClassStructure | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [error, setError]         = useState('');

  async function loadPreview() {
    setError('');
    setStep('applying');
    try {
      const [p, s] = await Promise.all([
        buildPromotionPreview(schoolId, yearLabel.trim()),
        getClassStructure(schoolId),
      ]);
      setPreview(p);
      setStructure(s);
      setStep('preview');
    } catch (e: any) {
      setError(e.message || 'Could not build promotion preview.');
      setStep('setup');
    }
  }

  function updateEntry(studentId: string, patch: Partial<PromotionEntry>) {
    setPreview(prev => prev ? {
      ...prev,
      entries: prev.entries.map(e => e.studentId === studentId ? { ...e, ...patch } : e),
    } : prev);
  }

  async function confirmApply() {
    if (!preview) return;
    setStep('applying');
    setError('');
    try {
      await applyPromotion(preview);
      setStep('done');
    } catch (e: any) {
      setError(e.message || 'Promotion failed.');
      setStep('error');
    }
  }

  const graduateCount = preview?.entries.filter(e => e.action === 'graduate').length ?? 0;
  const repeatCount   = preview?.entries.filter(e => e.action === 'repeat').length ?? 0;
  const transferCount = preview?.entries.filter(e => e.action === 'transfer').length ?? 0;
  const promoteCount  = preview?.entries.filter(e => e.action === 'promote' || e.action === 'keep').length ?? 0;

  return (
    <div className="modal-overlay open" onClick={e => { if (e.target === e.currentTarget && step !== 'applying') onClose(); }}>
      <div className="modal" style={{ maxWidth: 720, width: '95vw' }}>
        <div className="modal-header">
          <span className="modal-title">Promote to New Academic Year</span>
          {step !== 'applying' && <button className="modal-close" onClick={onClose}>✕</button>}
        </div>

        {step === 'setup' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>
              This creates a new academic year and, once you confirm, moves every active student
              up one class level. Graduating-class students are archived, not deleted. Nothing is
              applied until you review and confirm the summary on the next step.
            </p>
            <div className="form-group">
              <label className="form-label">New Academic Year Label</label>
              <input className="form-input" value={yearLabel} onChange={e => setYearLabel(e.target.value)} placeholder="2027" />
            </div>
            {error && <div className="error-msg">{error}</div>}
            <button className="btn-primary" onClick={loadPreview} disabled={!yearLabel.trim()} style={{ justifyContent: 'center' }}>
              Preview Promotion →
            </button>
          </div>
        )}

        {(step === 'preview' || step === 'applying') && preview && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
              {[
                ['Promoted', promoteCount, 'var(--mint-d)'],
                ['Repeating', repeatCount, '#c4800a'],
                ['Transferred', transferCount, 'var(--text-2)'],
                ['Graduating', graduateCount, 'var(--blue)'],
              ].map(([label, val, color]) => (
                <div key={label as string} style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: color as string }}>{val}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: .5 }}>{label}</div>
                </div>
              ))}
            </div>

            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 8 }}>
                Class Summary — {preview.fromYearId.split('_').pop()} → {preview.toYearLabel}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160, overflowY: 'auto' }}>
                {preview.classSummary.map((row, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '6px 10px', background: 'var(--surface-2)', borderRadius: 6 }}>
                    <span>{row.fromClass} → {row.toClass ?? '🎓 Graduates'}</span>
                    <strong>{row.count} student{row.count !== 1 ? 's' : ''}</strong>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', marginBottom: manualMode ? 10 : 0 }}>
                <input type="checkbox" checked={manualMode} onChange={e => setManualMode(e.target.checked)} disabled={step === 'applying'} />
                Manually review/edit individual students (repeaters, transfers, class overrides)
              </label>

              {manualMode && structure && (
                <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
                  <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                    <thead style={{ position: 'sticky', top: 0, background: 'var(--surface-2)' }}>
                      <tr>
                        <th style={{ textAlign: 'left', padding: 8 }}>Student</th>
                        <th style={{ textAlign: 'left', padding: 8 }}>From</th>
                        <th style={{ textAlign: 'left', padding: 8 }}>Action</th>
                        <th style={{ textAlign: 'left', padding: 8 }}>To</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.entries.map(e => (
                        <tr key={e.studentId} style={{ borderTop: '1px solid var(--border)' }}>
                          <td style={{ padding: 8 }}>{e.studentName}<div style={{ color: 'var(--text-3)', fontSize: 10 }}>{e.admissionNo}</div></td>
                          <td style={{ padding: 8 }}>{e.fromClass}</td>
                          <td style={{ padding: 8 }}>
                            <select
                              value={e.action}
                              disabled={step === 'applying'}
                              onChange={ev => {
                                const action = ev.target.value as PromotionAction;
                                const toClass = action === 'graduate' || action === 'transfer' ? null
                                  : action === 'repeat' || action === 'keep' ? e.fromClass
                                  : e.toClass;
                                updateEntry(e.studentId, { action, toClass });
                              }}
                            >
                              <option value="promote">Promote</option>
                              <option value="repeat">Repeat</option>
                              <option value="keep">Keep class</option>
                              <option value="transfer">Transfer out</option>
                              <option value="graduate">Graduate</option>
                            </select>
                          </td>
                          <td style={{ padding: 8 }}>
                            {(e.action === 'promote' || e.action === 'keep') ? (
                              <select value={e.toClass || ''} disabled={step === 'applying'} onChange={ev => updateEntry(e.studentId, { toClass: ev.target.value })}>
                                {structure.classes.map(c => <option key={c} value={c}>{c}</option>)}
                              </select>
                            ) : e.action === 'repeat' ? e.fromClass : e.toClass ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {error && <div className="error-msg">{error}</div>}

            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={confirmChecked} onChange={e => setConfirmChecked(e.target.checked)} disabled={step === 'applying'} style={{ marginTop: 3 }} />
              I understand this permanently promotes/graduates the students above and cannot be undone.
            </label>

            <div style={{ display: 'flex', gap: 12 }}>
              <button className="btn-primary" onClick={confirmApply} disabled={!confirmChecked || step === 'applying'} style={{ flex: 1, justifyContent: 'center' }}>
                {step === 'applying' ? 'Applying…' : `Confirm & Promote ${preview.entries.length} Students`}
              </button>
              <button className="btn-secondary" onClick={() => setStep('setup')} disabled={step === 'applying'}>Back</button>
            </div>
          </div>
        )}

        {step === 'done' && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>🎉</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Promotion applied</div>
            <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 20 }}>
              {preview?.toYearLabel} is now the active academic year.
            </div>
            <button className="btn-primary" onClick={onApplied}>Done</button>
          </div>
        )}

        {step === 'error' && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>⚠️</div>
            <div style={{ fontSize: 14, color: 'var(--red, #e84545)', marginBottom: 20 }}>{error}</div>
            <button className="btn-secondary" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}
