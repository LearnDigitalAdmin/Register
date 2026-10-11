import { useEffect, useRef, useState } from 'react';
import {
  DeskRequestRow, REQUEST_CATEGORIES, createDeskRequest, listDeskRequests, newClientToken, readableError,
} from '../services/deskService';

function statusLabel(r: DeskRequestRow): { text: string; cls: string } {
  if (r.status === 'rejected') return { text: 'Not accepted', cls: 'tag-red' };
  if (r.status === 'new') return { text: 'Sent — waiting for support', cls: 'tag-gray' };
  switch (r.deskStatus) {
    case 'answered': return { text: 'Answered', cls: 'tag-mint' };
    case 'closed': return { text: 'Closed', cls: 'tag-gray' };
    case 'open': return { text: 'In progress', cls: 'tag-blue' };
    default: return { text: 'Received', cls: 'tag-blue' };
  }
}

export default function DeskRequestsPanel({ toast }: { toast: (msg: string) => void }) {
  const [rows, setRows] = useState<DeskRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [category, setCategory] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState('');
  const token = useRef(newClientToken());

  async function load() {
    setLoading(true); setLoadError('');
    try { setRows(await listDeskRequests()); }
    catch (e) { setLoadError(readableError(e, 'Could not load your requests.')); }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function send() {
    if (sending) return;
    setSending(true); setFormError('');
    try {
      await createDeskRequest({ category, subject, message, clientToken: token.current });
      toast('✅ Request sent to support.');
      token.current = newClientToken();
      setCategory(''); setSubject(''); setMessage(''); setShowForm(false);
      await load();
    } catch (e) { setFormError(readableError(e, 'Could not send your request. Please try again.')); }
    setSending(false);
  }

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Your requests to support</span>
        <button className="btn-secondary" style={{ fontSize: 13 }} onClick={() => setShowForm(v => !v)}>
          {showForm ? 'Cancel' : '+ New request'}
        </button>
      </div>
      <div className="card-body">
        {showForm && (
          <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
            <div className="form-group">
              <label className="form-label">What is it about?</label>
              <select className="form-select" value={category} onChange={e => setCategory(e.target.value)}>
                <option value="">Choose…</option>
                {REQUEST_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Subject</label>
              <input className="form-input" maxLength={120} value={subject} onChange={e => setSubject(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Details</label>
              <textarea className="form-input" rows={5} maxLength={2000} value={message} onChange={e => setMessage(e.target.value)} />
            </div>
            {formError && <div className="notice notice-warning">{formError}</div>}
            <button className="btn-primary" disabled={sending || !category || subject.trim().length < 3 || message.trim().length < 10} onClick={send}>
              {sending ? '⏳ Sending…' : 'Send request'}
            </button>
          </div>
        )}
        {loadError && <div className="notice notice-warning">{loadError} <button className="btn-xs" onClick={load}>Retry</button></div>}
        {loading && <div style={{ textAlign: 'center', padding: 20 }}>Loading…</div>}
        {!loading && !loadError && rows.length === 0 && (
          <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-3)' }}>You have not sent any requests yet.</div>
        )}
        {rows.map(r => {
          const s = statusLabel(r);
          return (
            <div key={r.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <strong style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{r.subject}</strong>
                <span className={`tag ${s.cls}`}>{s.text}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', margin: '4px 0 8px' }}>
                {new Date(r.createdAt).toLocaleString()} · {REQUEST_CATEGORIES.find(c => c.id === r.category)?.label || r.category}
              </div>
              <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 14 }}>{r.message}</div>
              {r.responses.map((resp, i) => (
                <div key={i} style={{ marginTop: 10, padding: 10, background: 'var(--surface-2, #f5f5f5)', borderRadius: 8 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Support ({resp.byDeskCode}) · {new Date(resp.at).toLocaleString()}</div>
                  <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 14 }}>{resp.text}</div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
