import { useState } from 'react';

interface Props {
  activeClass: string;
  classes: string[];         // classes this teacher is assigned to (or full school list for admins)
  onSwitch: (classCode: string) => void;
  isAdmin?: boolean;
  allSchoolLabel?: string;   // if provided, admins get an "All School" option at the top
}

/**
 * Lets a teacher assigned to multiple classes switch which one is "active" in the dashboard.
 * Switching updates local state immediately — attendance, reports, students, messaging, and
 * analytics all read from that same active-class state, so nothing needs a page reload.
 * Renders nothing for a single-class teacher, since there's nothing to switch between.
 */
export default function ClassSwitcher({ activeClass, classes, onSwitch, isAdmin, allSchoolLabel }: Props) {
  const [open, setOpen] = useState(false);
  const options = allSchoolLabel ? [allSchoolLabel, ...classes] : classes;

  if (!isAdmin && classes.length <= 1) return null;

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        className="btn-secondary"
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}
        title="Switch class"
      >
        🏫 {activeClass} <span style={{ fontSize: 10, opacity: 0.6 }}>▾</span>
      </button>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setOpen(false)} />
          <div
            style={{
              position: 'absolute', top: '110%', left: 0, zIndex: 41, minWidth: 180,
              background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
              boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: 6, maxHeight: 320, overflowY: 'auto',
            }}
          >
            {options.map(c => (
              <button
                key={c}
                onClick={() => { onSwitch(c); setOpen(false); }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px',
                  borderRadius: 6, border: 'none', background: c === activeClass ? 'var(--surface-2)' : 'transparent',
                  fontWeight: c === activeClass ? 700 : 500, cursor: 'pointer', fontSize: 13, color: 'var(--ink)',
                }}
              >
                {c === activeClass && '✓ '}{c}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
