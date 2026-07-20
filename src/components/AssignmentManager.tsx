import { useEffect, useState } from 'react';
import { ClassStructure, UserProfile } from '../types';
import {
  assignTeacherToClass, getSchoolTeachers, removeAssignment, transferTeacher,
} from '../services/teacherAssignmentService';
import { TeacherTransferType } from '../types';
import ConfirmDialog from './ConfirmDialog';

interface Props {
  schoolId: string;
  classStructure: ClassStructure | null;
  currentAdminUid: string;
  onClose: () => void;
}

/** Admin-only screen: see every teacher, assign/remove classes, and move a teacher between classes/streams/schools. */
export default function AssignmentManager({ schoolId, classStructure, currentAdminUid, onClose }: Props) {
  const [teachers, setTeachers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [newClass, setNewClass] = useState('');

  const [removeTarget, setRemoveTarget] = useState<{ uid: string; name: string; classCode: string } | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  const [transferTarget, setTransferTarget] = useState<UserProfile | null>(null);
  const [resultMsg, setResultMsg] = useState('');

  async function load() {
    setLoading(true);
    try {
      const list = await getSchoolTeachers(schoolId);
      setTeachers(list.sort((a, b) => a.displayName.localeCompare(b.displayName)));
    } catch (e: any) {
      setError(e.message || 'Could not load teachers.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [schoolId]);

  /** Every class currently actively held by SOME teacher, mapped to who holds it — used to
   * keep the "+ Add Class" picker from ever offering a class that's already taken. */
  const classHolders = new Map<string, string>();
  teachers.forEach(t => {
    const classes = t.assignedClasses?.length ? t.assignedClasses : (t.classCode ? [t.classCode] : []);
    classes.forEach(c => classHolders.set(c, t.displayName));
  });

  async function handleAssign(teacher: UserProfile) {
    if (!newClass) return;
    setError('');
    try {
      await assignTeacherToClass({
        schoolId, teacherUid: teacher.uid, teacherName: teacher.displayName, classCode: newClass, assignedBy: currentAdminUid,
      });
      setAddingFor(null);
      setNewClass('');
      await load();
    } catch (e: any) {
      setError(e.message || 'Could not assign class.');
    }
  }

  async function handleRemove() {
    if (!removeTarget) return;
    setRemoveBusy(true);
    setError('');
    try {
      await removeAssignment({ schoolId, teacherUid: removeTarget.uid, classCode: removeTarget.classCode });
      setRemoveTarget(null);
      await load();
    } catch (e: any) {
      setError(e.message || 'Could not remove assignment.');
    } finally {
      setRemoveBusy(false);
    }
  }

  return (
    <div className="modal-overlay open" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 640, width: '95vw' }}>
        <div className="modal-header">
          <span className="modal-title">Teacher Assignments</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {error && <div className="error-msg" style={{ marginBottom: 12 }}>{error}</div>}
        {resultMsg && <div className="notice notice-info" style={{ marginBottom: 12, fontSize: 12 }}>{resultMsg}</div>}

        {loading ? (
          <div style={{ fontSize: 13, color: 'var(--text-2)' }}>Loading…</div>
        ) : teachers.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-2)' }}>No teacher accounts yet for this school.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 460, overflowY: 'auto' }}>
            {teachers.map(t => {
              const classes = t.assignedClasses?.length ? t.assignedClasses : (t.classCode ? [t.classCode] : []);
              return (
                <div key={t.uid} style={{ background: 'var(--surface-2)', borderRadius: 10, padding: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>{t.displayName}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{t.email || t.phone}</div>
                    </div>
                    <button className="btn-secondary" style={{ fontSize: 12 }} onClick={() => setTransferTarget(t)}>
                      Transfer Teacher →
                    </button>
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                    {classes.length === 0 && (
                      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Whole-school access (no classes assigned)</span>
                    )}
                    {classes.map(c => (
                      <span key={c} style={{
                        display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, background: 'var(--surface)',
                        border: '1px solid var(--border)', borderRadius: 999, padding: '4px 10px',
                      }}>
                        {c}
                        <button
                          onClick={() => setRemoveTarget({ uid: t.uid, name: t.displayName, classCode: c })}
                          style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: 12, lineHeight: 1 }}
                          title={`Remove ${c}`}
                        >✕</button>
                      </span>
                    ))}
                    {addingFor === t.uid ? (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <select className="form-input" style={{ padding: '4px 8px', fontSize: 12 }} value={newClass} onChange={e => setNewClass(e.target.value)}>
                          <option value="">— class —</option>
                          {classStructure?.classes.filter(c => !classes.includes(c) && !classHolders.has(c)).map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <button className="btn-primary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => handleAssign(t)}>Add</button>
                        <button className="btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => { setAddingFor(null); setNewClass(''); }}>Cancel</button>
                      </div>
                    ) : (
                      <button className="btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => setAddingFor(t.uid)}>+ Add Class</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {removeTarget && (
          <ConfirmDialog
            title="Remove class assignment"
            message={`Remove ${removeTarget.name} from ${removeTarget.classCode}? They'll keep any other classes assigned to them.`}
            confirmLabel="Remove"
            danger
            busy={removeBusy}
            onConfirm={handleRemove}
            onCancel={() => setRemoveTarget(null)}
          />
        )}

        {transferTarget && (
          <TeacherTransferDialog
            schoolId={schoolId}
            teacher={transferTarget}
            classStructure={classStructure}
            classHolders={classHolders}
            performedBy={currentAdminUid}
            onClose={() => setTransferTarget(null)}
            onDone={(msg) => { setTransferTarget(null); setResultMsg(msg || ''); load(); }}
          />
        )}
      </div>
    </div>
  );
}

function TeacherTransferDialog({
  schoolId, teacher, classStructure, classHolders, performedBy, onClose, onDone,
}: {
  schoolId: string; teacher: UserProfile; classStructure: ClassStructure | null;
  classHolders: Map<string, string>;
  performedBy: string; onClose: () => void; onDone: (msg?: string) => void;
}) {
  const [type, setType] = useState<Extract<TeacherTransferType, 'class_transfer' | 'stream_transfer'>>('class_transfer');
  const [toClasses, setToClasses] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);

  const myClasses = teacher.assignedClasses?.length ? teacher.assignedClasses : (teacher.classCode ? [teacher.classCode] : []);
  // Destinations currently held by someone else — picking one of these will auto-swap that
  // teacher into whichever class this teacher is vacating.
  const conflictCount = toClasses.filter(c => classHolders.has(c) && classHolders.get(c) !== teacher.displayName).length;
  const vacatedCount = myClasses.filter(c => !toClasses.includes(c)).length;

  function toggleClass(c: string) {
    setToClasses(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]);
  }

  async function submit() {
    setBusy(true);
    setError('');
    try {
      const result = await transferTeacher({
        teacherUid: teacher.uid, teacherName: teacher.displayName, type,
        fromSchoolId: schoolId, toClasses, performedBy, reason: reason.trim() || undefined,
      });
      const msg = result.swappedTeachers.length
        ? `Also moved ${result.swappedTeachers.map(s => `${s.teacherName} → ${s.intoClass}`).join(', ')} to avoid an orphaned class.`
        : undefined;
      onDone(msg);
    } catch (e: any) {
      setError(e.message || 'Transfer failed.');
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  if (confirming) {
    return (
      <ConfirmDialog
        title="Confirm teacher transfer"
        message={
          `${teacher.displayName} will be moved to: ${toClasses.join(', ') || '(no classes selected)'}.` +
          (conflictCount > 0
            ? ` ${conflictCount} of those classes currently have another teacher — they'll be automatically swapped into the class(es) ${teacher.displayName} is vacating so nobody is left without one.`
            : '')
        }
        confirmLabel="Transfer"
        busy={busy}
        error={error}
        onConfirm={submit}
        onCancel={() => setConfirming(false)}
      />
    );
  }

  return (
    <div className="modal-overlay open" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 460, width: '95vw' }}>
        <div className="modal-header">
          <span className="modal-title">Transfer {teacher.displayName}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="notice notice-info" style={{ fontSize: 12 }}>
            ℹ️ Moving a teacher to a <strong>different school</strong> isn't done here — that has
            to be initiated by the teacher themself from their own account (Settings → Change School),
            since it removes their access to this school immediately and only they can confirm that.
          </div>

          <div className="form-group">
            <label className="form-label">Transfer Type</label>
            <select className="form-input" value={type} onChange={e => { setType(e.target.value as 'class_transfer' | 'stream_transfer'); setToClasses([]); }}>
              <option value="class_transfer">Between classes (same school)</option>
              <option value="stream_transfer">Between streams (same school)</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">New class(es)</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {(classStructure?.classes || []).map(c => {
                const holder = classHolders.get(c);
                const heldByOther = holder && holder !== teacher.displayName;
                return (
                  <button
                    key={c}
                    onClick={() => toggleClass(c)}
                    className={toClasses.includes(c) ? 'btn-primary' : 'btn-secondary'}
                    style={{ fontSize: 12, padding: '4px 10px' }}
                    title={heldByOther ? `Currently taught by ${holder} — will be swapped` : undefined}
                  >
                    {c}{heldByOther ? ` (${holder})` : ''}
                  </button>
                );
              })}
            </div>
            {conflictCount > 0 && (
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>
                {conflictCount > vacatedCount
                  ? `⚠️ ${teacher.displayName} is only vacating ${vacatedCount} class(es) — not enough to swap ${conflictCount} occupied class(es). Free up a class first.`
                  : `${conflictCount} selected class(es) are occupied — their teacher(s) will be swapped into the class(es) ${teacher.displayName} vacates.`}
              </div>
            )}
          </div>

          <div className="form-group"><label className="form-label">Reason (optional)</label>
            <input className="form-input" value={reason} onChange={e => setReason(e.target.value)} /></div>

          {error && <div className="error-msg">{error}</div>}

          <button
            className="btn-primary"
            style={{ justifyContent: 'center' }}
            disabled={toClasses.length === 0 || conflictCount > vacatedCount}
            onClick={() => setConfirming(true)}
          >
            Review Transfer
          </button>
        </div>
      </div>
    </div>
  );
}
