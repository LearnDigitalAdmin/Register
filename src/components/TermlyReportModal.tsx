/**
 * src/components/reports/TermlyReportModal.tsx
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { TermlyClassSummary, rateColor, TermlyReport, generateTermlyReport, exportTermlyCsv, fmtDate, rateTag } from '../services/reportsService';


// ─── Term date presets ────────────────────────────────────────────────────────

interface TermPreset {
  label: string;
  start: string;
  end:   string;
}

function buildTermPresets(year: number): TermPreset[] {
  const y = String(year);
  return [
    { label: `Term 1 ${y}`, start: `${y}-01-06`, end: `${y}-04-11` },
    { label: `Term 2 ${y}`, start: `${y}-04-28`, end: `${y}-07-25` },
    { label: `Term 3 ${y}`, start: `${y}-09-01`, end: `${y}-11-07` },
  ];
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  isOpen:     boolean;
  onClose:    () => void;
  schoolId:   string;
  schoolName: string;
  academicYearId?: string;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MiniBar({ rate, color }: { rate: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden', minWidth: 40 }}>
        <div style={{ width: `${rate}%`, height: '100%', background: color, borderRadius: 3, transition: 'width .4s ease' }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color, width: 38, textAlign: 'right', flexShrink: 0 }}>
        {rate}%
      </span>
    </div>
  );
}

function ClassBlock({ cls, defaultOpen }: { cls: TermlyClassSummary; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);

  // Sync when parent toggles expandAll
  useEffect(() => { setOpen(defaultOpen); }, [defaultOpen]);

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginBottom: 12 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px', background: 'var(--surface-2)',
          border: 'none', cursor: 'pointer', fontFamily: "'Sora', sans-serif", gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 0 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8,
            background: 'rgba(0,200,150,.1)', border: '1px solid rgba(0,200,150,.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0,
          }}>📋</div>
          <div style={{ textAlign: 'left', minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)' }}>{cls.classCode}</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
              {cls.students.length} students · {cls.totalDays} school days
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexShrink: 0 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: rateColor(cls.avgRate) }}>{cls.avgRate}%</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>avg rate</div>
          </div>
          <span style={{
            fontSize: 18, color: 'var(--text-3)',
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform .2s', display: 'block',
          }}>▾</span>
        </div>
      </button>

      {open && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['#', 'Student Name', 'Adm. No.', 'Days', 'P', 'A', 'L', 'E', 'Rate'].map(h => (
                  <th key={h} style={{
                    padding: '8px 12px', fontSize: 10, fontWeight: 700,
                    color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: .5,
                    background: 'var(--surface-2)', borderBottom: '1px solid var(--border)',
                    textAlign: 'left', whiteSpace: 'nowrap',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cls.students.map((s, i) => (
                <tr key={s.studentId} style={{ background: i % 2 === 0 ? 'var(--surface)' : 'rgba(0,0,0,.015)' }}>
                  <td style={{ padding: '9px 12px', fontSize: 12, color: 'var(--text-3)' }}>{i + 1}</td>
                  <td style={{ padding: '9px 12px', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                    {s.rate < 80 && <span title="Chronic absentee" style={{ marginRight: 5 }}>⚠️</span>}
                    {s.studentName}
                  </td>
                  <td style={{ padding: '9px 12px', fontSize: 12, fontFamily: "'DM Mono',monospace", color: 'var(--text-2)' }}>{s.admissionNo}</td>
                  <td style={{ padding: '9px 12px', fontSize: 12, color: 'var(--text-2)' }}>{s.totalDays}</td>
                  <td style={{ padding: '9px 12px', fontSize: 12, fontWeight: 700, color: 'var(--mint-d)' }}>{s.present}</td>
                  <td style={{ padding: '9px 12px', fontSize: 12, fontWeight: 700, color: 'var(--red)' }}>{s.absent}</td>
                  <td style={{ padding: '9px 12px', fontSize: 12, fontWeight: 700, color: 'var(--gold)' }}>{s.late}</td>
                  <td style={{ padding: '9px 12px', fontSize: 12, fontWeight: 700, color: 'var(--blue)' }}>{s.excused}</td>
                  <td style={{ padding: '9px 12px', minWidth: 130 }}>
                    <MiniBar rate={s.rate} color={rateColor(s.rate)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────

export default function TermlyReportModal({ isOpen, onClose, schoolId, schoolName, academicYearId }: Props) {
  const currentYear = new Date().getFullYear();
  const years       = [currentYear, currentYear - 1];

  const [year,      setYear]      = useState(currentYear);
  const [termIdx,   setTermIdx]   = useState(0);
  const [report,    setReport]    = useState<TermlyReport | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');
  const [activeTab, setActiveTab] = useState<'classes' | 'absentees'>('classes');
  const [expandAll, setExpandAll] = useState(false);

  // ── Keep a ref to the current preset so fetchReport never needs it as a dep ──
  const presets   = buildTermPresets(year);
  const preset    = presets[termIdx];
  const presetRef = useRef(preset);
  presetRef.current = preset;               // always up-to-date, never triggers effects

  const schoolIdRef   = useRef(schoolId);
  schoolIdRef.current = schoolId;
  const schoolNameRef = useRef(schoolName);
  schoolNameRef.current = schoolName;

  // ── fetchReport reads everything from refs — zero reactive deps ────────────
  const fetchReport = useCallback(async () => {
    const { start, end, label } = presetRef.current;
    const sid  = schoolIdRef.current;
    const sname = schoolNameRef.current;
    if (!sid) return;
    setLoading(true);
    setError('');
    try {
      const r = await generateTermlyReport(sid, sname, start, end, label, 80, academicYearId);
      setReport(r);
    } catch (e: any) {
      setError(e.message || 'Failed to generate report.');
    } finally {
      setLoading(false);
    }
  }, []); // ← empty deps: function identity is stable for the component's lifetime

  // ── Fire once when the modal opens ────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) {
      setReport(null);
      setError('');
      return;
    }
    fetchReport();
  }, [isOpen]); // ← only isOpen; fetchReport is stable so safe to omit

  // ── Re-fetch when year or term changes (explicit user action) ─────────────
  useEffect(() => {
    if (!isOpen) return;
    fetchReport();
  }, [year, termIdx]); // ← primitive values — stable, no object-identity issues

  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay open"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ alignItems: 'flex-start', paddingTop: 40 }}
    >
      <div className="modal" style={{ maxWidth: 860, width: '95vw', maxHeight: '90vh', overflowY: 'auto', borderRadius: 20 }}>

        {/* Header */}
        <div className="modal-header" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div className="modal-title">📊 Termly Attendance Report</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 3 }}>{schoolName}</div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Controls */}
        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 20,
          padding: '14px 16px', background: 'var(--surface-2)',
          border: '1px solid var(--border)', borderRadius: 12,
        }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 5 }}>Year</div>
            <div style={{ display: 'flex', gap: 4 }}>
              {years.map(y => (
                <button key={y}
                  className={`tab-btn${year === y ? ' active' : ''}`}
                  style={{ padding: '6px 14px', fontSize: 13 }}
                  onClick={() => setYear(y)}
                >{y}</button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 5 }}>Term</div>
            <div style={{ display: 'flex', gap: 4 }}>
              {presets.map((p, i) => (
                <button key={i}
                  className={`tab-btn${termIdx === i ? ' active' : ''}`}
                  style={{ padding: '6px 14px', fontSize: 13 }}
                  onClick={() => setTermIdx(i)}
                >{`Term ${i + 1}`}</button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginLeft: 'auto' }}>
            <button
              className="btn-secondary"
              style={{ fontSize: 12, padding: '7px 14px' }}
              onClick={fetchReport}
              disabled={loading}
            >
              🔄 Refresh
            </button>
            {report && report.totalStudents > 0 && (
              <button
                className="btn-primary"
                style={{ fontSize: 12, padding: '7px 14px' }}
                onClick={() => exportTermlyCsv(report)}
              >
                ⬇ Export CSV
              </button>
            )}
          </div>
        </div>

        {/* Date range note */}
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 16 }}>
          Showing data from <strong>{fmtDate(preset.start)}</strong> to <strong>{fmtDate(preset.end)}</strong>
        </div>

        {/* Loading */}
        {loading && (
          <div style={{ textAlign: 'center', padding: 48 }}>
            <div className="spinner" style={{ margin: '0 auto 16px' }} />
            <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Analysing attendance records…</div>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="error-msg">{error}</div>
        )}

        {/* No data */}
        {!loading && !error && report && report.totalStudents === 0 && (
          <div style={{ textAlign: 'center', padding: 48 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', marginBottom: 6 }}>No data for this term</div>
            <div style={{ fontSize: 13, color: 'var(--text-3)' }}>
              Attendance records will appear here once registers have been saved for {preset.label}.
            </div>
          </div>
        )}

        {/* Report body */}
        {!loading && !error && report && report.totalStudents > 0 && (
          <>
            {/* Summary stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
              {[
                { label: 'Students',       value: String(report.totalStudents),        sub: 'in report',     color: 'var(--ink)' },
                { label: 'Overall Rate',   value: `${report.overallRate}%`,            sub: 'attendance avg', color: rateColor(report.overallRate) },
                { label: 'Classes',        value: String(report.classes.length),       sub: 'tracked',       color: 'var(--blue)' },
                { label: 'Needs Attention',value: String(report.chronicAbsentees.length), sub: 'below 80%',  color: report.chronicAbsentees.length > 0 ? 'var(--red)' : 'var(--mint-d)' },
              ].map(s => (
                <div key={s.label} className="stat-card" style={{ padding: '14px 16px' }}>
                  <div className="stat-label" style={{ fontSize: 11 }}>{s.label}</div>
                  <div className="stat-value" style={{ fontSize: 24, color: s.color }}>{s.value}</div>
                  <div className="stat-sub">{s.sub}</div>
                </div>
              ))}
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 16, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
              <div className="tab-bar">
                <button className={`tab-btn${activeTab === 'classes' ? ' active' : ''}`} onClick={() => setActiveTab('classes')}>
                  By Class ({report.classes.length})
                </button>
                <button className={`tab-btn${activeTab === 'absentees' ? ' active' : ''}`} onClick={() => setActiveTab('absentees')}>
                  ⚠️ Needs Attention ({report.chronicAbsentees.length})
                </button>
              </div>
              {activeTab === 'classes' && (
                <button className="btn-xs btn-xs-gray" onClick={() => setExpandAll(v => !v)}>
                  {expandAll ? 'Collapse All' : 'Expand All'}
                </button>
              )}
            </div>

            {/* By class */}
            {activeTab === 'classes' && (
              <div>
                {report.classes.map((cls, i) => (
                  <ClassBlock key={cls.classCode} cls={cls} defaultOpen={i === 0 || expandAll} />
                ))}
              </div>
            )}

            {/* Chronic absentees */}
            {activeTab === 'absentees' && (
              <>
                {report.chronicAbsentees.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 32 }}>
                    <div style={{ fontSize: 36, marginBottom: 10 }}>🎉</div>
                    <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)' }}>All students above 80%</div>
                    <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>No chronic absentees this term.</div>
                  </div>
                ) : (
                  <>
                    <div className="notice notice-warning" style={{ marginBottom: 16 }}>
                      ⚠️ {report.chronicAbsentees.length} student{report.chronicAbsentees.length !== 1 ? 's are' : ' is'} below the 80% attendance threshold.
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                      <table>
                        <thead>
                          <tr>
                            <th>Student</th><th>Class</th><th>Adm. No.</th>
                            <th>Present</th><th>Absent</th><th>Late</th><th>Total Days</th><th>Rate</th>
                          </tr>
                        </thead>
                        <tbody>
                          {report.chronicAbsentees.map(s => (
                            <tr key={s.studentId}>
                              <td className="td-name">{s.studentName}</td>
                              <td><span className="tag tag-gray">{s.classCode}</span></td>
                              <td className="td-mono">{s.admissionNo}</td>
                              <td style={{ fontWeight: 700, color: 'var(--mint-d)' }}>{s.present}</td>
                              <td style={{ fontWeight: 700, color: 'var(--red)' }}>{s.absent}</td>
                              <td style={{ fontWeight: 700, color: 'var(--gold)' }}>{s.late}</td>
                              <td>{s.totalDays}</td>
                              <td><span className={`tag ${rateTag(s.rate)}`}>{s.rate}%</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <button className="btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}