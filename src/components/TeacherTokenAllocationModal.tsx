import { useEffect, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { allocateTokensToTeachers } from '../services/tokenAllocationService';
import { UserProfile } from '../types';

interface TeacherOption { uid: string; name: string; tokens: number; }

export default function TeacherTokenAllocationModal({
  isOpen, onClose, schoolId, adminTokensAvailable, onDone, toast,
}: {
  isOpen: boolean;
  onClose: () => void;
  schoolId: string;
  adminTokensAvailable: number;
  onDone: () => void;
  toast: (msg: string) => void;
}) {
  const [teachers, setTeachers] = useState<TeacherOption[]>([]);
  const [mode, setMode] = useState<'all' | 'selected'>('all');
  const [selectedUids, setSelectedUids] = useState<string[]>([]);
  const [amount, setAmount] = useState<number>(50);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen || !schoolId) return;
    getDocs(query(collection(db, 'users'), where('schoolId', '==', schoolId), where('role', '==', 'teacherAdmin')))
      .then(snap => setTeachers(snap.docs.map(d => ({
        uid: d.id, name: (d.data() as UserProfile).displayName || 'Teacher', tokens: (d.data() as UserProfile).messageTokens || 0,
      }))))
      .catch(() => {});
  }, [isOpen, schoolId]);

  if (!isOpen) return null;

  const recipientCount = mode === 'all' ? teachers.length : selectedUids.length;
  const totalCost = amount * recipientCount;
  const canSubmit = amount > 0 && recipientCount > 0 && totalCost <= adminTokensAvailable && !saving;

  async function handleSubmit() {
    setError('');
    setSaving(true);
    try {
      await allocateTokensToTeachers({
        schoolId,
        teacherUids: mode === 'all' ? 'all' : selectedUids,
        amountPerTeacher: amount,
      });
      toast(`✅ Allocated ${amount} tokens to ${recipientCount} teacher${recipientCount > 1 ? 's' : ''}.`);
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not allocate tokens.');
    }
    setSaving(false);
  }

  return (
    <div className="modal-overlay open" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ width: 480 }}>
        <div className="modal-header">
          <span className="modal-title">Allocate Tokens to Teachers</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {error && <div className="error-msg">{error}</div>}

        <div className="form-group">
          <label className="form-label">Give tokens to</label>
          <div className="tab-bar">
            <button type="button" className={`tab-btn ${mode === 'all' ? 'active' : ''}`} onClick={() => setMode('all')}>All teachers ({teachers.length})</button>
            <button type="button" className={`tab-btn ${mode === 'selected' ? 'active' : ''}`} onClick={() => setMode('selected')}>Selected teachers</button>
          </div>
        </div>

        {mode === 'selected' && (
          <div className="form-group">
            <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10, padding: 8 }}>
              {teachers.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-3)', padding: 8 }}>No teachers found.</div>}
              {teachers.map(t => (
                <label key={t.uid} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 4px', fontSize: 13 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="checkbox" checked={selectedUids.includes(t.uid)}
                      onChange={e => setSelectedUids(prev => e.target.checked ? [...prev, t.uid] : prev.filter(u => u !== t.uid))} />
                    {t.name}
                  </span>
                  <span className="td-mono" style={{ color: 'var(--text-3)' }}>{t.tokens} tokens</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="form-group">
          <label className="form-label">Tokens per teacher</label>
          <input className="form-input" type="number" min={1} value={amount} onChange={e => setAmount(Math.max(0, Number(e.target.value)))} />
        </div>

        <div className="card" style={{ background: 'var(--surface-2)', marginBottom: 16 }}>
          <div className="card-body" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: .5 }}>Recipients</div>
              <div style={{ fontSize: 18, fontWeight: 800 }}>{recipientCount}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: .5 }}>Total cost</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: totalCost > adminTokensAvailable ? 'var(--red)' : 'var(--ink)' }}>{totalCost}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: .5 }}>Your balance</div>
              <div style={{ fontSize: 18, fontWeight: 800 }}>{adminTokensAvailable}</div>
            </div>
          </div>
          {totalCost > adminTokensAvailable && (
            <div className="notice notice-warning" style={{ margin: '0 20px 16px' }}>Not enough tokens to cover this allocation — top up or reduce the amount.</div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn-primary" disabled={!canSubmit} onClick={handleSubmit}>{saving ? '⏳ Allocating…' : 'Allocate Tokens'}</button>
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
