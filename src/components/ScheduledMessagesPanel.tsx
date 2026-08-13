import { useEffect, useState } from 'react';
import {
  ScheduledMessage, ScheduleStatus, BoardingType, UserRole,
  SCHEDULE_AUDIENCE_LABELS, SCHEDULE_FREQUENCY_LABELS, SCHEDULE_STATUS_LABELS,
} from '../types';
import { listSchoolSchedules, stopScheduledMessage, deleteScheduledMessage, rescheduleCompletedMessage } from '../services/scheduleService';
import ScheduleComposerModal from './ScheduleComposerModal';

const STATUS_TAG_CLASS: Record<ScheduleStatus, string> = {
  active: 'tag-mint',
  insufficientTokens: 'tag-gold',
  stopped: 'tag-gray',
  completed: 'tag-blue',
};

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function ScheduledMessagesPanel({
  schoolId, boardingType, currentUserUid, currentUserRole, assignedClasses, classOptions,
  tokensAvailable, isAdmin, toast, onTokensChanged,
}: {
  schoolId: string;
  boardingType?: BoardingType;
  currentUserUid: string;
  currentUserRole: UserRole;
  assignedClasses: string[];
  classOptions: string[];
  tokensAvailable: number;
  isAdmin: boolean;
  toast: (msg: string) => void;
  onTokensChanged: () => void;
}) {
  const [schedules, setSchedules] = useState<ScheduledMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ScheduleStatus | 'all'>('all');
  const [showComposer, setShowComposer] = useState(false);
  const [editing, setEditing] = useState<ScheduledMessage | null>(null);
  const [reschedulingId, setReschedulingId] = useState<string | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const all = await listSchoolSchedules(schoolId);
      const scoped = isAdmin ? all : all.filter(s => s.createdBy === currentUserUid || (s.classCode && assignedClasses.includes(s.classCode)));
      setSchedules(scoped);
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  useEffect(() => { if (schoolId) load(); }, [schoolId]);

  const visible = filter === 'all' ? schedules : schedules.filter(s => s.status === filter);
  const counts = {
    active: schedules.filter(s => s.status === 'active').length,
    insufficientTokens: schedules.filter(s => s.status === 'insufficientTokens').length,
  };

  async function handleStop(s: ScheduledMessage) {
    setBusyId(s.id);
    try {
      await stopScheduledMessage(s.id);
      toast('⏹️ Schedule stopped — unused tokens refunded.');
      onTokensChanged();
      await load();
    } catch (e) { toast(`❌ ${e instanceof Error ? e.message : 'Could not stop schedule.'}`); }
    setBusyId(null);
  }

  async function handleDelete(s: ScheduledMessage) {
    setBusyId(s.id);
    try {
      await deleteScheduledMessage(s.id);
      toast('🗑️ Schedule deleted.');
      await load();
    } catch (e) { toast(`❌ ${e instanceof Error ? e.message : 'Could not delete schedule.'}`); }
    setBusyId(null);
  }

  async function handleReschedule(s: ScheduledMessage) {
    if (!rescheduleDate) return;
    setBusyId(s.id);
    try {
      await rescheduleCompletedMessage({ id: s.id, startDate: rescheduleDate, endDate: s.frequency === 'once' ? undefined : rescheduleDate });
      toast('🔁 Schedule re-created for the new date.');
      onTokensChanged();
      setReschedulingId(null);
      setRescheduleDate('');
      await load();
    } catch (e) { toast(`❌ ${e instanceof Error ? e.message : 'Could not reschedule.'}`); }
    setBusyId(null);
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div className="tab-bar">
          {(['all', 'active', 'insufficientTokens', 'stopped', 'completed'] as (ScheduleStatus | 'all')[]).map(f => (
            <button key={f} className={`tab-btn ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : SCHEDULE_STATUS_LABELS[f]}
              {f === 'active' && counts.active > 0 ? ` (${counts.active})` : ''}
              {f === 'insufficientTokens' && counts.insufficientTokens > 0 ? ` (${counts.insufficientTokens})` : ''}
            </button>
          ))}
        </div>
        <button className="btn-primary" onClick={() => { setEditing(null); setShowComposer(true); }}>+ New Schedule</button>
      </div>

      {counts.insufficientTokens > 0 && (
        <div className="notice notice-warning">
          ⚠️ {counts.insufficientTokens} schedule{counts.insufficientTokens > 1 ? 's need' : ' needs'} a token top-up to resume — they'll reactivate automatically once tokens are added.
        </div>
      )}

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Audience</th>
                <th>Message</th>
                <th>Frequency</th>
                <th>Next run</th>
                <th>Tokens</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24 }}>Loading…</td></tr>}
              {!loading && visible.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--text-3)' }}>No schedules here yet.</td></tr>
              )}
              {visible.map(s => (
                <tr key={s.id}>
                  <td>
                    <div className="td-name">{SCHEDULE_AUDIENCE_LABELS[s.audienceType]}</div>
                    {s.classCode && <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{s.classCode}</div>}
                  </td>
                  <td style={{ maxWidth: 220 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.messageBody}</div>
                  </td>
                  <td>{SCHEDULE_FREQUENCY_LABELS[s.frequency]}</td>
                  <td className="td-mono">{fmtDateTime(s.nextRunAt)}</td>
                  <td className="td-mono">{s.tokensUsed}/{s.tokensRequired}</td>
                  <td><span className={`tag ${STATUS_TAG_CLASS[s.status]}`}>{SCHEDULE_STATUS_LABELS[s.status]}</span></td>
                  <td>
                    <div className="td-actions">
                      {(s.status === 'active' || s.status === 'insufficientTokens') && (
                        <>
                          <button className="btn-xs btn-xs-gray" onClick={() => { setEditing(s); setShowComposer(true); }} disabled={busyId === s.id}>Edit</button>
                          <button className="btn-xs btn-xs-red" onClick={() => handleStop(s)} disabled={busyId === s.id}>Stop</button>
                        </>
                      )}
                      {s.status === 'completed' && reschedulingId !== s.id && (
                        <button className="btn-xs btn-xs-mint" onClick={() => { setReschedulingId(s.id); setRescheduleDate(new Date().toISOString().slice(0, 10)); }}>Reschedule</button>
                      )}
                      {reschedulingId === s.id && (
                        <>
                          <input className="form-input" type="date" style={{ padding: '4px 8px', fontSize: 12, width: 130 }}
                            value={rescheduleDate} onChange={e => setRescheduleDate(e.target.value)} />
                          <button className="btn-xs btn-xs-mint" onClick={() => handleReschedule(s)} disabled={busyId === s.id}>Go</button>
                          <button className="btn-xs btn-xs-gray" onClick={() => setReschedulingId(null)}>✕</button>
                        </>
                      )}
                      {(s.status === 'stopped' || s.status === 'completed') && (
                        <button className="btn-xs btn-xs-gray" onClick={() => handleDelete(s)} disabled={busyId === s.id}>Delete</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ScheduleComposerModal
        isOpen={showComposer}
        onClose={() => { setShowComposer(false); setEditing(null); }}
        onSaved={async () => { await load(); onTokensChanged(); toast(editing ? '✅ Schedule updated.' : '✅ Schedule created.'); }}
        schoolId={schoolId}
        boardingType={boardingType}
        currentUserRole={currentUserRole}
        assignedClasses={assignedClasses}
        classOptions={classOptions}
        tokensAvailable={tokensAvailable}
        editing={editing}
      />
    </>
  );
}
