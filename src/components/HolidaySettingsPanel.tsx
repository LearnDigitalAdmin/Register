import { useEffect, useState } from 'react';
import { HolidayPeriod } from '../types';
import { listSchoolHolidays, createHolidayPeriod, deleteHolidayPeriod } from '../services/holidayService';

const emptyForm = {
  name: '', startDate: '', endDate: '', kind: 'custom' as 'public' | 'custom',
  sendGoodbye: false, goodbyeMessage: '',
  sendWelcomeBack: false, welcomeBackMessage: '',
};

export default function HolidaySettingsPanel({
  schoolId, currentUserUid, toast,
}: {
  schoolId: string;
  currentUserUid: string;
  toast: (msg: string) => void;
}) {
  const [holidays, setHolidays] = useState<HolidayPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try { setHolidays(await listSchoolHolidays(schoolId)); } catch (e) { console.error(e); }
    setLoading(false);
  }

  useEffect(() => { if (schoolId) load(); }, [schoolId]);

  const isSingleDay = form.startDate && form.endDate && form.startDate === form.endDate;

  async function handleSave() {
    if (!form.name.trim() || !form.startDate) return;
    setSaving(true);
    try {
      await createHolidayPeriod({
        schoolId,
        name: form.name.trim(),
        startDate: form.startDate,
        endDate: form.endDate || form.startDate,
        kind: form.kind,
        sendGoodbye: form.sendGoodbye,
        goodbyeMessage: form.goodbyeMessage,
        sendWelcomeBack: form.sendWelcomeBack,
        welcomeBackMessage: form.welcomeBackMessage,
        createdBy: currentUserUid,
      });
      toast('✅ Holiday period added — reminders and any linked schedules will skip these dates.');
      setForm(emptyForm);
      setShowForm(false);
      await load();
    } catch (e) {
      toast(`❌ ${e instanceof Error ? e.message : 'Could not save holiday period.'}`);
    }
    setSaving(false);
  }

  async function handleDelete(h: HolidayPeriod) {
    try {
      await deleteHolidayPeriod(h);
      toast('🗑️ Holiday period removed.');
      await load();
    } catch (e) {
      toast(`❌ ${e instanceof Error ? e.message : 'Could not remove holiday.'}`);
    }
  }

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">School Holidays</span>
        <button className="btn-secondary" style={{ fontSize: 13 }} onClick={() => setShowForm(v => !v)}>
          {showForm ? 'Cancel' : '+ Add Holiday'}
        </button>
      </div>
      <div className="card-body">
        <div className="notice notice-info">
          No register reminders or scheduled messages run on a date covered here — public or custom.
        </div>

        {showForm && (
          <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Name</label>
                <input className="form-input" placeholder="e.g. Mid-Term Break" value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Type</label>
                <select className="form-select" value={form.kind} onChange={e => setForm(p => ({ ...p, kind: e.target.value as 'public' | 'custom' }))}>
                  <option value="custom">Custom (e.g. mid-term break)</option>
                  <option value="public">Public holiday (added manually)</option>
                </select>
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Start date</label>
                <input className="form-input" type="date" value={form.startDate} onChange={e => setForm(p => ({ ...p, startDate: e.target.value }))} />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">End date <span style={{ textTransform: 'none', fontWeight: 400 }}>(same as start = single day)</span></label>
                <input className="form-input" type="date" value={form.endDate} min={form.startDate} onChange={e => setForm(p => ({ ...p, endDate: e.target.value }))} />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div className={`toggle ${form.sendGoodbye ? 'on' : 'off'}`} onClick={() => setForm(p => ({ ...p, sendGoodbye: !p.sendGoodbye }))}>
                  <div className="toggle-knob" />
                </div>
                Send a goodbye message to parents when the holiday starts
              </label>
              {form.sendGoodbye && (
                <textarea className="form-input" rows={2} style={{ marginTop: 8 }}
                  placeholder="e.g. School closes today for mid-term break. Enjoy the holiday!"
                  value={form.goodbyeMessage} onChange={e => setForm(p => ({ ...p, goodbyeMessage: e.target.value }))} />
              )}
            </div>

            <div className="form-group">
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div className={`toggle ${form.sendWelcomeBack ? 'on' : 'off'}`} onClick={() => setForm(p => ({ ...p, sendWelcomeBack: !p.sendWelcomeBack }))}>
                  <div className="toggle-knob" />
                </div>
                Send a welcome-back message the day after it ends
              </label>
              {form.sendWelcomeBack && (
                <textarea className="form-input" rows={2} style={{ marginTop: 8 }}
                  placeholder="e.g. Welcome back! School resumes today."
                  value={form.welcomeBackMessage} onChange={e => setForm(p => ({ ...p, welcomeBackMessage: e.target.value }))} />
              )}
            </div>

            {!isSingleDay && form.startDate && !form.endDate && (
              <div className="notice notice-warning">Set an end date, or leave it equal to the start date for a single-day holiday.</div>
            )}

            <button className="btn-primary" disabled={saving || !form.name.trim() || !form.startDate} onClick={handleSave}>
              {saving ? '⏳ Saving…' : 'Save Holiday'}
            </button>
          </div>
        )}

        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Dates</th><th>Type</th><th>Notices</th><th></th></tr></thead>
            <tbody>
              {loading && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 20 }}>Loading…</td></tr>}
              {!loading && holidays.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', padding: 20, color: 'var(--text-3)' }}>No holidays set up yet.</td></tr>}
              {holidays.map(h => (
                <tr key={h.id}>
                  <td className="td-name">{h.name}</td>
                  <td className="td-mono">{h.startDate === h.endDate ? h.startDate : `${h.startDate} → ${h.endDate}`}</td>
                  <td><span className={`tag ${h.kind === 'public' ? 'tag-blue' : 'tag-gray'}`}>{h.kind}</span></td>
                  <td style={{ fontSize: 12, color: 'var(--text-2)' }}>
                    {h.sendGoodbye && '👋 Goodbye '}{h.sendWelcomeBack && '🎒 Welcome back'}
                    {!h.sendGoodbye && !h.sendWelcomeBack && '—'}
                  </td>
                  <td><button className="btn-xs btn-xs-red" onClick={() => handleDelete(h)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
