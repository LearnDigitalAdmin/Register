import { useState } from 'react';
import { ClassStructure, Student } from '../types';
import {
  crossYearTransferRecord, internalTransferStudent, transferInStudent, transferOutStudent,
} from '../services/transferService';

type Mode = 'in' | 'out' | 'internal' | 'cross_year';

interface Props {
  mode: Mode;
  schoolId: string;
  classStructure: ClassStructure | null;
  performedBy: string;
  activeAcademicYearId: string;
  /** Required for out/internal/cross_year — the student being transferred. Not used for 'in'. */
  student?: Student;
  onClose: () => void;
  onDone: () => void;
}

/** One dialog covering every transfer type: transfer in, transfer out, internal class/stream, cross-year. */
export default function TransferDialog({
  mode, schoolId, classStructure, performedBy, activeAcademicYearId, student, onClose, onDone,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  // transfer in
  const [name, setName] = useState('');
  const [admissionNo, setAdmissionNo] = useState('');
  const [classCode, setClassCode] = useState(classStructure?.classes[0] || '');
  const [parentName, setParentName] = useState('');
  const [parentPhone, setParentPhone] = useState('');
  const [fromSchool, setFromSchool] = useState('');

  // transfer out
  const [toSchool, setToSchool] = useState('');

  // internal
  const [toClass, setToClass] = useState(classStructure?.classes.find(c => c !== student?.classCode) || '');
  const [isStreamOnly, setIsStreamOnly] = useState(false);

  const [reason, setReason] = useState('');

  const titles: Record<Mode, string> = {
    in: 'Transfer Student In',
    out: 'Transfer Student Out',
    internal: 'Internal / Stream Transfer',
    cross_year: 'Record Cross-Year Transfer',
  };

  async function handleSubmit() {
    setError('');
    setBusy(true);
    try {
      if (mode === 'in') {
        if (!name.trim() || !admissionNo.trim() || !classCode) throw new Error('Name, admission number, and class are required.');
        await transferInStudent({
          schoolId, classCode, name: name.trim(), admissionNo: admissionNo.trim(),
          parentName: parentName.trim(), parentPhone: parentPhone.trim(), parentWhatsApp: parentPhone.trim(),
          fromSchoolId: fromSchool.trim() || undefined, reason: reason.trim() || undefined, performedBy,
        });
      } else if (mode === 'out') {
        if (!student) throw new Error('No student selected.');
        await transferOutStudent({
          schoolId, studentId: student.id, toSchoolId: toSchool.trim() || undefined,
          reason: reason.trim() || undefined, performedBy,
        });
      } else if (mode === 'internal') {
        if (!student) throw new Error('No student selected.');
        if (!toClass) throw new Error('Choose a destination class.');
        await internalTransferStudent({
          schoolId, studentId: student.id, toClassCode: toClass, isStreamOnly,
          reason: reason.trim() || undefined, performedBy,
        });
      } else {
        if (!student) throw new Error('No student selected.');
        await crossYearTransferRecord({
          schoolId, studentId: student.id, academicYearId: activeAcademicYearId,
          fromClassCode: student.classCode, toClassCode: toClass || undefined,
          reason: reason.trim() || undefined, performedBy,
        });
      }
      setDone(true);
    } catch (e: any) {
      setError(e.message || 'Transfer failed.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="modal-overlay open">
        <div className="modal" style={{ maxWidth: 420, width: '95vw', textAlign: 'center', padding: '32px' }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>✅</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Transfer recorded</div>
          <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 20 }}>
            Attendance history is preserved — nothing was deleted.
          </div>
          <button className="btn-primary" onClick={onDone}>Done</button>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay open" onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal" style={{ maxWidth: 460, width: '95vw' }}>
        <div className="modal-header">
          <span className="modal-title">{titles[mode]}</span>
          {!busy && <button className="modal-close" onClick={onClose}>✕</button>}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {student && mode !== 'in' && (
            <div style={{ fontSize: 13, background: 'var(--surface-2)', borderRadius: 8, padding: '8px 12px' }}>
              <strong>{student.name}</strong> · {student.admissionNo} · currently {student.classCode}
            </div>
          )}

          {mode === 'in' && (
            <>
              <div className="form-group"><label className="form-label">Student Name</label>
                <input className="form-input" value={name} onChange={e => setName(e.target.value)} /></div>
              <div className="form-group"><label className="form-label">Admission Number</label>
                <input className="form-input" value={admissionNo} onChange={e => setAdmissionNo(e.target.value)} /></div>
              <div className="form-group"><label className="form-label">Class</label>
                <select className="form-input" value={classCode} onChange={e => setClassCode(e.target.value)}>
                  {classStructure?.classes.map(c => <option key={c} value={c}>{c}</option>)}
                </select></div>
              <div className="form-group"><label className="form-label">Parent/Guardian Name</label>
                <input className="form-input" value={parentName} onChange={e => setParentName(e.target.value)} /></div>
              <div className="form-group"><label className="form-label">Parent Phone</label>
                <input className="form-input" value={parentPhone} onChange={e => setParentPhone(e.target.value)} /></div>
              <div className="form-group"><label className="form-label">Coming From (school name, optional)</label>
                <input className="form-input" value={fromSchool} onChange={e => setFromSchool(e.target.value)} /></div>
            </>
          )}

          {mode === 'out' && (
            <div className="form-group"><label className="form-label">Destination School (optional)</label>
              <input className="form-input" value={toSchool} onChange={e => setToSchool(e.target.value)} /></div>
          )}

          {(mode === 'internal' || mode === 'cross_year') && (
            <>
              <div className="form-group"><label className="form-label">Destination Class</label>
                <select className="form-input" value={toClass} onChange={e => setToClass(e.target.value)}>
                  <option value="">— choose —</option>
                  {classStructure?.classes.filter(c => c !== student?.classCode).map(c => <option key={c} value={c}>{c}</option>)}
                </select></div>
              {mode === 'internal' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <input type="checkbox" checked={isStreamOnly} onChange={e => setIsStreamOnly(e.target.checked)} />
                  This is a stream change only (same grade level)
                </label>
              )}
            </>
          )}

          <div className="form-group"><label className="form-label">Reason (optional)</label>
            <input className="form-input" value={reason} onChange={e => setReason(e.target.value)} /></div>

          {error && <div className="error-msg">{error}</div>}

          <button className="btn-primary" onClick={handleSubmit} disabled={busy} style={{ justifyContent: 'center' }}>
            {busy ? 'Saving…' : 'Confirm Transfer'}
          </button>
        </div>
      </div>
    </div>
  );
}
