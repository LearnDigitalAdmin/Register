import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import {
  collection, query, where, getDocs, addDoc, doc,
  updateDoc, setDoc, orderBy, limit,
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  Student, AttendanceRecord, AttendanceStatus, Message,
  sanitiseSmsText, countSmsSegments, calcTokenCost,
  getSmsTier, KES_RATE_PER_TOKEN, SMS_SEGMENT_LENGTH, SMS_MAX_LENGTH,
  TOKEN_PACKAGES, tokensToKes, kesToTokens, SmsTier,
} from '../types';
import { useToast } from '../useToast';
import MpesaTopUpModal from '../components/MpesaTopUpModal';

const STATUS_CYCLE: AttendanceStatus[] = ['present', 'absent', 'late', 'excused'];
const STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: 'P', absent: 'A', late: 'L', excused: 'E',
};

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

type Panel = 'overview' | 'register' | 'students' | 'messages' | 'logs' | 'reports' | 'settings';

// ─── M-Pesa Top-Up Modal ──────────────────────────────────────────────────────
type PayStep = 'select' | 'confirm' | 'waiting' | 'success';

// ─── SMS cost preview component ──────────────────────────────────────────────
function SmsCostPreview({
  rawText,
  recipientCount,
}: {
  rawText: string;
  recipientCount: number;
}) {
  const cleaned = sanitiseSmsText(rawText);
  const charCount = cleaned.length;
  const segments = countSmsSegments(cleaned);
  const tier = getSmsTier(recipientCount);
  const kesRate = KES_RATE_PER_TOKEN[tier];
  const totalTokens = calcTokenCost(cleaned, recipientCount);
  const totalKes = tokensToKes(totalTokens, tier);
  const isOver = charCount > SMS_MAX_LENGTH;
  const tierLabel = tier === 'small' ? '≤100 recipients' : tier === 'medium' ? '101–300 recipients' : '>300 recipients';

  return (
    <div style={{
      background: isOver ? 'rgba(232,69,69,.08)' : 'var(--surface-2)',
      border: `1px solid ${isOver ? 'rgba(232,69,69,.3)' : 'var(--border)'}`,
      borderRadius: 10, padding: '12px 14px', fontSize: 13, marginBottom: 16,
    }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 20px', marginBottom: 6 }}>
        <span>
          <span style={{ color: 'var(--text-2)' }}>Characters: </span>
          <strong style={{ color: isOver ? 'var(--red)' : 'var(--ink)' }}>
            {charCount} / {SMS_MAX_LENGTH}
          </strong>
        </span>
        <span>
          <span style={{ color: 'var(--text-2)' }}>SMS parts: </span>
          <strong style={{ color: 'var(--ink)' }}>{segments}</strong>
          <span style={{ color: 'var(--text-3)', fontSize: 11 }}> ×{SMS_SEGMENT_LENGTH}-char blocks</span>
        </span>
        <span>
          <span style={{ color: 'var(--text-2)' }}>Recipients: </span>
          <strong style={{ color: 'var(--ink)' }}>{recipientCount}</strong>
        </span>
        <span>
          <span style={{ color: 'var(--text-2)' }}>Rate: </span>
          <strong style={{ color: 'var(--ink)' }}>KES {kesRate}/token</strong>
          <span style={{ color: 'var(--text-3)', fontSize: 11 }}> ({tierLabel})</span>
        </span>
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        paddingTop: 8, borderTop: '1px solid var(--border)',
      }}>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
          {segments} part{segments !== 1 ? 's' : ''} × {recipientCount} recipients = {totalTokens} tokens · ≈ KES {totalKes % 1 === 0 ? totalKes : totalKes.toFixed(2)}
        </span>
        <span style={{
          fontWeight: 800, fontSize: 16,
          color: isOver ? 'var(--red)' : 'var(--mint-d)',
        }}>
          {isOver ? '⛔ Too long' : `🪙 ${totalTokens} tokens`}
        </span>
      </div>
    </div>
  );
}

// ─── Message log row ──────────────────────────────────────────────────────────
function MessageLogRow({
  msg,
  onResend,
  onPreview,
}: {
  msg: Message;
  onResend: (m: Message) => void;
  onPreview: (m: Message) => void;
}) {
  const typeColors: Record<string, string> = {
    attendance: 'tag-blue', assignment: 'tag-gold', notice: 'tag-gray',
    activity: 'tag-mint', alert: 'tag-red', custom: 'tag-gray',
  };
  const statusColor = msg.status === 'sent' ? 'var(--mint-d)' : msg.status === 'failed' ? 'var(--red)' : 'var(--gold)';

  return (
    <tr>
      <td style={{ color: 'var(--text-3)', fontSize: 12, whiteSpace: 'nowrap' }}>
        {new Date(msg.sentAt).toLocaleDateString('en-KE', { day: '2-digit', month: 'short' })}
        <br />
        <span style={{ fontSize: 11 }}>
          {new Date(msg.sentAt).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </td>
      <td>
        <span className={`tag ${typeColors[msg.type] || 'tag-gray'}`}>
          {msg.type}
        </span>
      </td>
      <td style={{ maxWidth: 220 }}>
        <div style={{
          fontSize: 13, color: 'var(--ink)', fontWeight: 500,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {msg.content}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
          {msg.smsSegments} SMS part{msg.smsSegments !== 1 ? 's' : ''} · {msg.content.length} chars
        </div>
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

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function AppDashboard() {
  const { user, userProfile, logOut, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const { toast, ToastEl } = useToast();
  const [panel, setPanel] = useState<Panel>('overview');

  // Students & attendance
  const [students, setStudents] = useState<Student[]>([]);
  const [attendance, setAttendance] = useState<Record<string, AttendanceStatus>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [registerLocked, setRegisterLocked] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [attFilter, setAttFilter] = useState<AttendanceStatus | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [showAddStudent, setShowAddStudent] = useState(false);
  const [newStudent, setNewStudent] = useState({
    name: '', parentName: '', parentPhone: '', parentWhatsApp: '',
  });

  // Messaging
  const [msgContent, setMsgContent] = useState('');
  const [msgType, setMsgType] = useState('notice');
  const [msgTo, setMsgTo] = useState('All School');
  const [sendingMsg, setSendingMsg] = useState(false);

  // Message logs
  const [msgLogs, setMsgLogs] = useState<Message[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [previewMsg, setPreviewMsg] = useState<Message | null>(null);

  // Top-up modal
  const [showTopUp, setShowTopUp] = useState(false);

  const isAdmin = userProfile?.role === 'schoolAdmin';
  const schoolId = userProfile?.schoolId || '';
  const classCode = isAdmin
    ? (userProfile?.classCode || 'All')
    : (userProfile?.classCode || 'Grade 7A');
  const tokens = userProfile?.messageTokens ?? 0;

  // ── Derived SMS state ──
  const recipientCount = students.length;
  const tier = getSmsTier(recipientCount);
  const kesRate = KES_RATE_PER_TOKEN[tier];
  const cleanedMsg = sanitiseSmsText(msgContent);
  const msgSegments = countSmsSegments(cleanedMsg);
  const msgTokenCost = calcTokenCost(cleanedMsg, recipientCount);
  const msgTooLong = cleanedMsg.length > SMS_MAX_LENGTH;
  const canSend = cleanedMsg.length > 0 && !msgTooLong && tokens >= msgTokenCost && recipientCount > 0;

  useEffect(() => {
    if (userProfile) loadStudents();
  }, [userProfile]);

  useEffect(() => {
    if (panel === 'logs' && schoolId) loadLogs();
  }, [panel, schoolId]);

  async function loadStudents() {
    if (!schoolId) return;
    setLoading(true);
    try {
      const q = query(collection(db, 'students'), where('schoolId', '==', schoolId));
      const snap = await getDocs(q);
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as Student));
      setStudents(list);
      const init: Record<string, AttendanceStatus> = {};
      list.forEach(s => { init[s.id] = 'present'; });
      setAttendance(init);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }

  async function loadLogs() {
    setLogsLoading(true);
    try {
      const q = query(
        collection(db, 'messages'),
        where('schoolId', '==', schoolId),
        orderBy('sentAt', 'desc'),
        limit(100),
      );
      const snap = await getDocs(q);
      setMsgLogs(snap.docs.map(d => ({ id: d.id, ...d.data() } as Message)));
    } catch (e) {
      console.error(e);
    }
    setLogsLoading(false);
  }

  function toggleStatus(id: string) {
    if (registerLocked) return;
    setAttendance(prev => {
      const cur = prev[id] || 'present';
      const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(cur) + 1) % STATUS_CYCLE.length];
      return { ...prev, [id]: next };
    });
  }

  const counts = { present: 0, absent: 0, late: 0, excused: 0 };
  Object.values(attendance).forEach(s => counts[s]++);
  const rate = students.length ? Math.round((counts.present / students.length) * 100) : 0;

  async function saveRegister() {
    if (!userProfile) return;
    try {
      const today = todayStr();
      const regId = `${schoolId}_${classCode}_${today}`.replace(/\s/g, '_');
      await setDoc(doc(db, 'registers', regId), {
        date: today, classCode, schoolId,
        savedBy: userProfile.displayName,
        savedAt: new Date().toISOString(),
        locked: true,
        present: counts.present, absent: counts.absent,
        late: counts.late, excused: counts.excused, total: students.length,
      });
      for (const s of students) {
        await setDoc(doc(db, 'attendance', `${regId}_${s.id}`), {
          studentId: s.id, studentName: s.name, admissionNo: s.admissionNo,
          date: today, classCode, schoolId,
          status: attendance[s.id] || 'present',
          note: notes[s.id] || '',
          savedBy: userProfile.displayName,
          savedAt: new Date().toISOString(), locked: true,
        });
      }
      setRegisterLocked(true);
      toast(`✅ Register saved! ${counts.absent} parent SMS${counts.absent !== 1 ? 's' : ''} queued.`);
    } catch (e: any) {
      toast('❌ Save failed: ' + e.message);
    }
  }

  async function addStudent() {
    if (!newStudent.name.trim() || !schoolId) return;
    try {
      const seq = (students.length + 1).toString().padStart(4, '0');
      const admissionNo = `${schoolId.slice(-4)}-${classCode.replace(/\s/g, '')}-${seq}`;
      const s = {
        name: newStudent.name.trim(), admissionNo, classCode, schoolId,
        parentName: newStudent.parentName.trim(),
        parentPhone: newStudent.parentPhone.trim(),
        parentWhatsApp: newStudent.parentPhone.trim(),
        createdAt: new Date().toISOString(),
      };
      const ref = await addDoc(collection(db, 'students'), s);
      setStudents(prev => [...prev, { id: ref.id, ...s }]);
      setAttendance(prev => ({ ...prev, [ref.id]: 'present' }));
      setShowAddStudent(false);
      setNewStudent({ name: '', parentName: '', parentPhone: '', parentWhatsApp: '' });
      toast('✅ Student added!');
    } catch (e: any) {
      toast('❌ ' + e.message);
    }
  }

  async function sendMessage(overrideContent?: string, overrideRecipients?: string) {
    if (!userProfile) return;
    const rawText = overrideContent ?? msgContent;
    const recipientsLabel = overrideRecipients ?? msgTo;
    const clean = sanitiseSmsText(rawText);

    if (!clean) { toast('⚠️ Message is empty after sanitisation.'); return; }
    if (clean.length > SMS_MAX_LENGTH) { toast('⛔ Message too long (max 400 characters).'); return; }

    const rc = students.length;
    const cost = calcTokenCost(clean, rc);
    if (tokens < cost) {
      toast(`⚠️ Insufficient tokens. Need ${cost}, you have ${tokens}.`);
      return;
    }

    const msgTier = getSmsTier(rc);
    const costPerSegment = KES_RATE_PER_TOKEN[msgTier];
    const segs = countSmsSegments(clean);

    setSendingMsg(true);
    try {
      const msgDoc = {
        schoolId,
        sentBy: userProfile.displayName,
        type: overrideContent ? 'custom' : msgType,
        channel: 'sms' as const,
        recipients: recipientsLabel,
        recipientCount: rc,
        rawContent: rawText,
        content: clean,
        smsSegments: segs,
        smsTier: msgTier,
        costPerSegment,
        tokensUsed: cost,
        sentAt: new Date().toISOString(),
        delivered: rc,
        total: rc,
        status: 'sent' as const,
      };
      await addDoc(collection(db, 'messages'), msgDoc);
      await updateDoc(doc(db, 'users', user!.uid), {
        messageTokens: tokens - cost,
      });
      await refreshProfile();
      toast(`✅ SMS sent to ${rc} parents! (${segs} part${segs !== 1 ? 's' : ''} × ${rc} = ${cost} tokens)`);
      if (!overrideContent) setMsgContent('');
    } catch (e: any) {
      toast('❌ ' + e.message);
    } finally {
      setSendingMsg(false);
    }
  }

  function handleResend(msg: Message) {
    setMsgContent(msg.rawContent || msg.content);
    setMsgType(msg.type);
    setMsgTo(msg.recipients);
    setPanel('messages');
    toast('📋 Message loaded for resend — review and send again.');
  }

  const filteredStudents = students.filter(s => {
    const q = searchQ.toLowerCase();
    const matchQ = !q || s.name.toLowerCase().includes(q) || s.admissionNo.toLowerCase().includes(q);
    const matchFilter = attFilter === 'all' || attendance[s.id] === attFilter;
    return matchQ && matchFilter;
  });

  const navItems: { id: Panel; icon: string; label: string; adminOnly?: boolean }[] = [
    { id: 'overview',  icon: '🏠', label: 'Overview' },
    { id: 'register',  icon: '📋', label: "Today's Register" },
    { id: 'students',  icon: '👥', label: 'Students' },
    { id: 'messages',  icon: '💬', label: 'Send SMS' },
    { id: 'logs',      icon: '🗂️', label: 'Message Logs' },
    { id: 'reports',   icon: '📊', label: 'Reports' },
    { id: 'settings',  icon: '⚙️', label: 'Settings', adminOnly: true },
  ];

  if (!userProfile) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
      <div className="spinner" />
    </div>
  );

  return (
    <div className="app-shell">
      {/* SIDEBAR */}
      <aside className="sidebar">
        <div className="sidebar-logo">my<span>register</span></div>
        <div className="sidebar-school">
          <span>{userProfile.role === 'schoolAdmin' ? '🏫 School Admin' : '👩‍🏫 Teacher'}</span>
          <strong>{userProfile.schoolName}</strong>
        </div>
        <nav className="sidebar-nav">
          <div className="sidebar-section-label">Navigation</div>
          {navItems.filter(n => !n.adminOnly || isAdmin).map(n => (
            <button
              key={n.id}
              className={`nav-item${panel === n.id ? ' active' : ''}`}
              onClick={() => setPanel(n.id)}
            >
              <span className="nav-item-icon">{n.icon}</span>{n.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-user">
            <strong>{userProfile.displayName}</strong>
            {userProfile.email}
          </div>
          <div className="token-badge" style={{ marginBottom: 10, fontSize: 12, cursor: 'pointer' }}
            onClick={() => setShowTopUp(true)}>
            🪙 {tokens} tokens
          </div>
          <button
            className="btn-secondary"
            style={{ width: '100%', justifyContent: 'center', fontSize: 13 }}
            onClick={async () => { await logOut(); navigate('/'); }}
          >
            Sign Out
          </button>
        </div>
      </aside>

      {/* MAIN */}
      <main className="main-content">

        {/* ── OVERVIEW ── */}
        {panel === 'overview' && (
          <>
            <div className="page-header">
              <div>
                <div className="page-title">
                  Good {new Date().getHours() < 12 ? 'morning' : 'afternoon'},{' '}
                  {userProfile.displayName.split(' ')[0]}!
                </div>
                <div className="page-sub">
                  {new Date().toLocaleDateString('en-KE', {
                    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
                  })}
                </div>
              </div>
              <button className="btn-primary" onClick={() => setPanel('register')}>
                📋 Open Today's Register
              </button>
            </div>
            <div className="page-body">
              <div className="stats-grid">
                {[
                  { label: 'Total Students', value: students.length, sub: classCode, color: 'var(--ink)' },
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
                      { label: '👥 Manage Students', action: () => setPanel('students') },
                      { label: '📲 Send SMS to Parents', action: () => setPanel('messages') },
                      { label: '🗂️ Message Logs', action: () => setPanel('logs') },
                      { label: '📊 View Reports', action: () => setPanel('reports') },
                      { label: '💳 Top Up SMS Tokens', action: () => setShowTopUp(true) },
                    ].map(a => (
                      <button
                        key={a.label} className="btn-secondary"
                        style={{ justifyContent: 'flex-start' }}
                        onClick={a.action}
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="card">
                  <div className="card-header"><span className="card-title">Today's Attendance</span></div>
                  <div className="card-body">
                    {[
                      { label: 'Present', count: counts.present, color: 'var(--mint)' },
                      { label: 'Absent', count: counts.absent, color: 'var(--red)' },
                      { label: 'Late', count: counts.late, color: 'var(--gold)' },
                      { label: 'Excused', count: counts.excused, color: 'var(--blue)' },
                    ].map(r => (
                      <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                        <div style={{ fontSize: 13, color: 'var(--text-2)', width: 70 }}>{r.label}</div>
                        <div className="att-bar-wrap" style={{ flex: 1 }}>
                          <div
                            className="att-bar-fill"
                            style={{
                              width: `${students.length ? (r.count / students.length) * 100 : 0}%`,
                              background: r.color,
                            }}
                          />
                        </div>
                        <div style={{
                          fontSize: 13, fontWeight: 700, color: r.color, width: 24, textAlign: 'right',
                        }}>
                          {r.count}
                        </div>
                      </div>
                    ))}
                    <div style={{
                      marginTop: 16, padding: '10px 14px', background: 'var(--surface-2)',
                      borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    }}>
                      <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Overall Rate</span>
                      <span className={`tag ${rate >= 90 ? 'tag-mint' : rate >= 75 ? 'tag-gold' : 'tag-red'}`}>
                        {rate}%
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {tokens < 20 && (
                <div className="notice notice-warning" style={{ marginTop: 0 }}>
                  ⚠️ You have {tokens} SMS tokens left. {' '}
                  <span
                    style={{ color: '#c4800a', cursor: 'pointer', fontWeight: 700, textDecoration: 'underline' }}
                    onClick={() => setShowTopUp(true)}
                  >
                    Top up via M-Pesa →
                  </span>
                </div>
              )}

              <div className="card">
                <div className="card-header">
                  <span className="card-title">School ID</span>
                  <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                    Share with teachers to join your school
                  </span>
                </div>
                <div className="card-body">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <code style={{
                      padding: '10px 16px', background: 'var(--surface-2)',
                      border: '1px solid var(--border)', borderRadius: 8,
                      fontFamily: "'DM Mono',monospace", fontSize: 18, fontWeight: 700,
                      color: 'var(--mint-d)', letterSpacing: 1,
                    }}>
                      {schoolId}
                    </code>
                    <button
                      className="btn-secondary"
                      onClick={() => { navigator.clipboard.writeText(schoolId); toast('✅ School ID copied!'); }}
                    >
                      Copy
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ── REGISTER ── */}
        {panel === 'register' && (
          <>
            <div className="page-header">
              <div>
                <div className="page-title">Today's Register</div>
                <div className="page-sub">
                  {classCode} · {new Date().toLocaleDateString('en-KE', {
                    weekday: 'long', day: 'numeric', month: 'long',
                  })}{registerLocked ? ' · 🔒 Saved & Locked' : ''}
                </div>
              </div>
              <div className="page-actions">
                <div className="search-bar">
                  <input
                    type="text" placeholder="Search student..."
                    value={searchQ} onChange={e => setSearchQ(e.target.value)}
                  />
                </div>
                {!registerLocked
                  ? <button className="btn-primary" onClick={saveRegister}>💾 Save Register</button>
                  : <button className="btn-secondary" onClick={() => toast('📥 PDF export coming soon!')}>📥 Export PDF</button>}
              </div>
            </div>
            <div className="page-body">
              {registerLocked && (
                <div className="notice notice-locked">
                  🔒 This register has been saved and locked. It can no longer be edited.
                </div>
              )}
              {students.length === 0 && (
                <div className="notice notice-info">
                  No students yet.{' '}
                  <span
                    style={{ color: 'var(--blue)', cursor: 'pointer', fontWeight: 600 }}
                    onClick={() => setPanel('students')}
                  >
                    Add students →
                  </span>
                </div>
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
                    {(['all', 'present', 'absent', 'late', 'excused'] as const).map(f => (
                      <button
                        key={f}
                        className={`tab-btn${attFilter === f ? ' active' : ''}`}
                        onClick={() => setAttFilter(f)}
                      >
                        {f.charAt(0).toUpperCase() + f.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>#</th><th>Student Name</th><th>Admission No.</th>
                        <th style={{ textAlign: 'center' }}>Status</th><th>Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredStudents.map((s, i) => (
                        <tr key={s.id}>
                          <td style={{ color: 'var(--text-3)' }}>{i + 1}</td>
                          <td className="td-name">{s.name}</td>
                          <td className="td-mono">{s.admissionNo}</td>
                          <td>
                            <div
                              className={`att-cell ${attendance[s.id] || 'present'}`}
                              onClick={() => toggleStatus(s.id)}
                            >
                              {STATUS_LABEL[attendance[s.id] || 'present']}
                            </div>
                          </td>
                          <td>
                            <input
                              style={{
                                border: '1px solid var(--border)', borderRadius: 6,
                                padding: '5px 8px', fontSize: 12, width: 120,
                                outline: 'none', fontFamily: "'Sora',sans-serif",
                              }}
                              placeholder="Note..."
                              value={notes[s.id] || ''}
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
                      <button
                        className="btn-xs btn-xs-mint"
                        onClick={() => {
                          const a: Record<string, AttendanceStatus> = {};
                          students.forEach(s => a[s.id] = 'present');
                          setAttendance(a);
                        }}
                      >
                        Mark All Present
                      </button>
                      <button
                        className="btn-xs btn-xs-gray"
                        onClick={() => {
                          const a: Record<string, AttendanceStatus> = {};
                          students.forEach(s => a[s.id] = 'absent');
                          setAttendance(a);
                        }}
                      >
                        Mark All Absent
                      </button>
                    </>
                  )}
                  <span style={{ fontSize: 12, color: 'var(--text-3)', marginLeft: 'auto' }}>
                    Click cells to cycle: P → A → L → E → P
                  </span>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ── STUDENTS ── */}
        {panel === 'students' && (
          <>
            <div className="page-header">
              <div>
                <div className="page-title">Students</div>
                <div className="page-sub">{classCode} · {students.length} students</div>
              </div>
              <div className="page-actions">
                <div className="search-bar">
                  <input
                    type="text" placeholder="Search..."
                    value={searchQ} onChange={e => setSearchQ(e.target.value)}
                  />
                </div>
                <button className="btn-primary" onClick={() => setShowAddStudent(true)}>+ Add Student</button>
              </div>
            </div>
            <div className="page-body">
              {showAddStudent && (
                <div className="card" style={{ marginBottom: 24, border: '2px solid var(--mint)' }}>
                  <div className="card-header">
                    <span className="card-title">Add New Student</span>
                    <button className="modal-close" onClick={() => setShowAddStudent(false)}>✕</button>
                  </div>
                  <div className="card-body">
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">Student Name *</label>
                        <input
                          className="form-input" type="text" placeholder="Full name"
                          value={newStudent.name}
                          onChange={e => setNewStudent(p => ({ ...p, name: e.target.value }))}
                        />
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">Parent / Guardian Name</label>
                        <input
                          className="form-input" type="text" placeholder="Parent name"
                          value={newStudent.parentName}
                          onChange={e => setNewStudent(p => ({ ...p, parentName: e.target.value }))}
                        />
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">Parent Phone (SMS)</label>
                        <input
                          className="form-input" type="tel" placeholder="0722 123 456"
                          value={newStudent.parentPhone}
                          onChange={e => setNewStudent(p => ({ ...p, parentPhone: e.target.value }))}
                        />
                      </div>
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
                    <thead>
                      <tr>
                        <th>#</th><th>Student Name</th><th>Admission No.</th>
                        <th>Parent</th><th>Phone (SMS)</th><th>Today</th><th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {students
                        .filter(s =>
                          !searchQ
                          || s.name.toLowerCase().includes(searchQ.toLowerCase())
                          || s.admissionNo.toLowerCase().includes(searchQ.toLowerCase())
                        )
                        .map((s, i) => (
                          <tr key={s.id}>
                            <td style={{ color: 'var(--text-3)' }}>{i + 1}</td>
                            <td className="td-name">{s.name}</td>
                            <td className="td-mono">{s.admissionNo}</td>
                            <td>{s.parentName || '—'}</td>
                            <td className="td-mono">{s.parentPhone || '—'}</td>
                            <td>
                              <div
                                className={`att-cell ${attendance[s.id] || 'present'}`}
                                style={{ cursor: 'default' }}
                              >
                                {STATUS_LABEL[attendance[s.id] || 'present']}
                              </div>
                            </td>
                            <td className="td-actions">
                              <button
                                className="btn-xs btn-xs-mint"
                                onClick={() => {
                                  setMsgContent(
                                    `Dear ${s.parentName || 'Parent'}, ${s.name} was noted today. Please contact the school.`
                                  );
                                  setPanel('messages');
                                  toast('Message pre-filled for ' + s.name);
                                }}
                              >
                                SMS
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                <div className="card-footer">
                  <span style={{ fontSize: 13, color: 'var(--text-2)' }}>
                    Showing {students.length} students
                  </span>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ── MESSAGES ── */}
        {panel === 'messages' && (
          <>
            <div className="page-header">
              <div>
                <div className="page-title">Send SMS to Parents</div>
                <div className="page-sub">
                  Plain-text SMS notifications · emojis &amp; special characters are auto-removed
                </div>
              </div>
              <div className="token-badge">🪙 {tokens} tokens remaining</div>
            </div>
            <div className="page-body">
              {tokens === 0 && (
                <div className="notice notice-warning">
                  ⚠️ You have no tokens.{' '}
                  <button
                    className="btn-secondary"
                    style={{ marginLeft: 16, fontSize: 12 }}
                    onClick={() => setShowTopUp(true)}
                  >
                    💳 Top Up via M-Pesa →
                  </button>
                </div>
              )}

              <div className="notice notice-info" style={{ marginBottom: 20 }}>
                📲 <strong>How tokens work:</strong> 1 SMS (140 chars) to 1 parent = 1 token.
                Token cost in KES depends on your school size: ≤100 → <strong>KES 0.7/token</strong> · 101–300 → <strong>KES 0.5/token</strong> · 300+ → <strong>KES 0.4/token</strong>.
                Your current rate: <strong>KES {kesRate}/token</strong> ({students.length} students).
                Spaces count towards character limit. Max 400 chars (3 SMS parts).
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 24 }}>
                <div className="card">
                  <div className="card-header"><span className="card-title">Compose SMS</span></div>
                  <div className="card-body">
                    <div className="form-group">
                      <label className="form-label">Message Type</label>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {[
                          { label: '📢 Notice', key: 'notice' },
                          { label: '📝 Assignment', key: 'assignment' },
                          { label: '🎉 Activity', key: 'activity' },
                          { label: '⚠️ Absence Alert', key: 'alert' },
                          { label: '💬 Custom', key: 'custom' },
                        ].map(t => (
                          <div
                            key={t.key}
                            className={`chip${msgType === t.key ? ' active' : ''}`}
                            onClick={() => setMsgType(t.key)}
                          >
                            {t.label}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="form-group">
                      <label className="form-label">Send To</label>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {[
                          'All School',
                          classCode,
                          ...(isAdmin ? ['Grade 6A', 'Grade 5A'] : []),
                        ].map(c => (
                          <div
                            key={c}
                            className={`chip${msgTo === c ? ' active' : ''}`}
                            onClick={() => setMsgTo(c)}
                          >
                            {c}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="form-group">
                      <label className="form-label">
                        Message
                        <span style={{
                          marginLeft: 8, fontSize: 11, color: cleanedMsg.length > SMS_MAX_LENGTH ? 'var(--red)' : 'var(--text-3)',
                          fontWeight: 400, letterSpacing: 0, textTransform: 'none',
                        }}>
                          {cleanedMsg.length}/{SMS_MAX_LENGTH} chars (spaces included)
                          {msgSegments > 0 && ` · ${msgSegments} SMS part${msgSegments !== 1 ? 's' : ''}`}
                        </span>
                      </label>
                      <textarea
                        className="form-input"
                        rows={5}
                        placeholder={`Type your SMS message here... (max ${SMS_MAX_LENGTH} characters including spaces, emojis will be removed)`}
                        value={msgContent}
                        onChange={e => setMsgContent(e.target.value)}
                        style={{
                          resize: 'vertical',
                          borderColor: msgTooLong ? 'var(--red)' : undefined,
                        }}
                      />
                      {msgTooLong && (
                        <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 4 }}>
                          ⛔ Message too long. Max {SMS_MAX_LENGTH} characters after emoji stripping.
                        </div>
                      )}
                      {msgContent !== cleanedMsg && msgContent.length > 0 && (
                        <div style={{
                          fontSize: 12, color: 'var(--text-2)', marginTop: 6,
                          background: 'var(--surface-2)', borderRadius: 6, padding: '6px 10px',
                        }}>
                          <strong>Preview after cleanup:</strong>{' '}
                          <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 11 }}>
                            {cleanedMsg || '(empty)'}
                          </span>
                        </div>
                      )}
                    </div>

                    {cleanedMsg.length > 0 && (
                      <SmsCostPreview rawText={msgContent} recipientCount={recipientCount} />
                    )}

                    <button
                      className="btn-primary"
                      style={{ width: '100%', justifyContent: 'center' }}
                      onClick={() => sendMessage()}
                      disabled={!canSend || sendingMsg}
                    >
                      {sendingMsg
                        ? 'Sending...'
                        : canSend
                          ? `📲 Send SMS to ${recipientCount} parents (${msgTokenCost} tokens) →`
                          : msgTooLong
                            ? '⛔ Message too long'
                            : tokens < msgTokenCost
                              ? `⚠️ Need ${msgTokenCost} tokens`
                              : '📲 Send SMS'}
                    </button>
                  </div>
                </div>

                <div>
                  <div className="card" style={{ marginBottom: 16 }}>
                    <div className="card-header"><span className="card-title">SMS Token Credits</span></div>
                    <div className="card-body">
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13 }}>
                        <span style={{ color: 'var(--text-2)' }}>Tokens Remaining</span>
                        <strong>{tokens}</strong>
                      </div>
                      <div className="att-bar-wrap" style={{ marginBottom: 16 }}>
                        <div
                          className="att-bar-fill"
                          style={{ width: `${Math.min(100, (tokens / 200) * 100)}%` }}
                        />
                      </div>

                      {/* Tier pricing table */}
                      <div style={{ fontSize: 12, marginBottom: 14 }}>
                        <div style={{ fontWeight: 600, color: 'var(--text-2)', marginBottom: 6, letterSpacing: .5, textTransform: 'uppercase', fontSize: 10 }}>
                          KES Cost per Token (by school size)
                        </div>
                        {[
                          { range: '≤ 100 students', rate: 'KES 0.7/token', active: recipientCount <= 100 },
                          { range: '101–300 students', rate: 'KES 0.5/token', active: recipientCount > 100 && recipientCount <= 300 },
                          { range: '> 300 students', rate: 'KES 0.4/token', active: recipientCount > 300 },
                        ].map(row => (
                          <div key={row.range} style={{
                            display: 'flex', justifyContent: 'space-between',
                            padding: '5px 8px', borderRadius: 6, marginBottom: 3,
                            background: row.active ? 'rgba(0,200,150,.08)' : 'transparent',
                            border: row.active ? '1px solid rgba(0,200,150,.2)' : '1px solid transparent',
                            fontSize: 12,
                          }}>
                            <span style={{ color: row.active ? 'var(--mint-d)' : 'var(--text-3)' }}>
                              {row.active ? '→ ' : ''}{row.range}
                            </span>
                            <strong style={{ color: row.active ? 'var(--mint-d)' : 'var(--text-2)' }}>
                              {row.rate}
                            </strong>
                          </div>
                        ))}
                        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>
                          1 SMS = 140 chars (spaces included). 141+ chars = 2 tokens per recipient.
                        </div>
                      </div>

                      <button
                        className="btn-primary"
                        style={{ width: '100%', justifyContent: 'center' }}
                        onClick={() => setShowTopUp(true)}
                      >
                        💳 Top Up via M-Pesa
                      </button>
                    </div>
                  </div>

                  {/* Dynamic token packages */}
                  <div className="card">
                    <div className="card-header">
                      <span className="card-title">Token Packages</span>
                      <span style={{ fontSize: 11, color: 'var(--text-3)' }}>@ KES {kesRate}/token</span>
                    </div>
                    <div className="card-body" style={{ padding: '8px 16px' }}>
                      {TOKEN_PACKAGES.map(pkg => {
                        const kes = tokensToKes(pkg, tier);
                        return (
                          <div
                            key={pkg}
                            style={{
                              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                              padding: '10px 0', borderBottom: '1px solid var(--border)', fontSize: 13,
                              cursor: 'pointer',
                            }}
                            onClick={() => setShowTopUp(true)}
                          >
                            <span style={{ fontWeight: 600 }}>🪙 {pkg} tokens</span>
                            <span style={{ fontWeight: 700, color: 'var(--mint-d)' }}>
                              KES {kes % 1 === 0 ? kes : kes.toFixed(2)}
                            </span>
                          </div>
                        );
                      })}
                      <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 10, paddingBottom: 4 }}>
                        Prices based on your school size ({students.length} students).
                        Tokens never expire. Pay via M-Pesa.
                      </div>
                    </div>
                  </div>

                  <div className="card" style={{ marginTop: 16 }}>
                    <div className="card-body" style={{ padding: '10px 16px' }}>
                      <button
                        className="btn-secondary"
                        style={{ width: '100%', justifyContent: 'center', fontSize: 13 }}
                        onClick={() => setPanel('logs')}
                      >
                        🗂️ View All Message Logs →
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ── MESSAGE LOGS ── */}
        {panel === 'logs' && (
          <>
            <div className="page-header">
              <div>
                <div className="page-title">Message Logs</div>
                <div className="page-sub">Full history of SMS messages sent to parents</div>
              </div>
              <div className="page-actions">
                <button
                  className="btn-secondary"
                  onClick={loadLogs}
                  disabled={logsLoading}
                >
                  {logsLoading ? 'Loading...' : '🔄 Refresh'}
                </button>
                <button className="btn-primary" onClick={() => setPanel('messages')}>
                  + New SMS
                </button>
              </div>
            </div>
            <div className="page-body">
              {msgLogs.length > 0 && (
                <div className="stats-grid" style={{ marginBottom: 20 }}>
                  {[
                    {
                      label: 'Total Sent',
                      value: msgLogs.length,
                      sub: 'messages',
                      color: 'var(--ink)',
                    },
                    {
                      label: 'Tokens Spent',
                      value: msgLogs.reduce((a, m) => a + m.tokensUsed, 0),
                      sub: 'total consumed',
                      color: '#c4800a',
                    },
                    {
                      label: 'Recipients Reached',
                      value: msgLogs.reduce((a, m) => a + m.delivered, 0),
                      sub: 'parent SMSes',
                      color: 'var(--mint-d)',
                    },
                    {
                      label: 'Avg Cost/Send',
                      value: msgLogs.length
                        ? (msgLogs.reduce((a, m) => a + m.tokensUsed, 0) / msgLogs.length).toFixed(1)
                        : '—',
                      sub: 'tokens per send',
                      color: 'var(--blue)',
                    },
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
                  <div style={{ padding: 40, textAlign: 'center' }}>
                    <div className="spinner" style={{ margin: '0 auto 16px' }} />
                    <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Loading message logs…</div>
                  </div>
                ) : msgLogs.length === 0 ? (
                  <div style={{ padding: 48, textAlign: 'center' }}>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', marginBottom: 6 }}>
                      No messages yet
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 20 }}>
                      SMS messages you send will appear here with full delivery details.
                    </div>
                    <button className="btn-primary" onClick={() => setPanel('messages')}>
                      Send First SMS →
                    </button>
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Type</th>
                          <th>Message</th>
                          <th>Recipients</th>
                          <th style={{ textAlign: 'center' }}>Tokens</th>
                          <th>Status</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {msgLogs.map(msg => (
                          <MessageLogRow
                            key={msg.id}
                            msg={msg}
                            onResend={handleResend}
                            onPreview={setPreviewMsg}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {msgLogs.length > 0 && (
                  <div className="card-footer">
                    <span style={{ fontSize: 13, color: 'var(--text-2)' }}>
                      Showing {msgLogs.length} most recent messages
                    </span>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* ── REPORTS ── */}
        {panel === 'reports' && (
          <>
            <div className="page-header">
              <div>
                <div className="page-title">Reports</div>
                <div className="page-sub">Generate and export attendance &amp; school reports</div>
              </div>
            </div>
            <div className="page-body">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                {[
                  { icon: '📊', title: 'Termly Attendance Report', desc: 'Full attendance data per class and student for the current term' },
                  { icon: '📋', title: 'Weekly Summary', desc: 'Attendance rates per class for the selected week' },
                  { icon: '👤', title: 'Student Profile Report', desc: 'Individual attendance history for a selected student' },
                  { icon: '📲', title: 'SMS Communication Log', desc: 'All SMS messages sent to parents with token usage breakdown' },
                  { icon: '⚠️', title: 'Chronic Absentee Alert', desc: 'Students below 80% attendance threshold' },
                  { icon: '📖', title: 'Class Register Book', desc: 'Full printable register book format for a class' },
                ].map(r => (
                  <div
                    className="card"
                    key={r.title}
                    style={{ cursor: 'pointer' }}
                    onClick={() => toast(`📥 ${r.title} — export coming soon!`)}
                  >
                    <div className="card-body" style={{ textAlign: 'center', padding: 32 }}>
                      <div style={{ fontSize: 40, marginBottom: 12 }}>{r.icon}</div>
                      <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)', marginBottom: 6 }}>
                        {r.title}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text-2)' }}>{r.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ── SETTINGS ── */}
        {panel === 'settings' && (
          <>
            <div className="page-header">
              <div>
                <div className="page-title">Settings</div>
                <div className="page-sub">Manage your school profile and configuration</div>
              </div>
            </div>
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
                      <input
                        className="form-input"
                        value={schoolId}
                        readOnly
                        style={{ opacity: .6, fontFamily: "'DM Mono',monospace" }}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Admin Email</label>
                      <input className="form-input" defaultValue={userProfile.email || ''} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Admin Phone (SMS)</label>
                      <input className="form-input" defaultValue={userProfile.phone || ''} />
                    </div>
                    <button className="btn-primary" onClick={() => toast('✅ Settings saved!')}>
                      Save Changes
                    </button>
                  </div>
                </div>
                <div className="card">
                  <div className="card-header"><span className="card-title">Account</span></div>
                  <div className="card-body">
                    <div style={{ fontSize: 14, color: 'var(--text-2)', marginBottom: 16 }}>
                      <div style={{ marginBottom: 8 }}><strong>Name:</strong> {userProfile.displayName}</div>
                      <div style={{ marginBottom: 8 }}><strong>Email:</strong> {userProfile.email}</div>
                      <div style={{ marginBottom: 8 }}><strong>Phone:</strong> {userProfile.phone || 'Not set'}</div>
                      <div style={{ marginBottom: 8 }}><strong>Role:</strong> {userProfile.role}</div>
                      <div>
                        <strong>Member since:</strong>{' '}
                        {new Date(userProfile.createdAt).toLocaleDateString('en-KE', {
                          month: 'long', year: 'numeric',
                        })}
                      </div>
                    </div>
                    <div className="notice notice-info">
                      ℹ️ Both your email and phone number link to your account. You can sign in with either.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </main>

      {/* ── MESSAGE PREVIEW MODAL ── */}
      {previewMsg && (
        <div
          className="modal-overlay open"
          onClick={e => { if (e.target === e.currentTarget) setPreviewMsg(null); }}
        >
          <div className="modal" style={{ maxWidth: 540 }}>
            <div className="modal-header">
              <span className="modal-title">SMS Details</span>
              <button className="modal-close" onClick={() => setPreviewMsg(null)}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {[
                  ['Sent by', previewMsg.sentBy],
                  ['Date', new Date(previewMsg.sentAt).toLocaleString('en-KE')],
                  ['Type', previewMsg.type],
                  ['Recipients', `${previewMsg.recipients} (${previewMsg.recipientCount})`],
                  ['SMS parts', `${previewMsg.smsSegments} × 140 chars`],
                  ['KES rate', `KES ${previewMsg.costPerSegment}/token`],
                  ['Tokens used', String(previewMsg.tokensUsed)],
                  ['Delivered', `${previewMsg.delivered} / ${previewMsg.total}`],
                ].map(([k, v]) => (
                  <div key={k} style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 4 }}>
                      {k}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{v}</div>
                  </div>
                ))}
              </div>

              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 6 }}>
                  Message sent (sanitised)
                </div>
                <div style={{
                  background: 'var(--surface-2)', border: '1px solid var(--border)',
                  borderRadius: 10, padding: 14, fontSize: 13, lineHeight: 1.7,
                  fontFamily: "'DM Mono',monospace", color: 'var(--ink)',
                  whiteSpace: 'pre-wrap',
                }}>
                  {previewMsg.content}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
                  {previewMsg.content.length} characters (including spaces)
                </div>
              </div>

              {previewMsg.rawContent && previewMsg.rawContent !== previewMsg.content && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 6 }}>
                    Original (before cleanup)
                  </div>
                  <div style={{
                    background: 'rgba(232,69,69,.05)', border: '1px solid rgba(232,69,69,.15)',
                    borderRadius: 10, padding: 14, fontSize: 13, lineHeight: 1.7,
                    fontFamily: "'DM Mono',monospace", color: 'var(--text-2)',
                    whiteSpace: 'pre-wrap',
                  }}>
                    {previewMsg.rawContent}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: 12, paddingTop: 4 }}>
                <button
                  className="btn-primary"
                  onClick={() => { handleResend(previewMsg); setPreviewMsg(null); }}
                >
                  📋 Load for Resend
                </button>
                <button className="btn-secondary" onClick={() => setPreviewMsg(null)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── M-PESA TOP-UP MODAL ── */}
      <MpesaTopUpModal
        isOpen={showTopUp}
        onClose={() => setShowTopUp(false)}
        tier={tier}
        currentTokens={tokens}
        userId={user!.uid}
        schoolId={schoolId}
        schoolName={userProfile.schoolName}
        onSuccess={async (tokensAdded) => {
          // The webhook already credited tokens server-side.
          // We just refresh the profile to pull the new balance.
          try {
            await refreshProfile();
            toast(`🎉 ${tokensAdded} tokens added! New balance: ${tokens + tokensAdded}`);
          } catch {
            toast("⚠️ Top-up confirmed. Pull down to refresh your balance.");
          }
        }}
      />

      {/* MOBILE BOTTOM NAV */}
      <nav
        style={{
          display: 'none',
          position: 'fixed', bottom: 0, left: 0, right: 0,
          background: 'var(--ink)', borderTop: '1px solid rgba(255,255,255,.1)',
          padding: '8px 0 12px', zIndex: 200,
        }}
        className="mobile-bottom-nav"
      >
        {([
          { id: 'overview', icon: '🏠', label: 'Home' },
          { id: 'register', icon: '📋', label: 'Register' },
          { id: 'students', icon: '👥', label: 'Students' },
          { id: 'messages', icon: '📲', label: 'SMS' },
          { id: 'logs',     icon: '🗂️', label: 'Logs' },
        ] as { id: Panel; icon: string; label: string }[]).map(n => (
          <button
            key={n.id}
            onClick={() => setPanel(n.id)}
            style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
              gap: 3, background: 'transparent', border: 'none', cursor: 'pointer',
              color: panel === n.id ? 'var(--mint)' : 'rgba(255,255,255,.4)',
              fontFamily: "'Sora',sans-serif", fontSize: 10,
              fontWeight: panel === n.id ? 700 : 500,
              padding: '4px 0', transition: '.15s',
            }}
          >
            <span style={{ fontSize: 20 }}>{n.icon}</span>
            {n.label}
          </button>
        ))}
      </nav>

      {ToastEl}
    </div>
  );
}