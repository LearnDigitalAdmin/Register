import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import {
  collection, query, where, getDocs, addDoc, doc,
  updateDoc, setDoc, orderBy, limit, getDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  Student, AttendanceStatus, Message,
  sanitiseSmsText,
  getSmsTier, KES_RATE_PER_TOKEN,
  TOKEN_PACKAGES, tokensToKes,
  ClassStructure, ImportSummary,
} from '../types';
import { getClassStructure } from '../services/academicYearService';
import { createEnrolment } from '../services/enrolmentService';
import {
  SchoolInfo,
  analyseComposedMessage,
  buildAttendanceSms,
  sendRegisterNotifications,
  sendBroadcast,
  extractBody,
} from '../services/messagingService';
import { useToast } from '../useToast';
import MpesaTopUpModal from '../components/MpesaTopUpModal';
import StudentProfileModal from '../components/StudentProfileModal';
import TermlyReportModal from '../components/TermlyReportModal';
import WeeklyReportModal from '../components/WeeklyReportModal';
import ClassSwitcher from '../components/ClassSwitcher';
import TransferDialog from '../components/TransferDialog';
import AssignmentManager from '../components/AssignmentManager';
import ChangeSchoolDialog from '../components/ChangeSchoolDialog';
// at the top with other imports
import ContactUs, { ContactButton } from '../components/ContactUs';
import AcademicYearPanel from '../components/AcademicYearPanel';
import StudentImportWizard from '../components/StudentImportWizard';


const STATUS_CYCLE: AttendanceStatus[] = ['present', 'absent', 'late', 'excused'];
const STATUS_LABEL: Record<AttendanceStatus, string> = { present: 'P', absent: 'A', late: 'L', excused: 'E' };

function todayStr() { return new Date().toISOString().slice(0, 10); }

type Panel = 'overview' | 'register' | 'students' | 'messages' | 'logs' | 'reports' | 'settings' | 'academicYears';

// ─── Compose box with live full-message preview ───────────────────────────────
function SmsComposeBox({
  body, onBodyChange, school, recipientCount, tokens, sending, onSend,
}: {
  body: string;
  onBodyChange: (v: string) => void;
  school: SchoolInfo;
  recipientCount: number;
  tokens: number;
  sending: boolean;
  onSend: () => void;
}) {
  const tier    = getSmsTier(recipientCount);
  const kesRate = KES_RATE_PER_TOKEN[tier];
  const { fullText, charCount, segments, tokenCost, isOver } =
    analyseComposedMessage(body, school, recipientCount);

  const notEnoughTokens = recipientCount > 0 && tokenCost > tokens;
  const canSend = body.trim().length > 0 && !isOver && !notEnoughTokens && recipientCount > 0 && !sending;

  return (
    <div>
      <div className="form-group">
        <label className="form-label">
          Message Body
          <span style={{
            marginLeft: 8, fontSize: 11, letterSpacing: 0, textTransform: 'none',
            fontWeight: 400, color: isOver ? 'var(--red)' : 'var(--text-3)',
          }}>
            {charCount}/400 chars · {segments} SMS part{segments !== 1 ? 's' : ''} · {tokenCost} tokens (≈ KES {(tokenCost * kesRate).toFixed(2)})
          </span>
        </label>
        <textarea
          className="form-input"
          rows={4}
          value={body}
          onChange={e => onBodyChange(e.target.value)}
          placeholder="Type your message body here…"
          style={{
            resize: 'vertical',
            fontFamily: "'DM Mono', monospace",
            fontSize: 13,
            lineHeight: 1.7,
            borderColor: isOver ? 'var(--red)' : notEnoughTokens ? 'var(--gold)' : undefined,
          }}
        />
        {body.trim().length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            <span style={{ background: 'rgba(44,111,173,.1)', color: 'var(--blue)', border: '1px solid rgba(44,111,173,.2)', borderRadius: 6, padding: '2px 8px', fontSize: 11 }}>
              🔵 Auto-header: "Dear Parent,"
            </span>
            <span style={{ background: 'rgba(0,200,150,.08)', color: 'var(--mint-d)', border: '1px solid rgba(0,200,150,.2)', borderRadius: 6, padding: '2px 8px', fontSize: 11 }}>
              ✏️ Your body (editable above)
            </span>
            <span style={{ background: 'rgba(245,166,35,.1)', color: '#c4800a', border: '1px solid rgba(245,166,35,.2)', borderRadius: 6, padding: '2px 8px', fontSize: 11 }}>
              🟡 Auto-footer: "{school.name}: {school.phone}"
            </span>
          </div>
        )}
        {body.trim().length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 6 }}>
              Full message preview (what parents receive)
            </div>
            <div style={{
              background: 'var(--surface-2)',
              border: `1px solid ${isOver ? 'rgba(232,69,69,.4)' : 'var(--border)'}`,
              borderRadius: 10, padding: '10px 14px',
              fontSize: 12, fontFamily: "'DM Mono', monospace",
              lineHeight: 1.8, whiteSpace: 'pre-wrap',
              color: 'var(--ink)',
              userSelect: 'all',
            }}>
              {fullText}
            </div>
          </div>
        )}
      </div>

      {isOver && (
        <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 10 }}>
          ⛔ Message too long (including header and footer). Shorten your body.
        </div>
      )}
      {notEnoughTokens && !isOver && (
        <div style={{ fontSize: 12, color: '#c4800a', marginBottom: 10 }}>
          ⚠️ Need {tokenCost} tokens but only {tokens} available.
        </div>
      )}

      {body.trim() && recipientCount > 0 && (
        <div style={{
          background: 'var(--surface-2)', border: `1px solid ${isOver ? 'rgba(232,69,69,.3)' : 'var(--border)'}`,
          borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 13,
        }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 20px', marginBottom: 6 }}>
            <span><span style={{ color: 'var(--text-2)' }}>Full length: </span><strong>{charCount} chars</strong></span>
            <span><span style={{ color: 'var(--text-2)' }}>Parts: </span><strong>{segments} × 140</strong></span>
            <span><span style={{ color: 'var(--text-2)' }}>Recipients: </span><strong>{recipientCount}</strong></span>
            <span><span style={{ color: 'var(--text-2)' }}>Rate: </span><strong>KES {kesRate}/token</strong></span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
              {segments} part{segments!==1?'s':''} × {recipientCount} = {tokenCost} tokens · ≈ KES {(tokenCost * kesRate).toFixed(2)}
            </span>
            <span style={{ fontWeight: 800, fontSize: 15, color: isOver ? 'var(--red)' : 'var(--mint-d)' }}>
              {isOver ? '⛔ Too long' : `🪙 ${tokenCost} tokens`}
            </span>
          </div>
        </div>
      )}

      <button
        className="btn-primary"
        style={{ width: '100%', justifyContent: 'center' }}
        onClick={onSend}
        disabled={!canSend}
      >
        {sending ? 'Sending…'
          : isOver ? '⛔ Message too long'
          : notEnoughTokens ? `⚠️ Need ${tokenCost} tokens`
          : recipientCount === 0 ? 'No recipients'
          : `📲 Send to ${recipientCount} parents — ${tokenCost} tokens`}
      </button>
    </div>
  );
}

// ─── Message log row ──────────────────────────────────────────────────────────
function MessageLogRow({ msg, onResend, onPreview }: {
  msg: Message; onResend: (m: Message) => void; onPreview: (m: Message) => void;
}) {
  const typeColors: Record<string, string> = {
    attendance: 'tag-blue', assignment: 'tag-gold', notice: 'tag-gray',
    activity: 'tag-mint', alert: 'tag-red', custom: 'tag-gray', system: 'tag-gray',
  };
  const statusColor = msg.status === 'sent' ? 'var(--mint-d)' : msg.status === 'failed' ? 'var(--red)' : 'var(--gold)';
  return (
    <tr>
      <td style={{ color: 'var(--text-3)', fontSize: 12, whiteSpace: 'nowrap' }}>
        {new Date(msg.sentAt).toLocaleDateString('en-KE', { day: '2-digit', month: 'short' })}<br />
        <span style={{ fontSize: 11 }}>{new Date(msg.sentAt).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}</span>
      </td>
      <td><span className={`tag ${typeColors[msg.type] || 'tag-gray'}`}>{msg.type}</span></td>
      <td style={{ maxWidth: 220 }}>
        <div style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{msg.content}</div>
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{msg.smsSegments} part{msg.smsSegments !== 1 ? 's' : ''} · {msg.content.length} chars</div>
      </td>
      <td>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{msg.recipients}</div>
        <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{msg.recipientCount} recipients</div>
      </td>
      <td style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-2)' }}>{msg.tokensUsed}</div>
        <div style={{ fontSize: 11, color: 'var(--text-3)' }}>KES {msg.costPerSegment}/tok</div>
      </td>
      <td>
        <span style={{
          fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 20,
          background: msg.status === 'sent' ? 'rgba(0,200,150,.1)' : msg.status === 'failed' ? 'rgba(232,69,69,.1)' : 'rgba(245,166,35,.1)',
          color: statusColor,
        }}>
          {msg.status === 'sent' ? `✓ ${msg.delivered}/${msg.total}` : msg.status === 'failed' ? '✗ Failed' : `~ ${msg.delivered}/${msg.total}`}
        </span>
      </td>
      <td className="td-actions">
        <button className="btn-xs btn-xs-mint" onClick={() => onPreview(msg)}>View</button>
        <button className="btn-xs btn-xs-gray" onClick={() => onResend(msg)}>Resend</button>
      </td>
    </tr>
  );
}

// ─── Mobile Drawer Nav ────────────────────────────────────────────────────────
function MobileDrawerNav({
  panel, setPanel, isAdmin, userProfile, tokens, onTopUp, onSignOut,
}: {
  panel: Panel; setPanel: (p: Panel) => void; isAdmin: boolean;
  userProfile: any; tokens: number; onTopUp: () => void; onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const [showContact, setShowContact] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const navItems: { id: Panel; icon: string; label: string; adminOnly?: boolean }[] = [
    { id: 'overview',  icon: '🏠', label: 'Overview' },
    { id: 'register',  icon: '📋', label: 'Register' },
    { id: 'students',  icon: '👥', label: 'Students' },
    { id: 'messages',  icon: '💬', label: 'Send SMS' },
    { id: 'logs',      icon: '🗂️', label: 'Msg Logs' },
    { id: 'reports',   icon: '📊', label: 'Reports' },
    { id: 'academicYears', icon: '🎓', label: 'Academic Years', adminOnly: true },
    { id: 'settings',  icon: '⚙️', label: 'Settings', adminOnly: true },
  ];

  const visible = navItems.filter(n => !n.adminOnly || isAdmin);

  const PANEL_LABEL: Record<Panel, string> = {
    overview: 'Overview', register: "Today's Register", students: 'Students',
    messages: 'Send SMS', logs: 'Message Logs', reports: 'Reports', settings: 'Settings',
    academicYears: 'Academic Years'
  };
  const PANEL_ICON: Record<Panel, string> = {
    overview: '🏠', register: '📋', students: '👥',
    messages: '💬', logs: '🗂️', reports: '📊', settings: '⚙️',
    academicYears: '📅'
  };

  function navigate(id: Panel) { setPanel(id); setOpen(false); }

  return (
    <>
      <div style={{
        display: 'none', position: 'fixed', bottom: 0, left: 0, right: 0,
        height: 54, background: 'var(--surface)', borderTop: '1px solid var(--border)',
        alignItems: 'center', justifyContent: 'space-between', padding: '0 20px 0 16px',
        zIndex: 190, fontFamily: "'Sora', sans-serif",
      }} className="mobile-bottom-strip">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>{PANEL_ICON[panel]}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{PANEL_LABEL[panel]}</span>
        </div>
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>☰ for menu</span>
      </div>

      <button
        aria-label={open ? 'Close navigation menu' : 'Open navigation menu'}
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'none', position: 'fixed', bottom: 70, right: 18,
          width: 52, height: 52, borderRadius: '50%', background: 'var(--ink)',
          border: 'none', cursor: 'pointer',
          flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 5, padding: 14, zIndex: 210,
          boxShadow: '0 4px 16px rgba(0,0,0,.28)', transition: 'transform .15s',
        }}
        className="mobile-fab"
        onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.07)')}
        onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
      >
        <span style={{ display: 'block', width: 20, height: 2, background: '#fff', borderRadius: 2, transition: 'transform .25s, opacity .2s', transform: open ? 'translateY(7px) rotate(45deg)' : 'none' }} />
        <span style={{ display: 'block', width: 20, height: 2, background: '#fff', borderRadius: 2, transition: 'opacity .2s', opacity: open ? 0 : 1 }} />
        <span style={{ display: 'block', width: 20, height: 2, background: '#fff', borderRadius: 2, transition: 'transform .25s, opacity .2s', transform: open ? 'translateY(-7px) rotate(-45deg)' : 'none' }} />
      </button>

      {open && (
        <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.52)', zIndex: 215, animation: 'fadeIn .2s ease' }} />
      )}

      <div ref={drawerRef} style={{
        display: 'none', position: 'fixed', bottom: 0, left: 0, right: 0,
        background: '#111210', borderRadius: '20px 20px 0 0', zIndex: 220,
        transform: open ? 'translateY(0)' : 'translateY(100%)',
        transition: 'transform .32s cubic-bezier(.32,0,.2,1)',
        paddingBottom: 'env(safe-area-inset-bottom, 12px)',
        maxHeight: '88vh', overflowY: 'auto',
      }} className="mobile-drawer">
        <div style={{ width: 36, height: 4, background: 'rgba(255,255,255,.18)', borderRadius: 2, margin: '12px auto 14px' }} />
        <div style={{ padding: '0 18px 14px', borderBottom: '1px solid rgba(255,255,255,.09)' }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: .7, textTransform: 'uppercase', color: 'rgba(255,255,255,.38)', marginBottom: 4 }}>
            {isAdmin ? '🏫 School Admin' : '👩‍🏫 Teacher'}
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#f0ede6' }}>{userProfile.schoolName}</div>
        </div>
        <div style={{ padding: '10px 18px 0' }}>
          <button onClick={() => { onTopUp(); setOpen(false); }} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(0,200,150,.12)', border: '1px solid rgba(0,200,150,.25)', borderRadius: 10, padding: '8px 14px', cursor: 'pointer', width: '100%', fontFamily: "'Sora', sans-serif" }}>
            <span style={{ fontSize: 15 }}>🪙</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#34d9a5' }}>{tokens} tokens</span>
            <span style={{ fontSize: 11, color: 'rgba(0,200,150,.55)', marginLeft: 'auto' }}>Top up →</span>
          </button>
        </div>
        <div style={{ padding: '14px 18px 6px', fontSize: 9, fontWeight: 700, letterSpacing: .8, textTransform: 'uppercase', color: 'rgba(255,255,255,.28)' }}>Navigation</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, padding: '0 12px' }}>
          {visible.map(n => {
            const active = panel === n.id;
            return (
              <button key={n.id} onClick={() => navigate(n.id)} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 12px', borderRadius: 10, background: active ? 'rgba(0,200,150,.15)' : 'rgba(255,255,255,.04)', border: active ? '1px solid rgba(0,200,150,.3)' : '1px solid rgba(255,255,255,.06)', cursor: 'pointer', fontFamily: "'Sora', sans-serif", fontSize: 13, fontWeight: 600, color: active ? '#34d9a5' : '#c8c4bc', textAlign: 'left', transition: 'background .15s, color .15s' }}>
                <span style={{ fontSize: 16, flexShrink: 0 }}>{n.icon}</span>
                {n.label}
              </button>
            );
          })}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px 4px', borderTop: '1px solid rgba(255,255,255,.09)', marginTop: 14 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#f0ede6', marginBottom: 2 }}>{userProfile.displayName}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.35)' }}>{userProfile.email}</div>
          </div>
          <ContactButton onClick={() => setShowContact(true)} variant="ghost" />
          <button onClick={() => { setOpen(false); onSignOut(); }} style={{ fontSize: 12, fontWeight: 600, padding: '7px 14px', border: '1px solid rgba(255,255,255,.18)', borderRadius: 8, background: 'transparent', color: 'rgba(255,255,255,.55)', cursor: 'pointer', fontFamily: "'Sora', sans-serif", transition: 'border-color .15s, color .15s' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,.45)'; e.currentTarget.style.color = '#f0ede6'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,.18)'; e.currentTarget.style.color = 'rgba(255,255,255,.55)'; }}
          >Sign Out</button>
        </div>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .mobile-bottom-strip { display: flex !important; }
          .mobile-fab           { display: flex !important; }
          .mobile-drawer        { display: block !important; }
          @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        }
      `}</style>
    </>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function AppDashboard() {
  const { user, userProfile, logOut, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const { toast, ToastEl } = useToast();
  const [panel, setPanel] = useState<Panel>('overview');
  const [showContact, setShowContact] = useState(false);

  const [students,        setStudents]        = useState<Student[]>([]);
  const [attendance,      setAttendance]      = useState<Record<string, AttendanceStatus>>({});
  const [notes,           setNotes]           = useState<Record<string, string>>({});
  const [registerLocked,  setRegisterLocked]  = useState(false);
  const [searchQ,         setSearchQ]         = useState('');
  const [attFilter,       setAttFilter]       = useState<AttendanceStatus | 'all'>('all');
  const [loading,         setLoading]         = useState(true);
  const [showAddStudent,  setShowAddStudent]  = useState(false);
  const [newStudent,      setNewStudent]      = useState({ name: '', parentName: '', parentPhone: '', parentWhatsApp: '' });
  const [showImportWizard, setShowImportWizard] = useState(false);

  const [msgBody,     setMsgBody]     = useState('');
  const [msgType,     setMsgType]     = useState('notice');
  const [msgTo,       setMsgTo]       = useState('All School');
  const [sendingMsg,  setSendingMsg]  = useState(false);

  const [msgLogs,     setMsgLogs]     = useState<Message[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [previewMsg,  setPreviewMsg]  = useState<Message | null>(null);
  const [showTopUp,   setShowTopUp]   = useState(false);

  // ── Report modals ──────────────────────────────────────────────────────────
  const [showTermly,        setShowTermly]        = useState(false);
  const [showWeekly,        setShowWeekly]        = useState(false);
  const [showStudentProfile,setShowStudentProfile]= useState(false);
  const [transferDialog, setTransferDialog] = useState<{ mode: 'in' | 'out' | 'internal'; student?: Student } | null>(null);
  const [showAssignmentManager, setShowAssignmentManager] = useState(false);
  const [showChangeSchool, setShowChangeSchool] = useState(false);

  const [schoolInfo,     setSchoolInfo]     = useState<SchoolInfo | null>(null);
  const [settingsPhone,  setSettingsPhone]  = useState('');
  const [classStructure, setClassStructure] = useState<ClassStructure | null>(null);
  const [activeAcademicYearId, setActiveAcademicYearId] = useState('');

  const isAdmin   = userProfile?.role === 'schoolAdmin';
  const schoolId  = userProfile?.schoolId || '';
  const myAssignedClasses = userProfile?.assignedClasses?.length
    ? userProfile.assignedClasses
    : (userProfile?.classCode ? [userProfile.classCode] : []);
  // The class currently being viewed. Admins default to the whole school; teachers default to
  // their last-active or first assigned class. Switching this immediately re-drives
  // attendance/students/reports/messaging/analytics below since they all read from this same
  // state — no reload needed.
  const [activeClassCode, setActiveClassCode] = useState<string>(
    userProfile?.role === 'schoolAdmin' ? 'All School' : (userProfile?.lastActiveClass || userProfile?.classCode || myAssignedClasses[0] || 'Class')
  );
  // Re-derive the active class when a *different* user profile loads (e.g. sign-in completes
  // asynchronously after this component's first render) — the React-recommended pattern for
  // adjusting state when a dependency changes, rather than a useEffect that calls setState.
  const [lastProfileKey, setLastProfileKey] = useState(`${userProfile?.uid}::${userProfile?.schoolId}`);
  const profileKey = `${userProfile?.uid}::${userProfile?.schoolId}`;
  if (profileKey !== lastProfileKey) {
    setLastProfileKey(profileKey);
    if (userProfile?.role === 'schoolAdmin') {
      setActiveClassCode('All School');
    } else {
      const preferred = userProfile?.lastActiveClass || userProfile?.classCode || myAssignedClasses[0];
      setActiveClassCode(preferred || 'Class');
    }
  }
  function switchActiveClass(next: string) {
    setActiveClassCode(next);
    if (userProfile?.uid && next !== 'All School') {
      updateDoc(doc(db, 'users', userProfile.uid), { lastActiveClass: next }).catch(() => {});
    }
  }
  const classCode = activeClassCode;
  // The roster scoped to whatever is currently active — 'All School' (admins only) shows
  // everyone; otherwise only students in that specific class. This is what every panel
  // (Students table, Register, Overview stats) should read instead of the raw `students` list.
  const scopedStudents = activeClassCode === 'All School' ? students : students.filter(s => s.classCode === activeClassCode);
  const tokens    = userProfile?.messageTokens ?? 0;
  const tier      = getSmsTier(students.length);
  const kesRate   = KES_RATE_PER_TOKEN[tier];

  const todayLabel = new Date().toLocaleDateString('en-KE', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  useEffect(() => {
    if (!schoolId) return;
    getDoc(doc(db, 'schools', schoolId)).then(snap => {
      const d = snap.data();
      const info: SchoolInfo = {
        id:    schoolId,
        name:  d?.name  || userProfile?.schoolName || '',
        phone: d?.phone || d?.adminPhone || userProfile?.phone || '',
        county: d?.county,
      };
      setSchoolInfo(info);
      setSettingsPhone(info.phone);
      if (d?.activeAcademicYearId) setActiveAcademicYearId(d.activeAcademicYearId);
    }).catch(() => {
      const info: SchoolInfo = {
        id: schoolId, name: userProfile?.schoolName || '', phone: userProfile?.phone || '',
      };
      setSchoolInfo(info);
      setSettingsPhone(info.phone);
    });
    getClassStructure(schoolId).then(setClassStructure).catch(() => setClassStructure(null));
  }, [schoolId]);

  useEffect(() => { if (userProfile) loadStudents(); }, [userProfile]);
  useEffect(() => { if (panel === 'logs' && schoolId) loadLogs(); }, [panel, schoolId]);

  async function loadStudents() {
    if (!schoolId) return;
    setLoading(true);
    try {
      const q    = query(collection(db, 'students'), where('schoolId', '==', schoolId));
      const snap = await getDocs(q);
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as Student)).filter(s => !s.archived);
      setStudents(list);
      const init: Record<string, AttendanceStatus> = {};
      list.forEach(s => { init[s.id] = 'present'; });
      setAttendance(init);
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  async function loadLogs() {
    setLogsLoading(true);
    try {
      const q    = query(collection(db, 'messages'), where('schoolId', '==', schoolId), orderBy('sentAt', 'desc'), limit(100));
      const snap = await getDocs(q);
      setMsgLogs(snap.docs.map(d => ({ id: d.id, ...d.data() } as Message)));
    } catch (e) { console.error(e); }
    setLogsLoading(false);
  }

  function toggleStatus(id: string) {
    if (registerLocked) return;
    setAttendance(prev => {
      const cur  = prev[id] || 'present';
      const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(cur) + 1) % STATUS_CYCLE.length];
      return { ...prev, [id]: next };
    });
  }

  const counts = { present: 0, absent: 0, late: 0, excused: 0 };
  Object.values(attendance).forEach(s => counts[s]++);
  const rate = students.length ? Math.round((counts.present / students.length) * 100) : 0;

  async function saveRegister() {
    if (!userProfile || !schoolInfo) return;
    try {
      const today = todayStr();
      const regId = `${schoolId}_${classCode}_${today}`.replace(/\s/g, '_');

      await setDoc(doc(db, 'registers', regId), {
        date: today, classCode, schoolId,
        savedBy: userProfile.displayName, savedAt: new Date().toISOString(),
        locked: true, present: counts.present, absent: counts.absent,
        late: counts.late, excused: counts.excused, total: students.length,
        ...(activeAcademicYearId ? { academicYearId: activeAcademicYearId } : {}),
      });

      for (const s of students) {
        await setDoc(doc(db, 'attendance', `${regId}_${s.id}`), {
          studentId: s.id, studentName: s.name, admissionNo: s.admissionNo,
          date: today, classCode, schoolId,
          status: attendance[s.id] || 'present',
          note: notes[s.id] || '',
          savedBy: userProfile.displayName,
          savedAt: new Date().toISOString(), locked: true,
          ...(s.currentEnrolmentId ? { enrolmentId: s.currentEnrolmentId } : {}),
          ...(activeAcademicYearId ? { academicYearId: activeAcademicYearId } : {}),
        });
      }

      setRegisterLocked(true);

      const toNotify = students.filter(s => {
        const st = attendance[s.id] || 'present';
        return (st === 'absent' || st === 'late') && s.parentPhone?.trim();
      });

      if (toNotify.length === 0) {
        toast('✅ Register saved! No absent/late students to notify.');
        return;
      }

      toast(`📱 Register saved. Sending ${toNotify.length} parent notification${toNotify.length !== 1 ? 's' : ''}…`);

      const result = await sendRegisterNotifications({
        students, attendance,
        sender: {
          uid: user!.uid, displayName: userProfile.displayName,
          phone: userProfile.phone, schoolId, schoolName: schoolInfo.name,
          messageTokens: tokens,
        },
        school: schoolInfo, className: classCode,
        teacherName: userProfile.displayName,
        teacherPhone: userProfile.phone || schoolInfo.phone,
      });

      await refreshProfile();

      if (result.reason) {
        toast(`⚠️ Register saved but SMS blocked: ${result.reason}` +
          (result.warningSmsSent ? ' A warning was sent to your phone.' : ' Add tokens to notify parents.'));
      } else if (result.failed > 0) {
        toast(`⚠️ ${result.sent} SMS sent, ${result.failed} failed. ${result.tokensUsed} tokens used.`);
      } else {
        toast(`✅ Register saved! ${result.sent} parent SMS sent. ${result.tokensUsed} tokens used.`);
      }
    } catch (e: any) { toast('❌ Save failed: ' + e.message); }
  }

  async function addStudent() {
    if (!newStudent.name.trim() || !schoolId) return;
    try {
      const seq         = (students.length + 1).toString().padStart(4, '0');
      const admissionNo = `${schoolId.slice(-4)}-${classCode.replace(/\s/g, '')}-${seq}`;
      const s = {
        name: newStudent.name.trim(), admissionNo, classCode, schoolId,
        parentName: newStudent.parentName.trim(),
        parentPhone: newStudent.parentPhone.trim(),
        parentWhatsApp: newStudent.parentPhone.trim(),
        createdAt: new Date().toISOString(),
      };
      const ref = await addDoc(collection(db, 'students'), s);
      let currentEnrolmentId: string | undefined;
      if (activeAcademicYearId) {
        try {
          const enrolment = await createEnrolment({
            studentId: ref.id, schoolId, academicYearId: activeAcademicYearId, classCode,
          });
          currentEnrolmentId = enrolment.id;
        } catch (e) { console.error('Enrolment creation failed:', e); }
      }
      setStudents(prev => [...prev, { id: ref.id, ...s, ...(currentEnrolmentId ? { currentEnrolmentId } : {}) }]);
      setAttendance(prev => ({ ...prev, [ref.id]: 'present' }));
      setShowAddStudent(false);
      setNewStudent({ name: '', parentName: '', parentPhone: '', parentWhatsApp: '' });
      toast('✅ Student added!');
    } catch (e: any) { toast('❌ ' + e.message); }
  }

  async function sendBroadcastMessage() {
    if (!userProfile || !schoolInfo || !msgBody.trim()) return;
    setSendingMsg(true);
    try {
      const result = await sendBroadcast({
        bodyText: msgBody, recipients: students,
        sender: {
          uid: user!.uid, displayName: userProfile.displayName,
          phone: userProfile.phone, schoolId, schoolName: schoolInfo.name,
          messageTokens: tokens,
        },
        school: schoolInfo, type: msgType, recipientsLabel: msgTo,
      });
      await refreshProfile();
      if (result.error) {
        toast(`⚠️ ${result.error}`);
      } else {
        toast(`✅ Sent to ${result.sent} parents. ${result.tokensUsed} tokens used.`);
        setMsgBody('');
      }
    } catch (e: any) { toast('❌ ' + e.message); }
    finally { setSendingMsg(false); }
  }

  function handleResend(msg: Message) {
    setMsgBody(extractBody(msg.rawContent || msg.content));
    setMsgType(msg.type);
    setMsgTo(msg.recipients);
    setPanel('messages');
    toast('📋 Message loaded for resend.');
  }

  async function saveSettings() {
    if (!schoolInfo) return;
    try {
      await updateDoc(doc(db, 'schools', schoolId), { phone: settingsPhone });
      setSchoolInfo(prev => prev ? { ...prev, phone: settingsPhone } : prev);
      toast('✅ Settings saved!');
    } catch (e: any) { toast('❌ ' + e.message); }
  }

  const filteredStudents = scopedStudents.filter(s => {
    const q = searchQ.toLowerCase();
    const matchQ = !q || s.name.toLowerCase().includes(q) || s.admissionNo.toLowerCase().includes(q);
    const matchF = attFilter === 'all' || attendance[s.id] === attFilter;
    return matchQ && matchF;
  });

  const navItems: { id: Panel; icon: string; label: string; adminOnly?: boolean }[] = [
    { id: 'overview',  icon: '🏠', label: 'Overview' },
    { id: 'register',  icon: '📋', label: "Today's Register" },
    { id: 'students',  icon: '👥', label: 'Students' },
    { id: 'messages',  icon: '💬', label: 'Send SMS' },
    { id: 'logs',      icon: '🗂️', label: 'Message Logs' },
    { id: 'reports',   icon: '📊', label: 'Reports' },
    { id: 'academicYears', icon: '🎓', label: 'Academic Years', adminOnly: true },
    { id: 'settings',  icon: '⚙️', label: 'Settings', adminOnly: true },
  ];

  if (!userProfile) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
      <div className="spinner" />
    </div>
  );

  // ─── Report card definitions ───────────────────────────────────────────────

  /** Each card: what the onClick should do */
  const reportCards: {
    icon: string; title: string; desc: string;
    action: () => void; badge?: string; badgeClass?: string;
  }[] = [
    {
      icon: '📊',
      title: 'Termly Attendance Report',
      desc: 'Full attendance data per class and student for any term. Flags chronic absentees. CSV export.',
      action: () => setShowTermly(true),
      badge: 'Live',
      badgeClass: 'tag-mint',
    },
    {
      icon: '📋',
      title: 'Weekly Summary',
      desc: 'Day-by-day attendance rates per class for any selected week. Navigate backwards through history.',
      action: () => setShowWeekly(true),
      badge: 'Live',
      badgeClass: 'tag-mint',
    },
    {
      icon: '👤',
      title: 'Student Profile Report',
      desc: 'Full attendance history, heatmap, streaks and absence log for a single student. CSV export.',
      action: () => setShowStudentProfile(true),
      badge: 'Live',
      badgeClass: 'tag-mint',
    },
    {
      icon: '📲',
      title: 'SMS Communication Log',
      desc: 'All SMS messages with full token usage breakdown, delivery stats, and resend capability.',
      action: () => setPanel('logs'),
      badge: 'Go to Logs',
      badgeClass: 'tag-blue',
    },
    {
      icon: '⚠️',
      title: 'Chronic Absentee Alert',
      desc: 'Students below 80% attendance threshold — available inside the Termly Report.',
      action: () => setShowTermly(true),
      badge: 'Via Termly',
      badgeClass: 'tag-gold',
    },
    {
      icon: '📖',
      title: 'Class Register Book',
      desc: 'Full printable register book format for a class — PDF export coming soon.',
      action: () => toast('📥 Class Register Book PDF export coming soon!'),
      badge: 'Soon',
      badgeClass: 'tag-gray',
    },
  ];

  return (
    <div className="app-shell">
      {/* DESKTOP SIDEBAR */}
      <aside className="sidebar">
        <div className="sidebar-logo">my<span>register</span></div>
        <div className="sidebar-school">
          <span>{userProfile.role === 'schoolAdmin' ? '🏫 School Admin' : '👩‍🏫 Teacher'}</span>
          <strong>{userProfile.schoolName}</strong>
          <div style={{ marginTop: 8 }}>
            <ClassSwitcher
              activeClass={activeClassCode}
              classes={isAdmin ? (classStructure?.classes || []) : myAssignedClasses}
              onSwitch={switchActiveClass}
              isAdmin={isAdmin}
              allSchoolLabel={isAdmin ? 'All School' : undefined}
            />
          </div>
        </div>
        <nav className="sidebar-nav">
          <div className="sidebar-section-label">Navigation</div>
          {navItems.filter(n => !n.adminOnly || isAdmin).map(n => (
            <button key={n.id} className={`nav-item${panel === n.id ? ' active' : ''}`} onClick={() => setPanel(n.id)}>
              <span className="nav-item-icon">{n.icon}</span>{n.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-user"><strong>{userProfile.displayName}</strong>{userProfile.email}</div>
          <div className="token-badge" style={{ marginBottom: 10, fontSize: 12, cursor: 'pointer' }} onClick={() => setShowTopUp(true)}>
            🪙 {tokens} tokens
          </div>
          <button className="btn-secondary" style={{ width: '100%', justifyContent: 'center', fontSize: 13 }}
            onClick={async () => { await logOut(); navigate('/'); }}>
            Sign Out
          </button>
        </div>
      </aside>

      <main className="main-content">

        {/* ── OVERVIEW ──────────────────────────────────────────────────── */}
        {panel === 'overview' && (
          <>
            <div className="page-header">
              <div>
                <div className="page-title">Good {new Date().getHours() < 12 ? 'morning' : 'afternoon'}, {userProfile.displayName.split(' ')[0]}!</div>
                <div className="page-sub">{new Date().toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
              </div>
              <button className="btn-primary" onClick={() => setPanel('register')}>📋 Open Today's Register</button>
            </div>
            <div className="page-body">
              <div className="stats-grid">
                {[
                  { label: 'Total Students', value: scopedStudents.length, sub: classCode, color: 'var(--ink)' },
                  { label: 'Present Today', value: counts.present, sub: `${rate}% rate`, color: 'var(--mint-d)' },
                  { label: 'Absent Today', value: counts.absent, sub: 'need notification', color: 'var(--red)' },
                  { label: 'SMS Tokens', value: tokens, sub: `KES ${kesRate}/token · ${tier}`, color: '#c4800a' },
                ].map(s => (
                  <div className="stat-card" key={s.label}>
                    <div className="stat-label">{s.label}</div>
                    <div className="stat-value" style={{ color: s.color }}>{s.value}</div>
                    <div className="stat-sub">{s.sub}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                <div className="card">
                  <div className="card-header"><span className="card-title">Quick Actions</span></div>
                  <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {[
                      { label: "📋 Open Today's Register", action: () => setPanel('register') },
                      { label: '👥 Manage Students',       action: () => setPanel('students') },
                      { label: '📲 Send SMS to Parents',   action: () => setPanel('messages') },
                      { label: '🗂️ Message Logs',          action: () => setPanel('logs') },
                      { label: '📊 View Reports',          action: () => setPanel('reports') },
                      { label: '💳 Top Up SMS Tokens',     action: () => setShowTopUp(true) },
                    ].map(a => (
                      <button key={a.label} className="btn-secondary" style={{ justifyContent: 'flex-start' }} onClick={a.action}>{a.label}</button>
                    ))}
                  </div>
                </div>
                <div className="card">
                  <div className="card-header"><span className="card-title">Today's Attendance</span></div>
                  <div className="card-body">
                    {[
                      { label: 'Present', count: counts.present, color: 'var(--mint)' },
                      { label: 'Absent',  count: counts.absent,  color: 'var(--red)' },
                      { label: 'Late',    count: counts.late,    color: 'var(--gold)' },
                      { label: 'Excused', count: counts.excused, color: 'var(--blue)' },
                    ].map(r => (
                      <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                        <div style={{ fontSize: 13, color: 'var(--text-2)', width: 70 }}>{r.label}</div>
                        <div className="att-bar-wrap" style={{ flex: 1 }}>
                          <div className="att-bar-fill" style={{ width: `${students.length ? (r.count/students.length)*100 : 0}%`, background: r.color }} />
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: r.color, width: 24, textAlign: 'right' }}>{r.count}</div>
                      </div>
                    ))}
                    <div style={{ marginTop: 16, padding: '10px 14px', background: 'var(--surface-2)', borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Overall Rate</span>
                      <span className={`tag ${rate >= 90 ? 'tag-mint' : rate >= 75 ? 'tag-gold' : 'tag-red'}`}>{rate}%</span>
                    </div>
                  </div>
                </div>
              </div>
              {tokens < 20 && (
                <div className="notice notice-warning" style={{ marginTop: 16 }}>
                  ⚠️ Only {tokens} tokens left — auto-notifications after register save may be blocked.{' '}
                  <span style={{ color: '#c4800a', cursor: 'pointer', fontWeight: 700, textDecoration: 'underline' }} onClick={() => setShowTopUp(true)}>Top up now →</span>
                </div>
              )}
              <div className="card" style={{ marginTop: 0 }}>
                <div className="card-header">
                  <span className="card-title">School ID</span>
                  <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Share with teachers to join your school</span>
                </div>
                <div className="card-body">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <code style={{ padding: '10px 16px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, fontFamily: "'DM Mono',monospace", fontSize: 18, fontWeight: 700, color: 'var(--mint-d)', letterSpacing: 1 }}>{schoolId}</code>
                    <button className="btn-secondary" onClick={() => { navigator.clipboard.writeText(schoolId); toast('✅ School ID copied!'); }}>Copy</button>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ── REGISTER ──────────────────────────────────────────────────── */}
        {panel === 'register' && (
          <>
            <div className="page-header">
              <div>
                <div className="page-title">Today's Register</div>
                <div className="page-sub">
                  {classCode} · {new Date().toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long' })}
                  {registerLocked ? ' · 🔒 Saved & Locked' : ''}
                </div>
              </div>
              <div className="page-actions">
                <div className="search-bar"><input type="text" placeholder="Search student..." value={searchQ} onChange={e => setSearchQ(e.target.value)} /></div>
                {!registerLocked
                  ? <button className="btn-primary" onClick={saveRegister}>💾 Save &amp; Notify Parents</button>
                  : <button className="btn-secondary" onClick={() => toast('📥 PDF export coming soon!')}>📥 Export PDF</button>}
              </div>
            </div>
            <div className="page-body">
              {!registerLocked && (counts.absent > 0 || counts.late > 0) && (
                <div className="notice notice-info">
                  📲 <strong>Auto-notify on save:</strong>{' '}
                  {counts.absent > 0 && <span>{counts.absent} absent</span>}
                  {counts.absent > 0 && counts.late > 0 && ' + '}
                  {counts.late > 0 && <span>{counts.late} late</span>}
                  {' '}parent{(counts.absent + counts.late) !== 1 ? 's' : ''} will receive SMS when you save.
                  {tokens < (counts.absent + counts.late) * 2 && (
                    <span style={{ color: 'var(--red)', fontWeight: 600 }}>
                      {' '}⚠️ Low tokens — <span style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => setShowTopUp(true)}>top up first</span>.
                    </span>
                  )}
                </div>
              )}
              {registerLocked && (
                <div className="notice notice-locked">🔒 Register saved and locked. Attendance SMS sent automatically.</div>
              )}
              {students.length === 0 && (
                <div className="notice notice-info">No students yet. <span style={{ color: 'var(--blue)', cursor: 'pointer', fontWeight: 600 }} onClick={() => setPanel('students')}>Add students →</span></div>
              )}

              <div className="card">
                <div className="card-header">
                  <div className="reg-summary">
                    <div className="reg-sum-item" style={{ color: 'var(--mint)' }}>✓ <span>{counts.present}</span> Present</div>
                    <div className="reg-sum-item" style={{ color: 'var(--red)' }}>✗ <span>{counts.absent}</span> Absent</div>
                    <div className="reg-sum-item" style={{ color: 'var(--gold)' }}>L <span>{counts.late}</span> Late</div>
                    <div className="reg-sum-item" style={{ color: 'var(--blue)' }}>E <span>{counts.excused}</span> Excused</div>
                  </div>
                  <div className="tab-bar">
                    {(['all','present','absent','late','excused'] as const).map(f => (
                      <button key={f} className={`tab-btn${attFilter === f ? ' active' : ''}`} onClick={() => setAttFilter(f)}>
                        {f.charAt(0).toUpperCase() + f.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>#</th><th>Student Name</th><th>Admission No.</th><th style={{ textAlign: 'center' }}>Status</th><th>Note</th></tr></thead>
                    <tbody>
                      {filteredStudents.map((s, i) => (
                        <tr key={s.id}>
                          <td style={{ color: 'var(--text-3)' }}>{i + 1}</td>
                          <td className="td-name">{s.name}</td>
                          <td className="td-mono">{s.admissionNo}</td>
                          <td>
                            <div className={`att-cell ${attendance[s.id] || 'present'}`} onClick={() => toggleStatus(s.id)}>
                              {STATUS_LABEL[attendance[s.id] || 'present']}
                            </div>
                          </td>
                          <td>
                            <input
                              style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '5px 8px', fontSize: 12, width: 120, outline: 'none', fontFamily: "'Sora',sans-serif" }}
                              placeholder="Note..." value={notes[s.id] || ''}
                              onChange={e => setNotes(prev => ({ ...prev, [s.id]: e.target.value }))}
                              disabled={registerLocked}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="card-footer" style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                  {!registerLocked && (
                    <>
                      <button className="btn-xs btn-xs-mint" onClick={() => { const a: Record<string, AttendanceStatus> = {}; students.forEach(s => a[s.id] = 'present'); setAttendance(a); }}>Mark All Present</button>
                      <button className="btn-xs btn-xs-gray" onClick={() => { const a: Record<string, AttendanceStatus> = {}; students.forEach(s => a[s.id] = 'absent'); setAttendance(a); }}>Mark All Absent</button>
                    </>
                  )}
                  <span style={{ fontSize: 12, color: 'var(--text-3)', marginLeft: 'auto' }}>Click to cycle: P → A → L → E → P</span>
                </div>
              </div>

              {!registerLocked && schoolInfo && (counts.absent > 0 || counts.late > 0) && (
                <div className="card">
                  <div className="card-header">
                    <span className="card-title">📱 SMS Preview</span>
                    <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Exact message parents will receive</span>
                  </div>
                  <div className="card-body" style={{ display: 'grid', gridTemplateColumns: counts.absent > 0 && counts.late > 0 ? '1fr 1fr' : '1fr', gap: 16 }}>
                    {(['absent', 'late'] as const).map(st => {
                      const sample = students.find(s => (attendance[s.id] || 'present') === st);
                      if (!sample) return null;
                      const msg = buildAttendanceSms(st, sample, schoolInfo, classCode, userProfile.displayName, userProfile.phone || schoolInfo.phone, todayLabel);
                      const countFor = st === 'absent' ? counts.absent : counts.late;
                      const color    = st === 'absent' ? 'var(--red)' : 'var(--gold)';
                      return (
                        <div key={st}>
                          <div style={{ fontSize: 11, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: .5, marginBottom: 6 }}>
                            {st} template ({countFor} parent{countFor !== 1 ? 's' : ''})
                          </div>
                          <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, padding: 12, fontSize: 12, fontFamily: "'DM Mono',monospace", lineHeight: 1.8, whiteSpace: 'pre-wrap', color: 'var(--ink)' }}>
                            {msg}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
                            {sanitiseSmsText(msg).length} chars · {Math.ceil(sanitiseSmsText(msg).length / 140)} SMS part{Math.ceil(sanitiseSmsText(msg).length / 140) !== 1 ? 's' : ''}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* ── STUDENTS ──────────────────────────────────────────────────── */}
        {panel === 'students' && (
          <>
            <div className="page-header">
              <div><div className="page-title">Students</div><div className="page-sub">{classCode} · {scopedStudents.length} students</div></div>
              <div className="page-actions">
                <div className="search-bar"><input type="text" placeholder="Search..." value={searchQ} onChange={e => setSearchQ(e.target.value)} /></div>
                <button className="btn-secondary" onClick={() => setTransferDialog({ mode: 'in' })}>↘ Transfer In</button>
                <button className="btn-secondary" onClick={() => setShowImportWizard(true)}>⬆ Import</button>
                <button className="btn-primary" onClick={() => setShowAddStudent(true)}>+ Add Student</button>
              </div>
            </div>
            <div className="page-body">
              {showImportWizard && (
                <StudentImportWizard
                  schoolId={schoolId}
                  classStructure={classStructure}
                  activeAcademicYearId={activeAcademicYearId || null}
                  existingStudents={students}
                  onClose={() => setShowImportWizard(false)}
                  onImported={(summary: ImportSummary) => {
                    if (summary.imported > 0) loadStudents();
                    toast(`✅ ${summary.imported} Imported · ${summary.skipped} Skipped · ${summary.duplicate} Duplicate · ${summary.missingAdmissionNo} Missing Admission No.`);
                  }}
                />
              )}
              {showAddStudent && (
                <div className="card" style={{ marginBottom: 24, border: '2px solid var(--mint)' }}>
                  <div className="card-header">
                    <span className="card-title">Add New Student</span>
                    <button className="modal-close" onClick={() => setShowAddStudent(false)}>✕</button>
                  </div>
                  <div className="card-body">
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                      {[
                        { label: 'Student Name *',        key: 'name',        type: 'text', placeholder: 'Full name' },
                        { label: 'Parent / Guardian Name', key: 'parentName',  type: 'text', placeholder: 'Parent name' },
                        { label: 'Parent Phone (SMS)',     key: 'parentPhone', type: 'tel',  placeholder: '0722 123 456' },
                      ].map(f => (
                        <div className="form-group" key={f.key} style={{ margin: 0 }}>
                          <label className="form-label">{f.label}</label>
                          <input className="form-input" type={f.type} placeholder={f.placeholder}
                            value={(newStudent as any)[f.key]}
                            onChange={e => setNewStudent(p => ({ ...p, [f.key]: e.target.value }))} />
                        </div>
                      ))}
                    </div>
                    <div style={{ marginTop: 16, display: 'flex', gap: 12 }}>
                      <button className="btn-primary" onClick={addStudent}>Add Student</button>
                      <button className="btn-secondary" onClick={() => setShowAddStudent(false)}>Cancel</button>
                    </div>
                  </div>
                </div>
              )}
              <div className="card">
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>#</th><th>Student Name</th><th>Admission No.</th><th>Parent</th><th>Phone (SMS)</th><th>Today</th><th>Actions</th></tr></thead>
                    <tbody>
                      {scopedStudents.filter(s => !searchQ || s.name.toLowerCase().includes(searchQ.toLowerCase()) || s.admissionNo.toLowerCase().includes(searchQ.toLowerCase())).map((s, i) => (
                        <tr key={s.id}>
                          <td style={{ color: 'var(--text-3)' }}>{i + 1}</td>
                          <td className="td-name">{s.name}</td>
                          <td className="td-mono">{s.admissionNo}</td>
                          <td>{s.parentName || '—'}</td>
                          <td className="td-mono">{s.parentPhone || '—'}</td>
                          <td><div className={`att-cell ${attendance[s.id] || 'present'}`} style={{ cursor: 'default' }}>{STATUS_LABEL[attendance[s.id] || 'present']}</div></td>
                          <td className="td-actions">
                            <button className="btn-xs btn-xs-mint" onClick={() => {
                              setMsgBody(`${s.name} was noted today. Please contact the school.`);
                              setPanel('messages');
                              toast('Message pre-filled for ' + s.name);
                            }}>SMS</button>
                            <button className="btn-xs btn-xs-gray" onClick={() => {
                              setShowStudentProfile(true);
                            }} title="View profile">Profile</button>
                            <button className="btn-xs btn-xs-gray" onClick={() => setTransferDialog({ mode: 'internal', student: s })} title="Move to another class/stream">Move</button>
                            <button className="btn-xs btn-xs-gray" onClick={() => setTransferDialog({ mode: 'out', student: s })} title="Transfer to another school">Out</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="card-footer"><span style={{ fontSize: 13, color: 'var(--text-2)' }}>Showing {scopedStudents.length} students</span></div>
              </div>
            </div>
          </>
        )}

        {/* ── MESSAGES ──────────────────────────────────────────────────── */}
        {panel === 'messages' && (
          <>
            <div className="page-header">
              <div>
                <div className="page-title">Send SMS to Parents</div>
                <div className="page-sub">Messages are personalised per parent — header and school signature added automatically</div>
              </div>
              <div className="token-badge">🪙 {tokens} tokens remaining</div>
            </div>
            <div className="page-body">
              {tokens === 0 && (
                <div className="notice notice-warning">
                  ⚠️ No tokens remaining.
                  <button className="btn-secondary" style={{ marginLeft: 16, fontSize: 12 }} onClick={() => setShowTopUp(true)}>💳 Top Up →</button>
                </div>
              )}
              {schoolInfo && (
                <div style={{ background: 'rgba(44,111,173,.06)', border: '1px solid rgba(44,111,173,.2)', borderRadius: 10, padding: '12px 16px', marginBottom: 20, fontSize: 13 }}>
                  <div style={{ fontWeight: 700, color: 'var(--blue)', marginBottom: 8 }}>📋 Every SMS follows this format:</div>
                  <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 12, lineHeight: 2.2, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px' }}>
                    <span style={{ background: 'rgba(44,111,173,.12)', padding: '1px 6px', borderRadius: 4, color: 'var(--blue)' }}>Dear [Parent Name],</span><br />
                    <span style={{ background: 'rgba(0,200,150,.1)', padding: '1px 6px', borderRadius: 4, color: 'var(--mint-d)' }}>Your message body here...</span><br />
                    <span style={{ background: 'rgba(245,166,35,.12)', padding: '1px 6px', borderRadius: 4, color: '#c4800a' }}>{schoolInfo.name}: {schoolInfo.phone || '[school phone — set in Settings]'}</span>
                  </div>
                  {!schoolInfo.phone && (
                    <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 6, fontWeight: 600 }}>
                      ⚠️ No school phone set. <span style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => setPanel('settings')}>Add it in Settings →</span>
                    </div>
                  )}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 24 }}>
                <div className="card">
                  <div className="card-header"><span className="card-title">Compose SMS</span></div>
                  <div className="card-body">
                    <div className="form-group">
                      <label className="form-label">Message Type</label>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {[
                          { label: '📢 Notice', key: 'notice' }, { label: '📝 Assignment', key: 'assignment' },
                          { label: '🎉 Activity', key: 'activity' }, { label: '⚠️ Alert', key: 'alert' },
                          { label: '💬 Custom', key: 'custom' },
                        ].map(t => (
                          <div key={t.key} className={`chip${msgType === t.key ? ' active' : ''}`} onClick={() => setMsgType(t.key)}>{t.label}</div>
                        ))}
                      </div>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Send To</label>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {[...new Set(['All School', classCode, ...(isAdmin ? (classStructure?.classes || []) : [])])].map(c => (
                          <div key={c} className={`chip${msgTo === c ? ' active' : ''}`} onClick={() => setMsgTo(c)}>{c}</div>
                        ))}
                      </div>
                    </div>
                    {schoolInfo ? (
                      <SmsComposeBox
                        body={msgBody} onBodyChange={setMsgBody}
                        school={schoolInfo} recipientCount={students.length}
                        tokens={tokens} sending={sendingMsg} onSend={sendBroadcastMessage}
                      />
                    ) : (
                      <div style={{ color: 'var(--text-3)', fontSize: 13 }}>Loading school info…</div>
                    )}
                  </div>
                </div>
                <div>
                  <div className="card" style={{ marginBottom: 16 }}>
                    <div className="card-header"><span className="card-title">Token Credits</span></div>
                    <div className="card-body">
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13 }}>
                        <span style={{ color: 'var(--text-2)' }}>Remaining</span><strong>{tokens}</strong>
                      </div>
                      <div className="att-bar-wrap" style={{ marginBottom: 16 }}>
                        <div className="att-bar-fill" style={{ width: `${Math.min(100, (tokens / 200) * 100)}%` }} />
                      </div>
                      {[
                        { range: '≤ 100 students', rate: 'KES 0.7/token', active: students.length <= 100 },
                        { range: '101–300 students', rate: 'KES 0.5/token', active: students.length > 100 && students.length <= 300 },
                        { range: '> 300 students', rate: 'KES 0.4/token', active: students.length > 300 },
                      ].map(row => (
                        <div key={row.range} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 8px', borderRadius: 6, marginBottom: 3, background: row.active ? 'rgba(0,200,150,.08)' : 'transparent', border: row.active ? '1px solid rgba(0,200,150,.2)' : '1px solid transparent', fontSize: 12 }}>
                          <span style={{ color: row.active ? 'var(--mint-d)' : 'var(--text-3)' }}>{row.active ? '→ ' : ''}{row.range}</span>
                          <strong style={{ color: row.active ? 'var(--mint-d)' : 'var(--text-2)' }}>{row.rate}</strong>
                        </div>
                      ))}
                      <div style={{ fontSize: 11, color: 'var(--text-3)', margin: '8px 0 12px' }}>1 token = 1 SMS (140 chars incl. spaces) to 1 parent.</div>
                      <button className="btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={() => setShowTopUp(true)}>💳 Top Up via M-Pesa</button>
                    </div>
                  </div>
                  <div className="card">
                    <div className="card-header">
                      <span className="card-title">Packages</span>
                      <span style={{ fontSize: 11, color: 'var(--text-3)' }}>@ KES {kesRate}/token</span>
                    </div>
                    <div className="card-body" style={{ padding: '8px 16px' }}>
                      {TOKEN_PACKAGES.map(pkg => {
                        const kes = tokensToKes(pkg, tier);
                        return (
                          <div key={pkg} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)', fontSize: 13, cursor: 'pointer' }} onClick={() => setShowTopUp(true)}>
                            <span style={{ fontWeight: 600 }}>🪙 {pkg} tokens</span>
                            <span style={{ fontWeight: 700, color: 'var(--mint-d)' }}>KES {kes % 1 === 0 ? kes : kes.toFixed(2)}</span>
                          </div>
                        );
                      })}
                      <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 10, paddingBottom: 4 }}>Prices based on {students.length} students. Tokens never expire.</div>
                    </div>
                  </div>
                  <div className="card" style={{ marginTop: 16 }}>
                    <div className="card-body" style={{ padding: '10px 16px' }}>
                      <button className="btn-secondary" style={{ width: '100%', justifyContent: 'center', fontSize: 13 }} onClick={() => setPanel('logs')}>🗂️ View All Message Logs →</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ── MESSAGE LOGS ──────────────────────────────────────────────── */}
        {panel === 'logs' && (
          <>
            <div className="page-header">
              <div><div className="page-title">Message Logs</div><div className="page-sub">All SMS — auto-sent attendance notifications and manual broadcasts</div></div>
              <div className="page-actions">
                <button className="btn-secondary" onClick={loadLogs} disabled={logsLoading}>{logsLoading ? 'Loading...' : '🔄 Refresh'}</button>
                <button className="btn-primary" onClick={() => setPanel('messages')}>+ New SMS</button>
              </div>
            </div>
            <div className="page-body">
              {msgLogs.length > 0 && (
                <div className="stats-grid" style={{ marginBottom: 20 }}>
                  {[
                    { label: 'Total Sent', value: msgLogs.length, sub: 'messages', color: 'var(--ink)' },
                    { label: 'Tokens Spent', value: msgLogs.reduce((a, m) => a + m.tokensUsed, 0), sub: 'total consumed', color: '#c4800a' },
                    { label: 'Parents Reached', value: msgLogs.reduce((a, m) => a + m.delivered, 0), sub: 'parent SMSes', color: 'var(--mint-d)' },
                    { label: 'Avg Cost/Send', value: msgLogs.length ? (msgLogs.reduce((a, m) => a + m.tokensUsed, 0) / msgLogs.length).toFixed(1) : '—', sub: 'tokens', color: 'var(--blue)' },
                  ].map(s => (
                    <div className="stat-card" key={s.label}>
                      <div className="stat-label">{s.label}</div>
                      <div className="stat-value" style={{ color: s.color, fontSize: 26 }}>{s.value}</div>
                      <div className="stat-sub">{s.sub}</div>
                    </div>
                  ))}
                </div>
              )}
              <div className="card">
                {logsLoading ? (
                  <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto 16px' }} /><div style={{ fontSize: 13, color: 'var(--text-3)' }}>Loading…</div></div>
                ) : msgLogs.length === 0 ? (
                  <div style={{ padding: 48, textAlign: 'center' }}>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', marginBottom: 6 }}>No messages yet</div>
                    <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 20 }}>Auto-sent attendance SMS and manual broadcasts appear here.</div>
                    <button className="btn-primary" onClick={() => setPanel('messages')}>Send First SMS →</button>
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Date</th><th>Type</th><th>Message</th><th>Recipients</th><th style={{ textAlign: 'center' }}>Tokens</th><th>Status</th><th>Actions</th></tr></thead>
                      <tbody>{msgLogs.map(msg => <MessageLogRow key={msg.id} msg={msg} onResend={handleResend} onPreview={setPreviewMsg} />)}</tbody>
                    </table>
                  </div>
                )}
                {msgLogs.length > 0 && (
                  <div className="card-footer"><span style={{ fontSize: 13, color: 'var(--text-2)' }}>Showing {msgLogs.length} most recent messages</span></div>
                )}
              </div>
            </div>
          </>
        )}

        {/* ── REPORTS ───────────────────────────────────────────────────── */}
        {panel === 'reports' && (
          <>
            <div className="page-header">
              <div>
                <div className="page-title">Reports</div>
                <div className="page-sub">Generate, analyse, and export attendance &amp; communication reports</div>
              </div>
            </div>
            <div className="page-body">
              {/* Report cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 28 }}>
                {reportCards.map(rc => (
                  <div
                    key={rc.title}
                    onClick={rc.action}
                    style={{
                      background: 'var(--surface)',
                      border: rc.badgeClass === 'tag-mint'
                        ? '1px solid rgba(0,200,150,.25)'
                        : '1px solid var(--border)',
                      borderRadius: 16,
                      padding: '22px 20px',
                      cursor: 'pointer',
                      position: 'relative',
                      transition: 'box-shadow .2s, transform .15s',
                    }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLDivElement).style.boxShadow = 'var(--shadow-lg)';
                      (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)';
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
                      (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)';
                    }}
                  >
                    {rc.badge && (
                      <span className={`tag ${rc.badgeClass}`} style={{ position: 'absolute', top: 14, right: 14, fontSize: 10 }}>
                        {rc.badge}
                      </span>
                    )}
                    <div style={{
                      width: 46, height: 46, borderRadius: 12,
                      background: rc.badgeClass === 'tag-mint' ? 'rgba(0,200,150,.1)' : 'var(--surface-2)',
                      border: rc.badgeClass === 'tag-mint' ? '1px solid rgba(0,200,150,.2)' : '1px solid var(--border)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 22, marginBottom: 14,
                    }}>{rc.icon}</div>
                    <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)', marginBottom: 6 }}>{rc.title}</div>
                    <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>{rc.desc}</div>
                  </div>
                ))}
              </div>

              {/* Quick stats strip */}
              <div className="card">
                <div className="card-header">
                  <span className="card-title">School-wide Snapshot</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn-xs btn-xs-mint" onClick={() => setShowTermly(true)}>Termly →</button>
                    <button className="btn-xs btn-xs-gray" onClick={() => setShowWeekly(true)}>Weekly →</button>
                  </div>
                </div>
                <div className="card-body">
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
                    {[
                      { label: 'Total Students', value: String(students.length), color: 'var(--ink)' },
                      { label: 'Present Today', value: String(counts.present), color: 'var(--mint-d)' },
                      { label: 'Absent Today',  value: String(counts.absent),  color: 'var(--red)' },
                      { label: 'Today\'s Rate', value: `${rate}%`,             color: rate >= 90 ? 'var(--mint-d)' : rate >= 75 ? '#c4800a' : 'var(--red)' },
                    ].map(s => (
                      <div key={s.label} style={{ textAlign: 'center', padding: '12px 8px', background: 'var(--surface-2)', borderRadius: 10, border: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 26, fontWeight: 800, color: s.color }}>{s.value}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 3 }}>{s.label}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7 }}>
                    For deeper historical analysis, open the <strong>Termly</strong> or <strong>Weekly</strong> reports above.
                    To inspect a specific student's pattern, use the <strong>Student Profile</strong> report.
                  </div>
                </div>
              </div>

              {/* SMS summary strip (linked to logs) */}
              <div className="card" style={{ marginTop: 0 }}>
                <div className="card-header">
                  <span className="card-title">📲 SMS Communication Summary</span>
                  <button className="btn-xs btn-xs-blue" style={{ background: 'rgba(44,111,173,.1)', color: 'var(--blue)', border: '1px solid rgba(44,111,173,.2)' }} onClick={() => setPanel('logs')}>
                    View Full Logs →
                  </button>
                </div>
                <div className="card-body">
                  {msgLogs.length === 0 ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                      <div style={{ fontSize: 32 }}>📭</div>
                      <div>
                        <div style={{ fontWeight: 600, color: 'var(--ink)' }}>No messages sent yet</div>
                        <div style={{ fontSize: 13, color: 'var(--text-3)' }}>
                          Messages will appear here after you save a register or send a broadcast.{' '}
                          <span style={{ color: 'var(--blue)', cursor: 'pointer', fontWeight: 600 }} onClick={() => setPanel('messages')}>Send your first SMS →</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
                        {[
                          { label: 'Messages Sent', value: String(msgLogs.length), color: 'var(--ink)' },
                          { label: 'Tokens Used',   value: String(msgLogs.reduce((a, m) => a + m.tokensUsed, 0)), color: '#c4800a' },
                          { label: 'Parents Notified', value: String(msgLogs.reduce((a, m) => a + m.delivered, 0)), color: 'var(--mint-d)' },
                          { label: 'Failed',         value: String(msgLogs.filter(m => m.status === 'failed').length), color: msgLogs.some(m => m.status === 'failed') ? 'var(--red)' : 'var(--text-3)' },
                        ].map(s => (
                          <div key={s.label} style={{ textAlign: 'center', padding: '10px 8px', background: 'var(--surface-2)', borderRadius: 10, border: '1px solid var(--border)' }}>
                            <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{s.label}</div>
                          </div>
                        ))}
                      </div>
                      {/* Recent messages mini table */}
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 8 }}>3 Most Recent</div>
                      {msgLogs.slice(0, 3).map(msg => (
                        <div key={msg.id} style={{
                          display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0',
                          borderBottom: '1px solid var(--border)',
                        }}>
                          <span className={`tag ${msg.type === 'attendance' ? 'tag-blue' : msg.type === 'alert' ? 'tag-red' : 'tag-gray'}`} style={{ fontSize: 10, whiteSpace: 'nowrap', flexShrink: 0 }}>{msg.type}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{msg.content}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                              {new Date(msg.sentAt).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' })} · {msg.recipientCount} recipients · {msg.tokensUsed} tokens
                            </div>
                          </div>
                          <span style={{
                            fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 12, whiteSpace: 'nowrap', flexShrink: 0,
                            background: msg.status === 'sent' ? 'rgba(0,200,150,.1)' : 'rgba(232,69,69,.1)',
                            color: msg.status === 'sent' ? 'var(--mint-d)' : 'var(--red)',
                          }}>
                            {msg.status === 'sent' ? `✓ ${msg.delivered}/${msg.total}` : '✗ Failed'}
                          </span>
                        </div>
                      ))}
                      <div style={{ marginTop: 12 }}>
                        <button className="btn-secondary" style={{ fontSize: 13 }} onClick={() => setPanel('logs')}>
                          🗂️ View all {msgLogs.length} messages →
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {/* ── ACADEMIC YEARS ────────────────────────────────────────────── */}
        {panel === 'academicYears' && isAdmin && (
          <>
            <div className="page-header"><div><div className="page-title">Academic Years</div><div className="page-sub">Class structure, streams, promotion & graduation</div></div></div>
            <div className="page-body">
              <AcademicYearPanel
                schoolId={schoolId}
                schoolName={userProfile.schoolName}
                onPromotionApplied={async () => { await loadStudents(); toast('✅ Promotion applied. Rosters updated.'); }}
              />
            </div>
          </>
        )}

        {/* ── SETTINGS ──────────────────────────────────────────────────── */}
        {panel === 'settings' && (
          <>
            <div className="page-header"><div><div className="page-title">Settings</div><div className="page-sub">Manage your school profile and SMS configuration</div></div></div>
            <div className="page-body">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                <div className="card">
                  <div className="card-header"><span className="card-title">School Profile</span></div>
                  <div className="card-body">
                    <div className="form-group">
                      <label className="form-label">School Name</label>
                      <input className="form-input" defaultValue={userProfile.schoolName} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">School ID</label>
                      <input className="form-input" value={schoolId} readOnly style={{ opacity: .6, fontFamily: "'DM Mono',monospace" }} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">
                        School Phone{' '}
                        <span style={{ color: 'var(--mint-d)', fontSize: 11, textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>
                          (appears in every SMS footer)
                        </span>
                      </label>
                      <input className="form-input" value={settingsPhone} placeholder="0700 000 000" onChange={e => setSettingsPhone(e.target.value)} />
                      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
                        Every SMS ends with: "<em>{userProfile.schoolName}: {settingsPhone || '0700 000 000'}</em>"
                      </div>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Admin Email</label>
                      <input className="form-input" defaultValue={userProfile.email || ''} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Admin Phone</label>
                      <input className="form-input" defaultValue={userProfile.phone || ''} />
                    </div>
                    <button className="btn-primary" onClick={saveSettings}>Save Changes</button>
                  </div>
                </div>
                <div className="card">
                  <div className="card-header"><span className="card-title">Account</span></div>
                  <div className="card-body">
                    <div style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 16 }}>
                      {[
                        ['Name',         userProfile.displayName],
                        ['Email',        userProfile.email || '—'],
                        ['Phone',        userProfile.phone || 'Not set'],
                        ['Role',         userProfile.role],
                        ['Member since', new Date(userProfile.createdAt).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' })],
                      ].map(([k, v]) => (
                        <div key={k as string} style={{ marginBottom: 8 }}><strong>{k}:</strong> {v}</div>
                      ))}
                    </div>
                    <div className="notice notice-info">ℹ️ Both email and phone link to your account. Sign in with either.</div>
                    {isAdmin && (
                      <button className="btn-secondary" style={{ marginTop: 14 }} onClick={() => setShowAssignmentManager(true)}>
                        👩‍🏫 Manage Teacher Assignments & Transfers →
                      </button>
                    )}
                    {!isAdmin && (
                      <button className="btn-secondary" style={{ marginTop: 14 }} onClick={() => setShowChangeSchool(true)}>
                        🏫 Change School →
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </main>

      {/* ── MESSAGE PREVIEW MODAL ─────────────────────────────────────── */}
      {previewMsg && (
        <div className="modal-overlay open" onClick={e => { if (e.target === e.currentTarget) setPreviewMsg(null); }}>
          <div className="modal" style={{ maxWidth: 540 }}>
            <div className="modal-header"><span className="modal-title">SMS Details</span><button className="modal-close" onClick={() => setPreviewMsg(null)}>✕</button></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {[
                  ['Sent by',    previewMsg.sentBy],
                  ['Date',       new Date(previewMsg.sentAt).toLocaleString('en-KE')],
                  ['Type',       previewMsg.type],
                  ['Recipients', `${previewMsg.recipients} (${previewMsg.recipientCount})`],
                  ['SMS parts',  `${previewMsg.smsSegments} × 140 chars`],
                  ['KES rate',   `KES ${previewMsg.costPerSegment}/token`],
                  ['Tokens used', String(previewMsg.tokensUsed)],
                  ['Delivered',   `${previewMsg.delivered} / ${previewMsg.total}`],
                ].map(([k, v]) => (
                  <div key={k} style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 4 }}>{k}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{v}</div>
                  </div>
                ))}
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 6 }}>Message sent</div>
                <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, padding: 14, fontSize: 13, lineHeight: 1.8, fontFamily: "'DM Mono',monospace", color: 'var(--ink)', whiteSpace: 'pre-wrap' }}>
                  {previewMsg.content}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>{previewMsg.content.length} characters (spaces included)</div>
              </div>
              <div style={{ display: 'flex', gap: 12, paddingTop: 4 }}>
                <button className="btn-primary" onClick={() => { handleResend(previewMsg); setPreviewMsg(null); }}>📋 Load for Resend</button>
                <button className="btn-secondary" onClick={() => setPreviewMsg(null)}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── M-PESA TOP-UP MODAL ───────────────────────────────────────── */}
      <MpesaTopUpModal
        isOpen={showTopUp}
        onClose={() => setShowTopUp(false)}
        tier={tier}
        currentTokens={tokens}
        userId={user!.uid}
        schoolId={schoolId}
        schoolName={userProfile.schoolName}
        onSuccess={async () => {
          await refreshProfile();
          toast('🎉 Tokens added! Your new balance is shown above.');
        }}
      />

      {/* ── REPORT MODALS ─────────────────────────────────────────────── */}
      <TermlyReportModal
        isOpen={showTermly}
        onClose={() => setShowTermly(false)}
        schoolId={schoolId}
        schoolName={userProfile.schoolName}
        academicYearId={activeAcademicYearId}
        defaultClassCode={activeClassCode}
        classOptions={isAdmin ? (classStructure?.classes || []) : myAssignedClasses}
      />

      <WeeklyReportModal
        isOpen={showWeekly}
        onClose={() => setShowWeekly(false)}
        schoolId={schoolId}
        schoolName={userProfile.schoolName}
        academicYearId={activeAcademicYearId}
        defaultClassCode={activeClassCode}
        classOptions={isAdmin ? (classStructure?.classes || []) : myAssignedClasses}
      />

      <StudentProfileModal
        isOpen={showStudentProfile}
        onClose={() => setShowStudentProfile(false)}
        schoolId={schoolId}
        schoolName={userProfile.schoolName}
        students={students}
        academicYearId={activeAcademicYearId}
      />

      {transferDialog && (
        <TransferDialog
          mode={transferDialog.mode === 'internal' ? 'internal' : transferDialog.mode}
          schoolId={schoolId}
          classStructure={classStructure}
          performedBy={userProfile.uid}
          activeAcademicYearId={activeAcademicYearId}
          student={transferDialog.student}
          onClose={() => setTransferDialog(null)}
          onDone={async () => { setTransferDialog(null); await loadStudents(); toast('✅ Transfer recorded.'); }}
        />
      )}

      {showAssignmentManager && isAdmin && (
        <AssignmentManager
          schoolId={schoolId}
          classStructure={classStructure}
          currentAdminUid={userProfile.uid}
          onClose={() => setShowAssignmentManager(false)}
        />
      )}

      {showChangeSchool && !isAdmin && (
        <ChangeSchoolDialog
          teacher={userProfile}
          onClose={() => setShowChangeSchool(false)}
          onDone={async () => { setShowChangeSchool(false); await refreshProfile(); toast('✅ Moved to your new school.'); }}
        />
      )}

      {/* ── MOBILE DRAWER NAV ─────────────────────────────────────────── */}
      <MobileDrawerNav
        panel={panel}
        setPanel={setPanel}
        isAdmin={isAdmin}
        userProfile={userProfile}
        tokens={tokens}
        onTopUp={() => setShowTopUp(true)}
        onSignOut={async () => { await logOut(); navigate('/'); }}
      />

      <ContactUs isOpen={showContact} onClose={() => setShowContact(false)} />

      {ToastEl}
    </div>
  );
}