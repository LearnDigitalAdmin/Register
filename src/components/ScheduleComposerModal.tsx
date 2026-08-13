import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import {
  ScheduledMessage, ScheduleAudienceType, ScheduleFrequency, ScheduleFundingSource,
  BoardingType, Student, UserRole, UserProfile,
  SCHEDULE_AUDIENCE_LABELS, SCHEDULE_FREQUENCY_LABELS,
  sanitiseSmsText, containsLink, stripLinks,
  calcScheduleOccurrenceTokenCost, calcScheduleTotalTokenCost,
} from '../types';
import { isDateBlockedForSchool, HolidayPeriodRange } from '../utils/kenyanHolidays';
import { countOccurrences, findNextValidDate } from '../utils/scheduleCalendar';
import { listSchoolHolidays } from '../services/holidayService';
import { createScheduledMessage, editScheduledMessage, estimateRecipientCount } from '../services/scheduleService';

const WRAPPER_PADDING_CHARS = 45; // rough allowance for "Dear X,\n...\nSchool: phone" wrapper

interface TeacherOption { uid: string; name: string; }

export default function ScheduleComposerModal({
  isOpen, onClose, onSaved,
  schoolId, boardingType,
  currentUserRole, assignedClasses, classOptions,
  tokensAvailable, editing,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  schoolId: string;
  boardingType?: BoardingType;
  currentUserRole: UserRole;
  assignedClasses: string[];
  classOptions: string[];
  tokensAvailable: number;
  editing?: ScheduledMessage | null;
}) {
  const isTeacher = currentUserRole === 'teacherAdmin';
  const isHolidayNotice = editing?.audienceType === 'holiday_notice';

  const teacherAllowedAudiences: ScheduleAudienceType[] = ['parents_class', 'parents_selected'];
  const adminAudiences: ScheduleAudienceType[] = ['teachers_all', 'teachers_selected', 'parents_school', 'parents_class', 'parents_selected'];
  const availableAudiences = isTeacher ? teacherAllowedAudiences : adminAudiences;

  const [audienceType, setAudienceType] = useState<ScheduleAudienceType>(editing?.audienceType || availableAudiences[0]);
  const [classCode, setClassCode] = useState(editing?.classCode || assignedClasses[0] || '');
  const [teacherOptions, setTeacherOptions] = useState<TeacherOption[]>([]);
  const [selectedTeacherUids, setSelectedTeacherUids] = useState<string[]>(editing?.recipientUids || []);
  const [studentSearch, setStudentSearch] = useState('');
  const [classStudents, setClassStudents] = useState<Student[]>([]);
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>(editing?.recipientStudentIds || []);

  const [messageBody, setMessageBody] = useState(editing?.messageBody || '');
  const [frequency, setFrequency] = useState<ScheduleFrequency>(editing?.frequency || 'once');
  const [timeOfDay, setTimeOfDay] = useState(editing?.timeOfDay || '07:00');
  const [startDate, setStartDate] = useState(editing?.startDate || new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(editing?.endDate || '');
  const [includeWeekends, setIncludeWeekends] = useState(editing?.includeWeekends ?? false);
  const [fundingSource, setFundingSource] = useState<ScheduleFundingSource>(editing?.fundingSource || 'own');

  const [holidayRanges, setHolidayRanges] = useState<HolidayPeriodRange[]>([]);
  const [recipientCount, setRecipientCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Load this school's custom holiday periods once, for the live occurrence/cost preview.
  useEffect(() => {
    if (!isOpen || !schoolId) return;
    listSchoolHolidays(schoolId).then(list => setHolidayRanges(list.map(h => ({ startDate: h.startDate, endDate: h.endDate })))).catch(() => {});
  }, [isOpen, schoolId]);

  // Load teacher options when needed (admin, teachers_all/teachers_selected).
  useEffect(() => {
    if (!isOpen || isTeacher) return;
    if (audienceType !== 'teachers_selected') return;
    getDocs(query(collection(db, 'users'), where('schoolId', '==', schoolId), where('role', '==', 'teacherAdmin')))
      .then(snap => setTeacherOptions(snap.docs.map(d => ({ uid: d.id, name: (d.data() as UserProfile).displayName || 'Teacher' }))))
      .catch(() => {});
  }, [isOpen, isTeacher, audienceType, schoolId]);

  // Load students for the active class when picking individual parents.
  useEffect(() => {
    if (!isOpen) return;
    if (audienceType !== 'parents_selected') return;
    const cc = classCode || (isTeacher ? assignedClasses[0] : '');
    if (!cc) return; // no class picked yet — leave the previous list as-is rather than setState synchronously here
    getDocs(query(collection(db, 'students'), where('schoolId', '==', schoolId), where('classCode', '==', cc)))
      .then(snap => setClassStudents(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Student, 'id'>) }))))
      .catch(() => {});
  }, [isOpen, audienceType, classCode, schoolId, isTeacher, assignedClasses]);

  // Live recipient-count estimate, re-derived whenever the audience selection changes.
  useEffect(() => {
    if (!isOpen) return;
    estimateRecipientCount({
      schoolId, audienceType, classCode: classCode || undefined,
      recipientUids: selectedTeacherUids, recipientStudentIds: selectedStudentIds,
    }).then(setRecipientCount).catch(() => setRecipientCount(0));
  }, [isOpen, schoolId, audienceType, classCode, selectedTeacherUids, selectedStudentIds]);

  const isBlocked = useMemo(
    () => (dateStr: string) => isDateBlockedForSchool(dateStr, boardingType, holidayRanges, includeWeekends).blocked,
    [boardingType, holidayRanges, includeWeekends],
  );

  const cleanedBody = useMemo(() => stripLinks(sanitiseSmsText(messageBody)), [messageBody]);
  const linkWarning = useMemo(() => containsLink(messageBody), [messageBody]);

  const preview = useMemo(() => {
    if (!cleanedBody.trim() || !startDate) return null;
    if (frequency !== 'once' && !endDate) return null;
    const occurrencesPlanned = countOccurrences(frequency, startDate, endDate || undefined, isBlocked);
    if (occurrencesPlanned === 0) return { occurrencesPlanned: 0, occurrenceCost: 0, totalCost: 0, firstDate: null as string | null };
    const firstDate = findNextValidDate(frequency, startDate, isBlocked, endDate || undefined);
    const paddedBody = cleanedBody + ' '.repeat(WRAPPER_PADDING_CHARS);
    const occurrenceCost = calcScheduleOccurrenceTokenCost(paddedBody, recipientCount || 0);
    const totalCost = calcScheduleTotalTokenCost(occurrenceCost, occurrencesPlanned);
    return { occurrencesPlanned, occurrenceCost, totalCost, firstDate };
  }, [cleanedBody, startDate, endDate, frequency, isBlocked, recipientCount]);

  if (!isOpen) return null;

  const audienceNeedsClass = audienceType === 'parents_class' || (audienceType === 'parents_selected');
  const canSubmit =
    !!cleanedBody.trim() &&
    !!startDate &&
    (frequency === 'once' || !!endDate) &&
    recipientCount > 0 &&
    !saving &&
    (audienceType !== 'teachers_selected' || selectedTeacherUids.length > 0) &&
    (audienceType !== 'parents_selected' || selectedStudentIds.length > 0) &&
    (!audienceNeedsClass || audienceType === 'parents_selected' || !!classCode);

  async function handleSubmit() {
    setError('');
    setSaving(true);
    try {
      const payload = {
        schoolId,
        audienceType,
        classCode: audienceNeedsClass ? (classCode || undefined) : undefined,
        recipientUids: audienceType === 'teachers_selected' ? selectedTeacherUids : undefined,
        recipientStudentIds: audienceType === 'parents_selected' ? selectedStudentIds : undefined,
        messageBody: cleanedBody,
        frequency,
        timeOfDay,
        startDate,
        endDate: frequency === 'once' ? undefined : endDate,
        includeWeekends,
      };
      if (editing) {
        await editScheduledMessage({ ...payload, id: editing.id });
      } else {
        await createScheduledMessage({ ...payload, fundingSource: isTeacher ? fundingSource : 'own' });
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save this schedule.');
    }
    setSaving(false);
  }

  return (
    <div className="modal-overlay open" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ width: 620 }}>
        <div className="modal-header">
          <span className="modal-title">{editing ? 'Edit Schedule' : 'New Scheduled Message'}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {error && <div className="error-msg">{error}</div>}

        {!isHolidayNotice && (
          <div className="form-group">
            <label className="form-label">Who is this for?</label>
            <select className="form-select" value={audienceType} disabled={!!editing}
              onChange={e => setAudienceType(e.target.value as ScheduleAudienceType)}>
              {availableAudiences.map(a => <option key={a} value={a}>{SCHEDULE_AUDIENCE_LABELS[a]}</option>)}
            </select>
          </div>
        )}
        {isHolidayNotice && (
          <div className="notice notice-info">
            This is a {editing?.holidayNoticeVariant === 'goodbye' ? 'goodbye' : 'welcome-back'} message linked to a holiday period — edit it from Settings → Holidays to change dates, or adjust the message and timing here.
          </div>
        )}

        {audienceType === 'parents_class' && (
          <div className="form-group">
            <label className="form-label">Class</label>
            <select className="form-select" value={classCode} onChange={e => setClassCode(e.target.value)}>
              <option value="">Select a class…</option>
              {(isTeacher ? assignedClasses : classOptions).map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        )}

        {audienceType === 'teachers_selected' && (
          <div className="form-group">
            <label className="form-label">Teachers ({selectedTeacherUids.length} selected)</label>
            <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10, padding: 8 }}>
              {teacherOptions.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-3)', padding: 8 }}>No teachers found.</div>}
              {teacherOptions.map(t => (
                <label key={t.uid} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', fontSize: 13 }}>
                  <input type="checkbox" checked={selectedTeacherUids.includes(t.uid)}
                    onChange={e => setSelectedTeacherUids(prev => e.target.checked ? [...prev, t.uid] : prev.filter(u => u !== t.uid))} />
                  {t.name}
                </label>
              ))}
            </div>
          </div>
        )}

        {audienceType === 'parents_selected' && (
          <>
            {!isTeacher && (
              <div className="form-group">
                <label className="form-label">Class</label>
                <select className="form-select" value={classCode} onChange={e => setClassCode(e.target.value)}>
                  <option value="">Select a class…</option>
                  {classOptions.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}
            <div className="form-group">
              <label className="form-label">Students ({selectedStudentIds.length} selected)</label>
              <div className="search-bar" style={{ marginBottom: 8 }}>
                <input placeholder="Search by name…" value={studentSearch} onChange={e => setStudentSearch(e.target.value)} style={{ width: '100%' }} />
              </div>
              <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10, padding: 8 }}>
                {classStudents.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-3)', padding: 8 }}>Pick a class to see students.</div>}
                {classStudents
                  .filter(s => s.name.toLowerCase().includes(studentSearch.toLowerCase()))
                  .map(s => (
                    <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px', fontSize: 13 }}>
                      <input type="checkbox" checked={selectedStudentIds.includes(s.id)}
                        onChange={e => setSelectedStudentIds(prev => e.target.checked ? [...prev, s.id] : prev.filter(id => id !== s.id))} />
                      {s.name} <span style={{ color: 'var(--text-3)' }}>({s.parentName || 'no parent name'})</span>
                    </label>
                  ))}
              </div>
            </div>
          </>
        )}

        <div className="form-group">
          <label className="form-label">Message</label>
          <textarea className="form-input" rows={4} value={messageBody} onChange={e => setMessageBody(e.target.value)}
            placeholder="Write the message body — no links, emojis, or special characters." />
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>{cleanedBody.length} characters</div>
          {linkWarning && <div className="notice notice-warning" style={{ marginTop: 8 }}>Links aren't allowed in scheduled messages — they'll be removed automatically.</div>}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div className="form-group">
            <label className="form-label">Frequency</label>
            <select className="form-select" value={frequency} onChange={e => setFrequency(e.target.value as ScheduleFrequency)}>
              {(['once', 'daily', 'weekly'] as ScheduleFrequency[]).map(f => <option key={f} value={f}>{SCHEDULE_FREQUENCY_LABELS[f]}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Time of day</label>
            <input className="form-input" type="time" value={timeOfDay} onChange={e => setTimeOfDay(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">{frequency === 'once' ? 'Send on' : 'Start date'}</label>
            <input className="form-input" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
          </div>
          {frequency !== 'once' && (
            <div className="form-group">
              <label className="form-label">End date</label>
              <input className="form-input" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} min={startDate} />
            </div>
          )}
        </div>

        {frequency !== 'once' && (
          <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className={`toggle ${includeWeekends ? 'on' : 'off'}`} onClick={() => setIncludeWeekends(v => !v)}>
              <div className="toggle-knob" />
            </div>
            <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Include weekends</span>
          </div>
        )}

        {isTeacher && (
          <div className="form-group">
            <label className="form-label">Funded by</label>
            <div className="tab-bar">
              <button type="button" className={`tab-btn ${fundingSource === 'own' ? 'active' : ''}`} onClick={() => setFundingSource('own')}>My tokens</button>
              <button type="button" className={`tab-btn ${fundingSource === 'school' ? 'active' : ''}`} onClick={() => setFundingSource('school')}>School tokens</button>
            </div>
          </div>
        )}

        {preview && (
          <div className="card" style={{ margin: '16px 0 4px', background: 'var(--surface-2)' }}>
            <div className="card-body" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: .5 }}>Recipients</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink)' }}>{recipientCount}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: .5 }}>Sends</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink)' }}>{preview.occurrencesPlanned}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: .5 }}>Tokens needed</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: preview.totalCost > tokensAvailable ? 'var(--red)' : 'var(--ink)' }}>{preview.totalCost}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: .5 }}>Available</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink)' }}>{tokensAvailable}</div>
              </div>
            </div>
            {preview.occurrencesPlanned === 0 && (
              <div className="notice notice-warning" style={{ margin: '0 20px 16px' }}>
                Every date in this range is a weekend or holiday — adjust the dates or enable weekends.
              </div>
            )}
            {preview.totalCost > tokensAvailable && preview.occurrencesPlanned > 0 && (
              <div className="notice notice-warning" style={{ margin: '0 20px 16px' }}>
                This will be created with what's available and flagged "Needs top-up" until you add more tokens.
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
          <button className="btn-primary" disabled={!canSubmit} onClick={handleSubmit}>
            {saving ? '⏳ Saving…' : editing ? 'Save Changes' : 'Create Schedule'}
          </button>
          <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
