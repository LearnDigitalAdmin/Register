import { useState } from 'react';
import { UserProfile } from '../types';
import { selfTransferSchool } from '../services/teacherAssignmentService';
import ConfirmDialog from './ConfirmDialog';

interface Props {
  teacher: UserProfile;
  onClose: () => void;
  onDone: () => void; // caller should refreshProfile() after this
}

/**
 * Lets a teacher move their OWN account to a different school by entering that school's code
 * and confirming. On confirm, this immediately ends every active class assignment at the
 * current school and re-links the account to the new one — there is no approval step from
 * either school's admin, since only the teacher can authorise moving their own account.
 */
export default function ChangeSchoolDialog({ teacher, onClose, onDone }: Props) {
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function submit() {
    setBusy(true);
    setError('');
    try {
      await selfTransferSchool({
        teacherUid: teacher.uid, teacherName: teacher.displayName,
        fromSchoolId: teacher.schoolId, toSchoolCode: code, reason: reason.trim() || undefined,
      });
      setDone(true);
    } catch (e: any) {
      setError(e.message || 'Could not complete the transfer.');
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="modal-overlay open">
        <div className="modal" style={{ maxWidth: 420, width: '95vw', textAlign: 'center', padding: '32px' }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>✅</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>You've moved schools</div>
          <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 20 }}>
            Your access to your old school has been removed. Your new school's admin will assign you a class shortly.
          </div>
          <button className="btn-primary" onClick={onDone}>Done</button>
        </div>
      </div>
    );
  }

  if (confirming) {
    return (
      <ConfirmDialog
        title="Confirm school transfer"
        message={`You're about to move your account to school code "${code.trim().toUpperCase()}". This removes your access to ${teacher.schoolName} and every one of its students immediately — you won't be able to undo this yourself. Your past activity here is kept for history.`}
        confirmLabel="Yes, transfer my account"
        danger
        busy={busy}
        error={error}
        onConfirm={submit}
        onCancel={() => setConfirming(false)}
      />
    );
  }

  return (
    <div className="modal-overlay open" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 420, width: '95vw' }}>
        <div className="modal-header">
          <span className="modal-title">Change School</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="notice notice-warning" style={{ fontSize: 12 }}>
            ⚠️ Moving to another school removes your access to <strong>{teacher.schoolName}</strong> and
            all its students the moment you confirm. This can't be reversed from here.
          </div>
          <div className="form-group">
            <label className="form-label">New School's Code</label>
            <input className="form-input" value={code} onChange={e => setCode(e.target.value)} placeholder="e.g. KNEC-123" />
          </div>
          <div className="form-group">
            <label className="form-label">Reason (optional)</label>
            <input className="form-input" value={reason} onChange={e => setReason(e.target.value)} />
          </div>
          {error && <div className="error-msg">{error}</div>}
          <button className="btn-primary" style={{ justifyContent: 'center' }} disabled={!code.trim()} onClick={() => setConfirming(true)}>
            Review Transfer
          </button>
        </div>
      </div>
    </div>
  );
}
