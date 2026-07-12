interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Shared confirmation dialog — reuses the app's existing .modal-overlay/.modal styling. */
export default function ConfirmDialog({
  title, message, confirmLabel = 'Confirm', danger, busy, error, onConfirm, onCancel,
}: Props) {
  return (
    <div className="modal-overlay open" onClick={e => { if (e.target === e.currentTarget && !busy) onCancel(); }}>
      <div className="modal" style={{ maxWidth: 420, width: '95vw' }}>
        <div className="modal-header">
          <span className="modal-title">{title}</span>
          {!busy && <button className="modal-close" onClick={onCancel}>✕</button>}
        </div>
        <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6, marginBottom: 16 }}>{message}</p>
        {error && <div className="error-msg" style={{ marginBottom: 12 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            className={danger ? 'btn-secondary' : 'btn-primary'}
            style={danger ? { flex: 1, justifyContent: 'center', color: '#e84545', borderColor: '#e84545' } : { flex: 1, justifyContent: 'center' }}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
          <button className="btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
