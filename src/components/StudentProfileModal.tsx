/**
 * src/components/reports/StudentProfileModal.tsx
 *
 * Individual student attendance profile modal.
 * Features:
 *  - Searchable student picker
 *  - Summary stats (rate, streaks, totals)
 *  - Mini calendar heatmap (last 60 days)
 *  - Full attendance history table
 *  - Recent absences/lates panel
 *  - CSV export
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';


import { StudentAttendanceDay, StudentProfile, generateStudentProfile, rateTag, exportStudentCsv, fmtDate } from '../services/reportsService';
import { Student } from '../types';

// ─── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  isOpen:      boolean;
  onClose:     () => void;
  schoolId:    string;
  schoolName:  string;
  students:    Student[];   // already loaded in AppDashboard
  academicYearId?: string;
}

// ─── Heatmap ───────────────────────────────────────────────────────────────────

const STATUS_HEATMAP: Record<string, string> = {
  present:  'var(--mint)',
  absent:   'var(--red)',
  late:     'var(--gold)',
  excused:  'var(--blue)',
  unmarked: '#9aa0a6',
  none:     'var(--border)',
};

/** Monday on/before `d` (local calendar date, time-of-day ignored). */
function mondayOnOrBefore(d: Date): Date {
  const copy = new Date(d);
  const dow = copy.getDay(); // 0 = Sun .. 6 = Sat
  copy.setDate(copy.getDate() - (dow === 0 ? 6 : dow - 1));
  return copy;
}
/** Sunday on/after `d`. */
function sundayOnOrAfter(d: Date): Date {
  const copy = new Date(d);
  const dow = copy.getDay();
  copy.setDate(copy.getDate() + (dow === 0 ? 0 : 7 - dow));
  return copy;
}

interface HeatCell { date: string; status: string; padding: boolean }

function AttendanceHeatmap({ history }: { history: StudentAttendanceDay[] }) {
  // Real calendar grid, Monday-first, covering the last 70 days — padded out to whole weeks
  // so every column is genuinely the same weekday all the way down (that's the bug this
  // replaces: the old version just chunked 70 days into rows of 7 without aligning to Monday,
  // so the "Mon..Sun" row labels didn't actually match the dates in most rows).
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const rangeStart = new Date(today); rangeStart.setDate(rangeStart.getDate() - 69);
  const gridStart = mondayOnOrBefore(rangeStart);
  const gridEnd = sundayOnOrAfter(today);

  const cells: HeatCell[] = [];
  for (const cursor = new Date(gridStart); cursor <= gridEnd; cursor.setDate(cursor.getDate() + 1)) {
    const ymd = cursor.toISOString().slice(0, 10);
    const inRange = cursor >= rangeStart && cursor <= today;
    if (!inRange) { cells.push({ date: ymd, status: '', padding: true }); continue; }
    const rec = history.find(h => h.date === ymd);
    cells.push({ date: ymd, status: rec ? rec.status : 'none', padding: false });
  }

  const weeks: HeatCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 10 }}>
        Last 10 Weeks
      </div>
      <div style={{ display: 'flex', gap: 4, overflowX: 'auto', paddingBottom: 4 }}>
        {/* Day labels column — di now reliably matches LABELS[di] for every week below. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingTop: 18 }}>
          {LABELS.map(l => (
            <div key={l} style={{ width: 24, height: 18, fontSize: 9, color: 'var(--text-3)', fontWeight: 600, display: 'flex', alignItems: 'center' }}>{l}</div>
          ))}
        </div>
        {/* Weeks */}
        {weeks.map((week, wi) => (
          <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {/* Month label on the first real (non-padding) day of the month in this column */}
            <div style={{ height: 14, fontSize: 9, color: 'var(--text-3)', textAlign: 'center', whiteSpace: 'nowrap' }}>
              {week.find(d => !d.padding && d.date.slice(8) === '01')
                ? new Date(week.find(d => !d.padding && d.date.slice(8) === '01')!.date + 'T00:00:00').toLocaleDateString('en-KE', { month: 'short' })
                : ''}
            </div>
            {week.map((day, di) => (
              <div
                key={di}
                title={day.padding ? undefined : `${day.date}: ${day.status}`}
                style={{
                  width: 18, height: 18, borderRadius: 4,
                  background: day.padding ? 'transparent' : (STATUS_HEATMAP[day.status] || 'var(--border)'),
                  opacity: day.padding ? 0 : (day.status === 'none' ? 0.25 : day.status === 'unmarked' ? 0.5 : 0.85),
                  transition: 'opacity .15s',
                  cursor: !day.padding && day.status !== 'none' ? 'pointer' : 'default',
                }}
              />
            ))}
          </div>
        ))}
      </div>
      {/* Legend */}
      <div style={{ display: 'flex', gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
        {[
          { label: 'Present', color: 'var(--mint)' },
          { label: 'Absent',  color: 'var(--red)' },
          { label: 'Late',    color: 'var(--gold)' },
          { label: 'Excused', color: 'var(--blue)' },
          { label: 'Unmarked', color: '#9aa0a6' },
          { label: 'No data', color: 'var(--border)' },
        ].map(l => (
          <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 12, height: 12, borderRadius: 3, background: l.color, flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{l.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main modal ────────────────────────────────────────────────────────────────

export default function StudentProfileModal({ isOpen, onClose, schoolId, schoolName, students, academicYearId }: Props) {
  const [search,   setSearch]   = useState('');
  const [selected, setSelected] = useState<Student | null>(null);
  const [profile,  setProfile]  = useState<StudentProfile | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [histTab,  setHistTab]  = useState<'all' | 'absences'>('all');
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = search.trim()
    ? students.filter(s =>
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        s.admissionNo.toLowerCase().includes(search.toLowerCase()),
      )
    : students.slice(0, 8);

  const loadProfile = useCallback(async (student: Student) => {
    setLoading(true); setError('');
    try {
      const p = await generateStudentProfile(student.id, schoolId, schoolName, 180, academicYearId);
      if (p) {
        // Fill in parent details from local students list
        p.parentName  = student.parentName  || '';
        p.parentPhone = student.parentPhone || '';
        setProfile(p);
      } else {
        setError('No attendance records found for this student yet.');
        setProfile(null);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load student profile.');
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, [schoolId, schoolName]);

  function handleSelect(student: Student) {
    setSelected(student);
    setSearch('');
    setProfile(null);
    setError('');
    loadProfile(student);
  }

  // Reset on close
  useEffect(() => {
    if (!isOpen) {
      setTimeout(() => {
        setSearch(''); setSelected(null); setProfile(null); setError('');
      }, 250);
    }
  }, [isOpen]);

  if (!isOpen) return null;

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
        <div className="modal-header">
          <div>
            <div className="modal-title">👤 Student Profile</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 3 }}>{schoolName}</div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Student picker */}
        <div style={{
          padding: '14px 16px', background: 'var(--surface-2)',
          border: '1px solid var(--border)', borderRadius: 12, marginBottom: 20,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 8 }}>
            Select a student
          </div>
          <input
            ref={inputRef}
            className="form-input"
            type="text"
            placeholder="Search by name or admission number…"
            value={search}
            onChange={e => { setSearch(e.target.value); setSelected(null); setProfile(null); setError(''); }}
            style={{ marginBottom: search.trim() || !selected ? 10 : 0 }}
            autoFocus
          />

          {/* Dropdown results */}
          {(search.trim() || !selected) && filtered.length > 0 && (
            <div style={{
              border: '1px solid var(--border)', borderRadius: 10,
              overflow: 'hidden', maxHeight: 220, overflowY: 'auto',
              background: 'var(--surface)',
            }}>
              {filtered.map((s, i) => (
                <button
                  key={s.id}
                  onClick={() => handleSelect(s)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    width: '100%', padding: '10px 14px',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: i < filtered.length - 1 ? '1px solid var(--border)' : 'none',
                    cursor: 'pointer',
                    fontFamily: "'Sora', sans-serif",
                    textAlign: 'left',
                    transition: 'background .1s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <div style={{
                    width: 34, height: 34, borderRadius: 8,
                    background: 'rgba(0,200,150,.1)',
                    border: '1px solid rgba(0,200,150,.15)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, fontWeight: 700,
                    color: 'var(--mint-d)', flexShrink: 0,
                  }}>
                    {s.name.charAt(0).toUpperCase()}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{s.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: "'DM Mono', monospace" }}>
                      {s.admissionNo} · {s.classCode}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {search.trim() && filtered.length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--text-3)', padding: '8px 0' }}>
              No students match "{search}"
            </div>
          )}
        </div>

        {/* Loading */}
        {loading && (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <div className="spinner" style={{ margin: '0 auto 16px' }} />
            <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Loading {selected?.name}'s history…</div>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div className="error-msg">{error}</div>
        )}

        {/* No selection */}
        {!selected && !loading && !error && (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-3)', fontSize: 14 }}>
            Search for a student above to view their attendance profile.
          </div>
        )}

        {/* Profile */}
        {!loading && !error && profile && selected && (
          <>
            {/* Student identity card */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
              padding: '16px 20px',
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              borderRadius: 14, marginBottom: 20,
            }}>
              <div style={{
                width: 52, height: 52, borderRadius: 12,
                background: 'rgba(0,200,150,.12)',
                border: '2px solid rgba(0,200,150,.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 22, fontWeight: 800, color: 'var(--mint-d)',
                flexShrink: 0,
              }}>
                {profile.studentName.charAt(0)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 18, color: 'var(--ink)' }}>{profile.studentName}</div>
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2, fontFamily: "'DM Mono', monospace" }}>
                  {profile.admissionNo} · {profile.classCode}
                </div>
                {profile.parentName && (
                  <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>
                    Parent: {profile.parentName}
                    {profile.parentPhone && <span style={{ marginLeft: 8, fontFamily: "'DM Mono',monospace" }}>{profile.parentPhone}</span>}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <span className={`tag ${rateTag(profile.rate)}`} style={{ fontSize: 13, padding: '6px 14px' }}>
                  {profile.rate}% attendance
                </span>
                <button
                  className="btn-secondary"
                  style={{ fontSize: 12, padding: '7px 14px' }}
                  onClick={() => exportStudentCsv(profile)}
                >
                  ⬇ CSV
                </button>
              </div>
            </div>

            {/* Stats grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>
              {[
                { label: 'Days Recorded', value: String(profile.totalDays), color: 'var(--ink)' },
                { label: 'Present',  value: String(profile.present),  color: 'var(--mint-d)' },
                { label: 'Absent',   value: String(profile.absent),   color: 'var(--red)' },
                { label: 'Late',     value: String(profile.late),     color: '#c4800a' },
              ].map(s => (
                <div key={s.label} className="stat-card" style={{ padding: '12px 14px' }}>
                  <div className="stat-label" style={{ fontSize: 10 }}>{s.label}</div>
                  <div className="stat-value" style={{ fontSize: 24, color: s.color }}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* Streaks */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
              <div style={{
                padding: '14px 18px', borderRadius: 12,
                background: profile.streak > 0 ? 'rgba(0,200,150,.06)' : 'var(--surface-2)',
                border: `1px solid ${profile.streak > 0 ? 'rgba(0,200,150,.2)' : 'var(--border)'}`,
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 6 }}>Current Streak</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: profile.streak > 0 ? 'var(--mint-d)' : 'var(--text-3)' }}>
                  {profile.streak} <span style={{ fontSize: 14, fontWeight: 400 }}>consecutive days present</span>
                </div>
              </div>
              <div style={{
                padding: '14px 18px', borderRadius: 12,
                background: 'rgba(44,111,173,.05)',
                border: '1px solid rgba(44,111,173,.15)',
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 6 }}>Longest Streak</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--blue)' }}>
                  {profile.longestStreak} <span style={{ fontSize: 14, fontWeight: 400 }}>days present</span>
                </div>
              </div>
            </div>

            {/* Heatmap */}
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="card-header"><span className="card-title">Attendance Heatmap</span></div>
              <div className="card-body">
                <AttendanceHeatmap history={profile.history} />
              </div>
            </div>

            {/* History table */}
            <div className="card">
              <div className="card-header">
                <span className="card-title">Attendance History</span>
                <div className="tab-bar">
                  <button className={`tab-btn${histTab === 'all' ? ' active' : ''}`} onClick={() => setHistTab('all')}>
                    All ({profile.totalDays})
                  </button>
                  <button className={`tab-btn${histTab === 'absences' ? ' active' : ''}`} onClick={() => setHistTab('absences')}>
                    Absences &amp; Lates ({profile.absent + profile.late})
                  </button>
                </div>
              </div>
              <div style={{ overflowX: 'auto', maxHeight: 320, overflowY: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Day</th>
                      <th>Status</th>
                      <th>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(histTab === 'all'
                      ? [...profile.history].reverse()
                      : profile.history.filter(h => h.status === 'absent' || h.status === 'late').reverse()
                    ).map((h, i) => (
                      <tr key={h.date + i}>
                        <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(h.date)}</td>
                        <td style={{ color: 'var(--text-2)' }}>{h.dayName}</td>
                        <td>
                          <span className={`tag ${
                            h.status === 'present' ? 'tag-mint' :
                            h.status === 'absent'  ? 'tag-red'  :
                            h.status === 'late'    ? 'tag-gold' :
                            h.status === 'excused' ? 'tag-blue' : 'tag-gray'
                          }`}>
                            {h.status.charAt(0).toUpperCase() + h.status.slice(1)}
                          </span>
                        </td>
                        <td style={{ color: 'var(--text-3)', fontSize: 12 }}>{h.note || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {histTab === 'absences' && profile.absent + profile.late === 0 && (
                  <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
                    🎉 No absences or lates recorded.
                  </div>
                )}
              </div>
            </div>
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
