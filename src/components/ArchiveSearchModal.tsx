import { useState } from 'react';
import { ArchivedStudent } from '../types';
import { searchArchive } from '../services/archiveService';

export default function ArchiveSearchModal({ onClose }: { onClose: () => void }) {
  const [term, setTerm]       = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ArchivedStudent[] | null>(null);
  const [error, setError]     = useState('');

  async function runSearch() {
    if (!term.trim()) return;
    setLoading(true);
    setError('');
    try {
      const r = await searchArchive(term);
      setResults(r);
    } catch (e: any) {
      setError(e.message || 'Search failed.');
    }
    setLoading(false);
  }

  return (
    <div className="modal-overlay open" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 640, width: '95vw' }}>
        <div className="modal-header">
          <span className="modal-title">Graduate Archive Search</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <input
            className="form-input"
            placeholder="Admission number, national ID, or name"
            value={term}
            onChange={e => setTerm(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') runSearch(); }}
          />
          <button className="btn-primary" onClick={runSearch} disabled={loading || !term.trim()}>
            {loading ? 'Searching…' : 'Search'}
          </button>
        </div>

        {error && <div className="error-msg">{error}</div>}

        {results && results.length === 0 && (
          <div style={{ fontSize: 13, color: 'var(--text-3)', textAlign: 'center', padding: '20px 0' }}>
            No archived students matched "{term}".
          </div>
        )}

        {results && results.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 420, overflowY: 'auto' }}>
            {results.map(r => (
              <div key={r.id} className="card" style={{ margin: 0 }}>
                <div className="card-body">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                    <div style={{ fontSize: 15, fontWeight: 700 }}>{r.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: "'DM Mono',monospace" }}>{r.admissionNo}</div>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 10 }}>
                    {r.schoolName} · graduated {r.graduatingClass} on {new Date(r.graduatedAt).toLocaleDateString('en-KE')}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {r.years.map(y => (
                      <div key={y.academicYearId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, background: 'var(--surface-2)', borderRadius: 6, padding: '5px 10px' }}>
                        <span>{y.yearLabel} — {y.classCode}</span>
                        <span style={{ color: 'var(--text-3)' }}>
                          {y.presentDays}/{y.totalDays} days present
                          {y.totalDays > 0 ? ` (${Math.round((y.presentDays / y.totalDays) * 100)}%)` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
