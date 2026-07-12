/**
 * src/components/reports/WeeklyReportModal.tsx
 *
 * Weekly attendance summary modal.
 * Features:
 *  - Week navigator (← / →)
 *  - Per-class attendance grid (Mon–Fri rows)
 *  - Visual rate bar per day
 *  - Overall school week summary
 *  - CSV export
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { WeeklyDayRow, rateColor, WeeklyClassSummary, WeeklySummary, generateWeeklySummary, fmtDate, exportWeeklyCsv } from '../services/reportsService';


// ─── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  isOpen:     boolean;
  onClose:    () => void;
  schoolId:   string;
  schoolName: string;
  academicYearId?: string;
  /** The class currently active in the dashboard (from the class switcher) — used as the default scope. */
  defaultClassCode?: string;
  /** Classes the viewer may choose between. Omit to hide the scope selector entirely (single-class view). */
  classOptions?: string[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function prevWeek(d: Date): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() - 7);
  return copy;
}

function nextWeek(d: Date): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + 7);
  return copy;
}

function isThisWeekOrLater(d: Date): boolean {
  const today = new Date();
  // start of this week (Mon)
  const dow  = today.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  const mon  = new Date(today);
  mon.setDate(today.getDate() + diff);
  mon.setHours(0, 0, 0, 0);
  return d >= mon;
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function DayCell({ day }: { day: WeeklyDayRow }) {
  const color = rateColor(day.rate);
  if (!day.hasRegister) {
    return (
      <td style={{ padding: '10px 8px', textAlign: 'center', verticalAlign: 'middle' }}>
        <div style={{ fontSize: 11, color: 'var(--text-3)' }}>—</div>
      </td>
    );
  }
  return (
    <td style={{ padding: '10px 8px', textAlign: 'center', verticalAlign: 'middle' }}>
      <div style={{ fontSize: 16, fontWeight: 800, color, marginBottom: 1 }}>{day.rate}%</div>
      <div style={{ display: 'flex', gap: 3, justifyContent: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 9, color: 'var(--mint-d)', fontWeight: 600 }}>{day.present}P</span>
        <span style={{ fontSize: 9, color: 'var(--red)', fontWeight: 600 }}>{day.absent}A</span>
        {day.late > 0 && <span style={{ fontSize: 9, color: '#c4800a', fontWeight: 600 }}>{day.late}L</span>}
      </div>
    </td>
  );
}

function ClassWeekCard({ cls }: { cls: WeeklyClassSummary }) {
  const color  = rateColor(cls.avgRate);
  const days   = cls.days;

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 14,
      overflow: 'hidden',
      marginBottom: 14,
    }}>
      {/* Class header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 18px',
        background: 'var(--surface-2)',
        borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: 'rgba(0,200,150,.1)',
            border: '1px solid rgba(0,200,150,.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14,
          }}>📋</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>{cls.classCode}</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
              {cls.totalPresent} present · {cls.totalAbsent} absent this week
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 22, fontWeight: 800, color }}>{cls.avgRate}%</div>
          <div style={{ fontSize: 10, color: 'var(--text-3)' }}>week avg</div>
        </div>
      </div>

      {/* Day table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {days.map(d => (
                <th key={d.date} style={{
                  padding: '8px', fontSize: 11, fontWeight: 700,
                  color: 'var(--text-2)', background: 'var(--surface-2)',
                  borderBottom: '1px solid var(--border)',
                  textAlign: 'center', whiteSpace: 'nowrap',
                }}>
                  <div>{d.dayName.slice(0, 3)}</div>
                  <div style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-3)' }}>
                    {d.date.slice(5).replace('-', '/')}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {days.map(d => <DayCell key={d.date} day={d} />)}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main modal ────────────────────────────────────────────────────────────────

export default function WeeklyReportModal({ isOpen, onClose, schoolId, schoolName, academicYearId, defaultClassCode, classOptions }: Props) {
  const [refDate,  setRefDate]  = useState(new Date());
  const [summary,  setSummary]  = useState<WeeklySummary | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [classScope, setClassScope] = useState(defaultClassCode && defaultClassCode !== 'All School' ? defaultClassCode : 'All School');

  // Keep the scope in sync with the dashboard's active class whenever the modal (re)opens.
  useEffect(() => {
    if (isOpen) setClassScope(defaultClassCode && defaultClassCode !== 'All School' ? defaultClassCode : 'All School');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Keep refs so fetchSummary needs zero reactive deps
  const refDateRef    = useRef(refDate);
  refDateRef.current  = refDate;
  const schoolIdRef   = useRef(schoolId);
  schoolIdRef.current = schoolId;
  const schoolNameRef = useRef(schoolName);
  schoolNameRef.current = schoolName;
  const academicYearIdRef = useRef(academicYearId);
  academicYearIdRef.current = academicYearId;
  const classScopeRef = useRef(classScope);
  classScopeRef.current = classScope;

  // Stable function — empty deps, reads everything via refs
  const fetchSummary = useCallback(async () => {
    if (!schoolIdRef.current) return;
    setLoading(true); setError('');
    try {
      const scope = classScopeRef.current;
      const s = await generateWeeklySummary(
        schoolIdRef.current, schoolNameRef.current, refDateRef.current, academicYearIdRef.current,
        scope === 'All School' ? undefined : scope,
      );
      setSummary(s);
    } catch (e: any) {
      setError(e.message || 'Failed to load weekly summary.');
    } finally {
      setLoading(false);
    }
  }, []); // ← empty: identity is stable for the component's lifetime

  // Fire once on open
  useEffect(() => {
    if (!isOpen) { setSummary(null); setError(''); return; }
    fetchSummary();
  }, [isOpen]); // ← only isOpen

  // Re-fetch when the user navigates weeks or changes the class scope
  useEffect(() => {
    if (!isOpen) return;
    fetchSummary();
  }, [refDate, classScope]); // ← new Date() object only created when user clicks ← →

  if (!isOpen) return null;

  // true when refDate is already on the current week — can't go further forward
  const atCurrentWeek = isThisWeekOrLater(refDate);

  return (
    <div
      className="modal-overlay open"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ alignItems: 'flex-start', paddingTop: 40 }}
    >
      <div className="modal" style={{
        maxWidth: 820, width: '95vw',
        maxHeight: '90vh', overflowY: 'auto',
        borderRadius: 20,
      }}>
        {/* Header */}
        <div className="modal-header" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div className="modal-title">📋 Weekly Attendance Summary</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 3 }}>{schoolName}</div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Week navigator */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, flexWrap: 'wrap',
          padding: '12px 16px', background: 'var(--surface-2)',
          border: '1px solid var(--border)', borderRadius: 12,
          marginBottom: 20,
        }}>
          <button
            className="btn-secondary"
            style={{ padding: '8px 16px', fontSize: 13 }}
            onClick={() => setRefDate(d => prevWeek(d))}
          >
            ← Prev Week
          </button>

          <div style={{ textAlign: 'center' }}>
            {summary && (
              <>
                <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)' }}>
                  {fmtDate(summary.weekStart)} – {fmtDate(summary.weekEnd)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                  {new Date(refDate).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' })}
                </div>
              </>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {classOptions && classOptions.length > 0 && (
              <select
                className="form-input"
                style={{ padding: '6px 10px', fontSize: 12, height: 'auto' }}
                value={classScope}
                onChange={e => setClassScope(e.target.value)}
              >
                <option value="All School">All School</option>
                {classOptions.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            {summary && summary.classes.length > 0 && (
              <button
                className="btn-secondary"
                style={{ padding: '8px 14px', fontSize: 12 }}
                onClick={() => exportWeeklyCsv(summary)}
              >
                ⬇ CSV
              </button>
            )}
            <button
              className="btn-secondary"
              style={{ padding: '8px 16px', fontSize: 13 }}
              disabled={atCurrentWeek}
              onClick={() => { if (!atCurrentWeek) setRefDate(d => nextWeek(d)); }}
            >
              Next Week →
            </button>
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <div className="spinner" style={{ margin: '0 auto 16px' }} />
            <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Loading week data…</div>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="error-msg">{error}</div>
        )}

        {/* No data */}
        {!loading && !error && summary && summary.classes.length === 0 && (
          <div style={{ textAlign: 'center', padding: 48 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)', marginBottom: 6 }}>
              No registers found for this week
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-3)' }}>
              Save at least one register during {summary.weekStart && `${fmtDate(summary.weekStart)} – ${fmtDate(summary.weekEnd)}`} to see data here.
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 20 }}>
              <button className="btn-secondary" onClick={() => setRefDate(d => prevWeek(d))}>← Check previous week</button>
            </div>
          </div>
        )}

        {/* Summary body */}
        {!loading && !error && summary && summary.classes.length > 0 && (
          <>
            {/* School-wide week stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
              {[
                { label: 'Classes Tracked', value: String(summary.classes.length), color: 'var(--ink)' },
                { label: 'Overall Rate', value: `${summary.overallRate}%`, color: rateColor(summary.overallRate) },
                {
                  label: 'Total Present',
                  value: String(summary.classes.reduce((s, c) => s + c.totalPresent, 0)),
                  color: 'var(--mint-d)',
                },
              ].map(s => (
                <div key={s.label} className="stat-card" style={{ padding: '14px 16px' }}>
                  <div className="stat-label" style={{ fontSize: 11 }}>{s.label}</div>
                  <div className="stat-value" style={{ fontSize: 24, color: s.color }}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* Class cards */}
            {summary.classes.map(cls => (
              <ClassWeekCard key={cls.classCode} cls={cls} />
            ))}
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