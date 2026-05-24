import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { collection, query, where, getDocs, addDoc, doc, updateDoc, setDoc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Student, AttendanceRecord, AttendanceStatus, Message } from '../types';
import { useToast } from '../useToast';

const STATUS_CYCLE: AttendanceStatus[] = ['present', 'absent', 'late', 'excused'];
const STATUS_LABEL: Record<AttendanceStatus, string> = { present: 'P', absent: 'A', late: 'L', excused: 'E' };

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

type Panel = 'overview' | 'register' | 'students' | 'messages' | 'reports' | 'settings';

export default function AppDashboard() {
  const { user, userProfile, logOut, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const { toast, ToastEl } = useToast();
  const [panel, setPanel] = useState<Panel>('overview');
  const [students, setStudents] = useState<Student[]>([]);
  const [attendance, setAttendance] = useState<Record<string, AttendanceStatus>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [registerLocked, setRegisterLocked] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [attFilter, setAttFilter] = useState<AttendanceStatus | 'all'>('all');
  const [msgContent, setMsgContent] = useState('');
  const [msgType, setMsgType] = useState('notice');
  const [msgChannel, setMsgChannel] = useState('whatsapp');
  const [msgTo, setMsgTo] = useState('All School');
  const [loading, setLoading] = useState(true);
  const [showAddStudent, setShowAddStudent] = useState(false);
  const [newStudent, setNewStudent] = useState({ name: '', parentName: '', parentPhone: '', parentWhatsApp: '' });

  const isAdmin = userProfile?.role === 'schoolAdmin';
  const schoolId = userProfile?.schoolId || '';
  const classCode = isAdmin ? (userProfile?.classCode || 'All') : (userProfile?.classCode || 'Grade 7A');
  const tokens = userProfile?.messageTokens ?? 0;

  useEffect(() => {
    if (userProfile) loadStudents();
  }, [userProfile]);

  async function loadStudents() {
    if (!schoolId) return;
    setLoading(true);
    try {
      const q = query(collection(db, 'students'), where('schoolId', '==', schoolId));
      const snap = await getDocs(q);
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as Student));
      setStudents(list);
      // Init attendance
      const init: Record<string, AttendanceStatus> = {};
      list.forEach(s => { init[s.id] = 'present'; });
      setAttendance(init);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
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
        date: today,
        classCode,
        schoolId,
        savedBy: userProfile.displayName,
        savedAt: new Date().toISOString(),
        locked: true,
        present: counts.present,
        absent: counts.absent,
        late: counts.late,
        excused: counts.excused,
        total: students.length,
      });
      // Save individual records
      for (const s of students) {
        await setDoc(doc(db, 'attendance', `${regId}_${s.id}`), {
          studentId: s.id,
          studentName: s.name,
          admissionNo: s.admissionNo,
          date: today,
          classCode,
          schoolId,
          status: attendance[s.id] || 'present',
          note: notes[s.id] || '',
          savedBy: userProfile.displayName,
          savedAt: new Date().toISOString(),
          locked: true,
        });
      }
      setRegisterLocked(true);
      toast(`✅ Register saved! ${counts.absent} parent notification${counts.absent !== 1 ? 's' : ''} queued.`);
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
        name: newStudent.name.trim(),
        admissionNo,
        classCode,
        schoolId,
        parentName: newStudent.parentName.trim(),
        parentPhone: newStudent.parentPhone.trim(),
        parentWhatsApp: newStudent.parentWhatsApp.trim() || newStudent.parentPhone.trim(),
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

  async function sendMessage() {
    if (!msgContent.trim() || !userProfile) return;
    const cost = 1; // 1 token per message
    if (tokens < cost) { toast('⚠️ Insufficient tokens. Top up to send messages.'); return; }
    try {
      await addDoc(collection(db, 'messages'), {
        schoolId,
        sentBy: userProfile.displayName,
        type: msgType,
        channel: msgChannel,
        recipients: msgTo,
        content: msgContent.trim(),
        tokensUsed: cost,
        sentAt: new Date().toISOString(),
        delivered: students.length,
        total: students.length,
      });
      // Deduct tokens
      await updateDoc(doc(db, 'users', user!.uid), { messageTokens: tokens - cost });
      await refreshProfile();
      toast(`✅ Message sent to ${students.length} parents!`);
      setMsgContent('');
    } catch (e: any) {
      toast('❌ ' + e.message);
    }
  }

  const filteredStudents = students.filter(s => {
    const q = searchQ.toLowerCase();
    const matchQ = !q || s.name.toLowerCase().includes(q) || s.admissionNo.toLowerCase().includes(q);
    const matchFilter = attFilter === 'all' || attendance[s.id] === attFilter;
    return matchQ && matchFilter;
  });

  const navItems: { id: Panel; icon: string; label: string; adminOnly?: boolean }[] = [
    { id: 'overview', icon: '🏠', label: 'Overview' },
    { id: 'register', icon: '📋', label: "Today's Register" },
    { id: 'students', icon: '👥', label: 'Students' },
    { id: 'messages', icon: '💬', label: 'Message Parents' },
    { id: 'reports', icon: '📊', label: 'Reports' },
    { id: 'settings', icon: '⚙️', label: 'Settings', adminOnly: true },
  ];

  if (!userProfile) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}><div className="spinner" /></div>;

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
            <button key={n.id} className={`nav-item${panel === n.id ? ' active' : ''}`} onClick={() => setPanel(n.id)}>
              <span className="nav-item-icon">{n.icon}</span>{n.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-user">
            <strong>{userProfile.displayName}</strong>
            {userProfile.email}
          </div>
          <div className="token-badge" style={{ marginBottom: 10, fontSize: 12 }}>
            🪙 {tokens} tokens
          </div>
          <button className="btn-secondary" style={{ width: '100%', justifyContent: 'center', fontSize: 13 }} onClick={async () => { await logOut(); navigate('/'); }}>
            Sign Out
          </button>
        </div>
      </aside>

      {/* MAIN */}
      <main className="main-content">
        {/* OVERVIEW */}
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
                  { label: 'Total Students', value: students.length, sub: classCode, color: 'var(--ink)' },
                  { label: 'Present Today', value: counts.present, sub: `${rate}% rate`, color: 'var(--mint-d)' },
                  { label: 'Absent Today', value: counts.absent, sub: 'need notification', color: 'var(--red)' },
                  { label: 'Msg Tokens', value: tokens, sub: 'remaining', color: '#c4800a' },
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
                      { label: '💬 Send Parent Message', action: () => setPanel('messages') },
                      { label: '📊 View Reports', action: () => setPanel('reports') },
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
                      { label: 'Absent', count: counts.absent, color: 'var(--red)' },
                      { label: 'Late', count: counts.late, color: 'var(--gold)' },
                      { label: 'Excused', count: counts.excused, color: 'var(--blue)' },
                    ].map(r => (
                      <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                        <div style={{ fontSize: 13, color: 'var(--text-2)', width: 70 }}>{r.label}</div>
                        <div className="att-bar-wrap" style={{ flex: 1 }}>
                          <div className="att-bar-fill" style={{ width: `${students.length ? (r.count / students.length) * 100 : 0}%`, background: r.color }} />
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
                <div className="notice notice-warning" style={{ marginTop: 0 }}>
                  ⚠️ You have {tokens} message tokens left. Top up via M-Pesa to continue sending parent notifications.
                </div>
              )}

              <div className="card">
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

        {/* REGISTER */}
        {panel === 'register' && (
          <>
            <div className="page-header">
              <div>
                <div className="page-title">Today's Register</div>
                <div className="page-sub">{classCode} · {new Date().toLocaleDateString('en-KE', { weekday: 'long', day: 'numeric', month: 'long' })} {registerLocked ? '· 🔒 Saved & Locked' : ''}</div>
              </div>
              <div className="page-actions">
                <div className="search-bar"><input type="text" placeholder="Search student..." value={searchQ} onChange={e => setSearchQ(e.target.value)} /></div>
                {!registerLocked
                  ? <button className="btn-primary" onClick={saveRegister}>💾 Save Register</button>
                  : <button className="btn-secondary" onClick={() => toast('📥 PDF export coming soon!')}>📥 Export PDF</button>}
              </div>
            </div>
            <div className="page-body">
              {registerLocked && <div className="notice notice-locked">🔒 This register has been saved and locked. It can no longer be edited.</div>}

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
                    {(['all', 'present', 'absent', 'late', 'excused'] as const).map(f => (
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
                          <td><div className={`att-cell ${attendance[s.id] || 'present'}`} onClick={() => toggleStatus(s.id)}>{STATUS_LABEL[attendance[s.id] || 'present']}</div></td>
                          <td><input style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '5px 8px', fontSize: 12, width: 120, outline: 'none', fontFamily: "'Sora',sans-serif" }} placeholder="Note..." value={notes[s.id] || ''} onChange={e => setNotes(prev => ({ ...prev, [s.id]: e.target.value }))} disabled={registerLocked} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="card-footer" style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                  {!registerLocked && (
                    <>
                      <button className="btn-xs btn-xs-mint" onClick={() => { const a: Record<string,AttendanceStatus> = {}; students.forEach(s => a[s.id]='present'); setAttendance(a); }}>Mark All Present</button>
                      <button className="btn-xs btn-xs-gray" onClick={() => { const a: Record<string,AttendanceStatus> = {}; students.forEach(s => a[s.id]='absent'); setAttendance(a); }}>Mark All Absent</button>
                    </>
                  )}
                  <span style={{ fontSize: 12, color: 'var(--text-3)', marginLeft: 'auto' }}>Click cells to cycle: P → A → L → E → P</span>
                </div>
              </div>
            </div>
          </>
        )}

        {/* STUDENTS */}
        {panel === 'students' && (
          <>
            <div className="page-header">
              <div>
                <div className="page-title">Students</div>
                <div className="page-sub">{classCode} · {students.length} students</div>
              </div>
              <div className="page-actions">
                <div className="search-bar"><input type="text" placeholder="Search..." value={searchQ} onChange={e => setSearchQ(e.target.value)} /></div>
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
                        <input className="form-input" type="text" placeholder="Full name" value={newStudent.name} onChange={e => setNewStudent(p => ({ ...p, name: e.target.value }))} />
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">Parent / Guardian Name</label>
                        <input className="form-input" type="text" placeholder="Parent name" value={newStudent.parentName} onChange={e => setNewStudent(p => ({ ...p, parentName: e.target.value }))} />
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">Parent Phone</label>
                        <input className="form-input" type="tel" placeholder="0722 123 456" value={newStudent.parentPhone} onChange={e => setNewStudent(p => ({ ...p, parentPhone: e.target.value }))} />
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">WhatsApp (if different)</label>
                        <input className="form-input" type="tel" placeholder="Leave blank if same" value={newStudent.parentWhatsApp} onChange={e => setNewStudent(p => ({ ...p, parentWhatsApp: e.target.value }))} />
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
                    <thead><tr><th>#</th><th>Student Name</th><th>Admission No.</th><th>Parent</th><th>Phone</th><th>WhatsApp</th><th>Today</th><th>Actions</th></tr></thead>
                    <tbody>
                      {students.filter(s => !searchQ || s.name.toLowerCase().includes(searchQ.toLowerCase()) || s.admissionNo.toLowerCase().includes(searchQ.toLowerCase())).map((s, i) => (
                        <tr key={s.id}>
                          <td style={{ color: 'var(--text-3)' }}>{i + 1}</td>
                          <td className="td-name">{s.name}</td>
                          <td className="td-mono">{s.admissionNo}</td>
                          <td>{s.parentName || '—'}</td>
                          <td className="td-mono">{s.parentPhone || '—'}</td>
                          <td className="td-mono">{s.parentWhatsApp || '—'}</td>
                          <td><div className={`att-cell ${attendance[s.id] || 'present'}`} style={{ cursor: 'default' }}>{STATUS_LABEL[attendance[s.id] || 'present']}</div></td>
                          <td className="td-actions">
                            <button className="btn-xs btn-xs-mint" onClick={() => { setMsgContent(`Dear ${s.parentName || 'Parent'}, ${s.name} was noted today. Please contact the school for more information.`); setPanel('messages'); toast('Message pre-filled for ' + s.name); }}>Msg</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="card-footer"><span style={{ fontSize: 13, color: 'var(--text-2)' }}>Showing {students.length} students</span></div>
              </div>
            </div>
          </>
        )}

        {/* MESSAGES */}
        {panel === 'messages' && (
          <>
            <div className="page-header">
              <div>
                <div className="page-title">Message Parents</div>
                <div className="page-sub">Send notifications to parents via WhatsApp or SMS</div>
              </div>
              <div className="token-badge">🪙 {tokens} tokens remaining</div>
            </div>
            <div className="page-body">
              {tokens === 0 && (
                <div className="notice notice-warning">
                  ⚠️ You have no tokens. <strong>Top up via M-Pesa</strong> to send messages to parents. The platform itself remains free.
                  <button className="btn-secondary" style={{ marginLeft: 16, fontSize: 12 }} onClick={() => toast('M-Pesa payment integration coming soon! Contact us: 0700-MY-REGISTER')}>Top Up Now</button>
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 24 }}>
                <div className="card">
                  <div className="card-header"><span className="card-title">Compose Message</span></div>
                  <div className="card-body">
                    <div className="form-group">
                      <label className="form-label">Message Type</label>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {['📢 Notice','📝 Assignment','🎉 Activity','⚠️ Absence Alert','💬 Custom'].map(t => {
                          const key = t.split(' ').slice(1).join(' ').toLowerCase().split(' ')[0];
                          return <div key={t} className={`chip${msgType === key ? ' active' : ''}`} onClick={() => setMsgType(key)}>{t}</div>;
                        })}
                      </div>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Send To</label>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {['All School', classCode, ...(['admin'].includes(userProfile.role) ? ['Grade 6A', 'Grade 5A'] : [])].map(c => (
                          <div key={c} className={`chip${msgTo === c ? ' active' : ''}`} onClick={() => setMsgTo(c)}>{c}</div>
                        ))}
                      </div>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Channel</label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {['💬 WhatsApp','📲 SMS','Both'].map(ch => {
                          const key = ch.split(' ').slice(-1)[0].toLowerCase();
                          return <div key={ch} className={`chip${msgChannel === key ? ' active' : ''}`} onClick={() => setMsgChannel(key)}>{ch}</div>;
                        })}
                      </div>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Message</label>
                      <textarea className="form-input" rows={5} placeholder="Type your message to parents here..." value={msgContent} onChange={e => setMsgContent(e.target.value)} style={{ resize: 'vertical' }} />
                    </div>
                    <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, fontSize: 13, color: 'var(--text-2)', marginBottom: 16 }}>
                      📊 <strong style={{ color: 'var(--ink)' }}>{students.length} parents</strong> will receive this message · Cost: <strong style={{ color: 'var(--ink)' }}>1 token</strong> (per send)
                    </div>
                    <button className="btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={sendMessage} disabled={!msgContent.trim() || tokens === 0}>
                      Send to Parents →
                    </button>
                  </div>
                </div>

                <div>
                  <div className="card" style={{ marginBottom: 16 }}>
                    <div className="card-header"><span className="card-title">Message Credits</span></div>
                    <div className="card-body">
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13 }}>
                        <span style={{ color: 'var(--text-2)' }}>Tokens Remaining</span>
                        <strong>{tokens}</strong>
                      </div>
                      <div className="att-bar-wrap" style={{ marginBottom: 16 }}>
                        <div className="att-bar-fill" style={{ width: `${Math.min(100, (tokens / 100) * 100)}%` }} />
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 12 }}>1 token = 1 send (all parents in selected group)</div>
                      <button className="btn-secondary" style={{ width: '100%', justifyContent: 'center' }} onClick={() => toast('M-Pesa top-up coming soon! Call 0700-MYREGISTER for now.')}>
                        💳 Top Up via M-Pesa
                      </button>
                    </div>
                  </div>
                  <div className="card">
                    <div className="card-header"><span className="card-title">Token Packages</span></div>
                    <div className="card-body">
                      {[['50 tokens','KSh 50'],['200 tokens','KSh 180'],['500 tokens','KSh 400'],['1000 tokens','KSh 750']].map(([tokens, price]) => (
                        <div key={tokens} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                          <span style={{ fontWeight: 600 }}>{tokens}</span>
                          <span style={{ color: 'var(--text-2)' }}>{price}</span>
                        </div>
                      ))}
                      <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 12 }}>All purchases via M-Pesa. Tokens never expire.</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* REPORTS */}
        {panel === 'reports' && (
          <>
            <div className="page-header">
              <div><div className="page-title">Reports</div><div className="page-sub">Generate and export attendance & school reports</div></div>
            </div>
            <div className="page-body">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                {[
                  { icon: '📊', title: 'Termly Attendance Report', desc: 'Full attendance data per class and student for the current term' },
                  { icon: '📋', title: 'Weekly Summary', desc: 'Attendance rates per class for the selected week' },
                  { icon: '👤', title: 'Student Profile Report', desc: 'Individual attendance history for a selected student' },
                  { icon: '💬', title: 'Communication Log', desc: 'All messages sent to parents — SMS and WhatsApp' },
                  { icon: '⚠️', title: 'Chronic Absentee Alert', desc: `Students below 80% attendance threshold` },
                  { icon: '📖', title: 'Class Register Book', desc: 'Full printable register book format for a class' },
                ].map(r => (
                  <div className="card" key={r.title} style={{ cursor: 'pointer' }} onClick={() => toast(`📥 ${r.title} — export coming soon!`)}>
                    <div className="card-body" style={{ textAlign: 'center', padding: 32 }}>
                      <div style={{ fontSize: 40, marginBottom: 12 }}>{r.icon}</div>
                      <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)', marginBottom: 6 }}>{r.title}</div>
                      <div style={{ fontSize: 13, color: 'var(--text-2)' }}>{r.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* SETTINGS */}
        {panel === 'settings' && (
          <>
            <div className="page-header">
              <div><div className="page-title">Settings</div><div className="page-sub">Manage your school profile and configuration</div></div>
            </div>
            <div className="page-body">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                <div className="card">
                  <div className="card-header"><span className="card-title">School Profile</span></div>
                  <div className="card-body">
                    <div className="form-group"><label className="form-label">School Name</label><input className="form-input" defaultValue={userProfile.schoolName} /></div>
                    <div className="form-group"><label className="form-label">School ID</label><input className="form-input" value={schoolId} readOnly style={{ opacity: .6, fontFamily: "'DM Mono',monospace" }} /></div>
                    <div className="form-group"><label className="form-label">Admin Email</label><input className="form-input" defaultValue={userProfile.email || ''} /></div>
                    <div className="form-group"><label className="form-label">Admin Phone</label><input className="form-input" defaultValue={userProfile.phone || ''} /></div>
                    <button className="btn-primary" onClick={() => toast('✅ Settings saved!')}>Save Changes</button>
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
                      <div><strong>Member since:</strong> {new Date(userProfile.createdAt).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' })}</div>
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

      {/* MOBILE BOTTOM NAV */}
      <nav style={{
        display: 'none',
        position: 'fixed', bottom: 0, left: 0, right: 0,
        background: 'var(--ink)', borderTop: '1px solid rgba(255,255,255,.1)',
        padding: '8px 0 12px', zIndex: 200,
        // shown via CSS below
      }} className="mobile-bottom-nav">
        {([
          { id: 'overview',  icon: '🏠', label: 'Home' },
          { id: 'register',  icon: '📋', label: 'Register' },
          { id: 'students',  icon: '👥', label: 'Students' },
          { id: 'messages',  icon: '💬', label: 'Messages' },
          { id: 'reports',   icon: '📊', label: 'Reports' },
        ] as { id: Panel; icon: string; label: string }[]).map(n => (
          <button key={n.id} onClick={() => setPanel(n.id)} style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: 3, background: 'transparent', border: 'none', cursor: 'pointer',
            color: panel === n.id ? 'var(--mint)' : 'rgba(255,255,255,.4)',
            fontFamily: "'Sora',sans-serif", fontSize: 10, fontWeight: panel === n.id ? 700 : 500,
            padding: '4px 0', transition: '.15s',
          }}>
            <span style={{ fontSize: 20 }}>{n.icon}</span>
            {n.label}
          </button>
        ))}
      </nav>

      {ToastEl}
    </div>
  );
}
