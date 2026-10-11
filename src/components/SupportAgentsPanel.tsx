import { useEffect, useState } from 'react';
import { SupportAgentRow, addSupportAgent, listSupportAgents, readableError, removeSupportAgent } from '../services/deskService';

export default function SupportAgentsPanel({ toast }: { toast: (msg: string) => void }) {
  const [agents, setAgents] = useState<SupportAgentRow[]>([]);
  const [max, setMax] = useState(10);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState('');

  async function load() {
    setLoading(true); setLoadError('');
    try { const r = await listSupportAgents(); setAgents(r.agents); setMax(r.max); }
    catch (e) { setLoadError(readableError(e, 'Could not load support agents.')); }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function add() {
    if (!code.trim() || busy) return;
    setBusy(true);
    try {
      const r = await addSupportAgent(code.trim());
      toast(r.alreadyConnected ? 'ℹ️ That agent is already connected.' : '✅ Support agent connected.');
      setCode('');
      await load();
    } catch (e) { toast(`❌ ${readableError(e, 'Could not connect that agent.')}`); }
    setBusy(false);
  }

  async function remove(a: SupportAgentRow) {
    if (a.locked || removing) return;
    setRemoving(a.agentCode);
    try { await removeSupportAgent(a.agentCode); toast('🗑️ Support agent removed.'); await load(); }
    catch (e) { toast(`❌ ${readableError(e, 'Could not remove that agent.')}`); }
    setRemoving('');
  }

  return (
    <div className="card">
      <div className="card-header"><span className="card-title">Support Agents</span></div>
      <div className="card-body">
        <div className="notice notice-info">
          Support agents help with imports, reports and SMS on your behalf. Only agents listed here can act for your school.
          The main support desk (COG-0000) is always connected.
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          <input className="form-input" style={{ flex: '1 1 180px', minWidth: 0 }} placeholder="Agent code, e.g. COG-0001"
            value={code} onChange={e => setCode(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(); }} />
          <button className="btn-primary" disabled={busy || !code.trim() || agents.length >= max} onClick={add}>
            {busy ? '⏳ Connecting…' : 'Connect agent'}
          </button>
        </div>
        {loadError && (
          <div className="notice notice-warning">{loadError} <button className="btn-xs" onClick={load}>Retry</button></div>
        )}
        <div className="table-wrap">
          <table>
            <thead><tr><th>Agent code</th><th>Name</th><th></th></tr></thead>
            <tbody>
              {loading && <tr><td colSpan={3} style={{ textAlign: 'center', padding: 20 }}>Loading…</td></tr>}
              {!loading && !loadError && agents.length === 0 && <tr><td colSpan={3} style={{ textAlign: 'center', padding: 20, color: 'var(--text-3)' }}>No agents connected.</td></tr>}
              {agents.map(a => (
                <tr key={a.agentCode}>
                  <td className="td-mono">{a.agentCode}</td>
                  <td>{a.name || '—'}</td>
                  <td>
                    {a.locked
                      ? <span className="tag tag-gray">🔒 Always connected</span>
                      : <button className="btn-xs btn-xs-red" disabled={removing === a.agentCode} onClick={() => remove(a)}>{removing === a.agentCode ? '…' : 'Remove'}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
