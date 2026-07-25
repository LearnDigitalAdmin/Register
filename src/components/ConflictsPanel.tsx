import { useEffect, useMemo, useState } from 'react';
import { Conflict, ConflictStatus, CONFLICT_TYPE_LABELS } from '../types';
import { getConflicts, setConflictStatus, scanSchoolForConflicts, ScanResult } from '../services/conflictsService';

interface Props {
  schoolId: string;
  onClose: () => void;
}

type Filter = 'open' | 'all';

export default function ConflictsPanel({ schoolId, onClose }: Props) {
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('open');
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => { if (schoolId) load(); }, [schoolId]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      setConflicts(await getConflicts(schoolId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load conflicts.');
    } finally {
      setLoading(false);
    }
  }

  async function runScan() {
    setScanning(true);
    setError('');
    setScanResult(null);
    try {
      const result = await scanSchoolForConflicts(schoolId);
      setScanResult(result);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Scan failed.');
    } finally {
      setScanning(false);
    }
  }

  async function act(conflict: Conflict, status: ConflictStatus, note: string) {
    setBusyId(conflict.id);
    try {
      await setConflictStatus(conflict.id, status, note);
      setConflicts(prev => prev.map(c => c.id === conflict.id ? { ...c, status, resolutionNote: note } : c));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update conflict.');
    } finally {
      setBusyId(null);
    }
  }

  const visible = useMemo(
    () => conflicts.filter(c => filter === 'all' || c.status === 'open'),
    [conflicts, filter],
  );
  const openCount = useMemo(() => conflicts.filter(c => c.status === 'open').length, [conflicts]);

  return (
    <div className="modal-overlay open" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 860, width: '95vw' }}>
        <div className="modal-header">
          <span className="modal-title">Data Conflicts {openCount > 0 && `(${openCount} open)`}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="notice notice-info">
          These are pairs of students that share an admission number or a parent's phone number
          in a way that doesn't look like ordinary siblings — possible duplicate entries, or two
          different families apparently sharing one contact number. Nothing is changed
          automatically; review each one and dismiss, resolve, or fix the underlying record.
        </div>

        {error && <div className="notice notice-locked">⚠️ {error}</div>}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '12px 0' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className={filter === 'open' ? 'btn-primary' : 'btn-secondary'} onClick={() => setFilter('open')}>
              Open ({openCount})
            </button>
            <button className={filter === 'all' ? 'btn-primary' : 'btn-secondary'} onClick={() => setFilter('all')}>
              All ({conflicts.length})
            </button>
          </div>
          <button className="btn-secondary" disabled={scanning} onClick={runScan}>
            {scanning ? 'Scanning…' : '🔍 Run full scan'}
          </button>
        </div>

        {scanResult && (
          <div className="notice notice-info" style={{ fontSize: 13 }}>
            Scanned {scanResult.studentsScanned} students, checked {scanResult.pairsChecked} candidate pairs,
            flagged {scanResult.conflictsFlagged} conflict{scanResult.conflictsFlagged === 1 ? '' : 's'}.
          </div>
        )}

        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)' }}>Loading…</div>
        ) : visible.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)' }}>
            {filter === 'open' ? 'No open conflicts. 🎉' : 'No conflicts on record for this school.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '55vh', overflowY: 'auto' }}>
            {visible.map(c => (
              <div key={c.id} style={{
                border: '1px solid var(--border)', borderRadius: 10, padding: 14,
                background: c.status === 'open' ? 'rgba(232,69,69,.04)' : 'var(--surface-2)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div>
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                      background: 'rgba(232,69,69,.12)', color: 'var(--red)',
                    }}>
                      {CONFLICT_TYPE_LABELS[c.type]}
                    </span>
                    {c.status !== 'open' && (
                      <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-3)' }}>
                        {c.status === 'dismissed' ? 'Dismissed' : 'Resolved'}
                        {c.resolutionNote ? ` — ${c.resolutionNote}` : ''}
                      </span>
                    )}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, margin: '10px 0' }}>
                  {c.students.map(s => (
                    <div key={s.id} style={{ fontSize: 13, background: 'var(--surface-1)', borderRadius: 8, padding: 10 }}>
                      <div style={{ fontWeight: 700 }}>{s.name}</div>
                      <div style={{ color: 'var(--text-3)' }}>Adm. {s.admissionNo} · {s.classCode}</div>
                      <div style={{ color: 'var(--text-3)' }}>Parent: {s.parentName || '—'}</div>
                      <div style={{ color: 'var(--text-3)' }}>Phone: {s.parentPhone || '—'}</div>
                    </div>
                  ))}
                </div>

                <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 10 }}>{c.reason}</div>

                {c.status === 'open' && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      className="btn-secondary" disabled={busyId === c.id}
                      onClick={() => act(c, 'dismissed', 'Reviewed — not a duplicate or conflict.')}
                    >
                      Not a duplicate
                    </button>
                    <button
                      className="btn-secondary" disabled={busyId === c.id}
                      onClick={() => act(c, 'resolved', 'Fixed manually by admin.')}
                    >
                      Mark resolved
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
