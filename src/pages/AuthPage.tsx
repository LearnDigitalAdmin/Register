import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';

type Tab = 'login' | 'signup';

export default function AuthPage({ defaultTab = 'login' }: { defaultTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(defaultTab);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { signIn, signUp } = useAuth();

  // Login state
  const [loginId, setLoginId] = useState(''); // email or phone
  const [loginPw, setLoginPw] = useState('');

  // Signup state
  const [suName, setSuName] = useState('');
  const [suEmail, setSuEmail] = useState('');
  const [suPhone, setSuPhone] = useState('');
  const [suPw, setSuPw] = useState('');
  const [suPw2, setSuPw2] = useState('');
  // const [suRole, setSuRole] = useState<'admin' | 'teacher'>('admin');
  const [suRole, setSuRole] = useState<'schoolAdmin' | 'teacherAdmin'>('schoolAdmin');
// and the map:

  const [suSchoolName, setSuSchoolName] = useState('');
  const [suSchoolId, setSuSchoolId] = useState(''); // for teachers joining
  const [suClass, setSuClass] = useState('');
  const [suCounty, setSuCounty] = useState('');

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      await signIn(loginId.trim(), loginPw);
      navigate('/app');
    } catch (err: any) {
      setError(err.message || 'Login failed. Check your credentials.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setError(''); 
    if (suPw !== suPw2) { setError('Passwords do not match.'); return; }
    if (suPw.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (!suPhone && !suEmail) { setError('Please provide an email or phone number.'); return; }
    setLoading(true);
    try {
      await signUp({
        email: suEmail.trim(),
        phone: suPhone.trim(),
        password: suPw,
        displayName: suName.trim(),
        role: suRole,
        schoolName: suSchoolName.trim(),
        schoolId: suRole === 'teacherAdmin' ? suSchoolId.trim() : undefined,
        classCode: suRole === 'teacherAdmin' ? suClass.trim() : undefined,
        county: suCounty.trim(),
      });
      navigate('/app');
    } catch (err: any) {
      setError(err.message || 'Sign up failed. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ background: 'var(--ink)', minHeight: '100vh', display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
      {/* LEFT */}
      <div style={{ background: 'linear-gradient(160deg,#0d1117 60%,#0a2e22)', borderRight: '1px solid rgba(255,255,255,.07)', padding: '52px 48px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', letterSpacing: -1, marginBottom: 6, cursor: 'pointer' }} onClick={() => navigate('/')}>
            my<span style={{ color: 'var(--mint)' }}>register</span>
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.3)', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 40 }}>Kenya's School Platform</div>
          <h2 style={{ fontSize: 36, fontWeight: 800, color: '#fff', letterSpacing: -1.5, lineHeight: 1.1, marginBottom: 14 }}>
            {tab === 'login' ? 'Welcome back.' : 'Join thousands of Kenyan teachers.'}
          </h2>
          <p style={{ fontSize: 15, color: 'rgba(255,255,255,.5)', lineHeight: 1.75, fontFamily: "'Literata',serif", marginBottom: 32 }}>
            {tab === 'login'
              ? 'Sign in to manage your class register, notify parents, and track attendance — all in one place.'
              : 'Set up your school in minutes. The platform is completely free — you only pay for message tokens when notifying parents.'}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[
              ['📋', 'Digital class registers with one-tap marking'],
              ['📱', 'WhatsApp & SMS parent notifications'],
              ['📊', 'Attendance analytics & PDF reports'],
              ['🎓', 'Built for CBC and 8-4-4 curriculum'],
            ].map(([icon, text]) => (
              <div key={text as string} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 13, color: 'rgba(255,255,255,.55)' }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(0,200,150,.12)', border: '1px solid rgba(0,200,150,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>{icon}</div>
                {text}
              </div>
            ))}
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,.25)', paddingTop: 20, borderTop: '1px solid rgba(255,255,255,.06)' }}>
          🔒 Secured by Firebase Authentication · Data stored in Europe (GDPR-ready)
        </div>
      </div>

      {/* RIGHT */}
      <div style={{ padding: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', overflowY: 'auto' }}>
        <div style={{ width: '100%', maxWidth: 420 }}>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,.05)', borderRadius: 10, padding: 4, marginBottom: 32 }}>
            {(['login', 'signup'] as Tab[]).map(t => (
              <button key={t} onClick={() => { setTab(t); setError(''); }} style={{ flex: 1, padding: 10, border: 'none', borderRadius: 8, fontFamily: "'Sora',sans-serif", fontSize: 13, fontWeight: 600, cursor: 'pointer', background: tab === t ? 'var(--mint)' : 'transparent', color: tab === t ? 'var(--ink)' : 'rgba(255,255,255,.4)', transition: '.2s' }}>
                {t === 'login' ? 'Sign In' : 'Sign Up'}
              </button>
            ))}
          </div>

          {error && <div className="error-msg">{error}</div>}

          {tab === 'login' ? (
            <form onSubmit={handleLogin}>
              <div style={{ fontSize: 26, fontWeight: 800, color: '#fff', marginBottom: 8, letterSpacing: -1 }}>Sign in</div>
              <div style={{ fontSize: 14, color: 'rgba(255,255,255,.4)', marginBottom: 28 }}>Use your email or Kenyan phone number</div>

              <div className="form-group">
                <label className="form-label" style={{ color: 'rgba(255,255,255,.5)' }}>Email or Phone</label>
                <input className="form-input" style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', color: '#fff' }}
                  type="text" placeholder="admin@school.ke or 0722..." value={loginId} onChange={e => setLoginId(e.target.value)} required />
              </div>
              <div className="form-group">
                <label className="form-label" style={{ color: 'rgba(255,255,255,.5)' }}>Password</label>
                <input className="form-input" style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', color: '#fff' }}
                  type="password" placeholder="••••••••" value={loginPw} onChange={e => setLoginPw(e.target.value)} required />
              </div>
              <button className="btn-primary" type="submit" disabled={loading} style={{ width: '100%', justifyContent: 'center', padding: 15, fontSize: 15, marginTop: 8 }}>
                {loading ? 'Signing in...' : 'Sign In →'}
              </button>
              <div style={{ marginTop: 20, padding: 14, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 10, fontSize: 13, color: 'rgba(255,255,255,.4)', lineHeight: 1.6 }}>
                Don't have an account? <span style={{ color: 'var(--mint)', cursor: 'pointer', fontWeight: 600 }} onClick={() => setTab('signup')}>Sign up free →</span>
              </div>
            </form>
          ) : (
            <form onSubmit={handleSignup}>
              <div style={{ fontSize: 26, fontWeight: 800, color: '#fff', marginBottom: 8, letterSpacing: -1 }}>Create account</div>
              <div style={{ fontSize: 14, color: 'rgba(255,255,255,.4)', marginBottom: 28 }}>Free forever — pay only for messages</div>

              <div className="form-group">
                <label className="form-label" style={{ color: 'rgba(255,255,255,.5)' }}>Your Name</label>
                <input className="form-input" style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', color: '#fff' }}
                  type="text" placeholder="Ms. Njeri Wanjiku" value={suName} onChange={e => setSuName(e.target.value)} required />
              </div>

              {/* Role selector */}
              <div className="form-group">
                <label className="form-label" style={{ color: 'rgba(255,255,255,.5)' }}>I am signing up as</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {(['schoolAdmin', 'teacherAdmin'] as const).map(r => (
                    <button key={r} type="button" onClick={() => setSuRole(r)} style={{ flex: 1, padding: '10px 14px', border: `1.5px solid ${suRole === r ? 'var(--mint)' : 'rgba(255,255,255,.1)'}`, borderRadius: 10, background: suRole === r ? 'rgba(0,200,150,.1)' : 'rgba(255,255,255,.04)', color: suRole === r ? 'var(--mint)' : 'rgba(255,255,255,.5)', fontFamily: "'Sora',sans-serif", fontSize: 13, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize' }}>
                      {r === 'schoolAdmin' ? '🏫 School Admin' : '👩‍🏫 Teacher'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" style={{ color: 'rgba(255,255,255,.5)' }}>Email Address</label>
                <input className="form-input" style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', color: '#fff' }}
                  type="email" placeholder="you@school.ke" value={suEmail} onChange={e => setSuEmail(e.target.value)} required />
              </div>

              <div className="form-group">
                <label className="form-label" style={{ color: 'rgba(255,255,255,.5)' }}>Phone Number <span style={{ color: 'rgba(255,255,255,.3)', fontSize: 11, textTransform: 'none', letterSpacing: 0 }}>(optional but links your account)</span></label>
                <input className="form-input" style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', color: '#fff' }}
                  type="tel" placeholder="0722 123 456" value={suPhone} onChange={e => setSuPhone(e.target.value)} />
              </div>

              {suRole === 'schoolAdmin' ? (
                <>
                  <div className="form-group">
                    <label className="form-label" style={{ color: 'rgba(255,255,255,.5)' }}>School Name</label>
                    <input className="form-input" style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', color: '#fff' }}
                      type="text" placeholder="Westlands Primary School" value={suSchoolName} onChange={e => setSuSchoolName(e.target.value)} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label" style={{ color: 'rgba(255,255,255,.5)' }}>County</label>
                    
                      <select className="form-select" style={{ background: '#1e2730', border: '1px solid rgba(255,255,255,.1)', color: '#fff' }}
                        value={suCounty} onChange={e => setSuCounty(e.target.value)}>
                        <option value="" style={{ background: '#1e2730', color: '#fff' }}>Select county...</option>
                        
                          {[
                            'Baringo','Bomet','Bungoma','Busia','Elgeyo-Marakwet','Embu','Garissa',
                            'Homa Bay','Isiolo','Kajiado','Kakamega','Kericho','Kiambu','Kilifi',
                            'Kirinyaga','Kisii','Kisumu','Kitui','Kwale','Laikipia','Lamu','Machakos',
                            'Makueni','Mandera','Marsabit','Meru','Migori','Mombasa','Murang\'a',
                            'Nairobi','Nakuru','Nandi','Narok','Nyamira','Nyandarua','Nyeri',
                            'Samburu','Siaya','Taita-Taveta','Tana River','Tharaka-Nithi','Trans Nzoia',
                            'Turkana','Uasin Gishu','Vihiga','Wajir','West Pokot'
                          ].map(c => (
                            <option key={c} value={c} style={{ background: '#1e2730', color: '#fff' }}>{c}</option>
                          ))}
                      </select>
                  </div>
                </>
              ) : (
                <>
                  <div className="form-group">
                    <label className="form-label" style={{ color: 'rgba(255,255,255,.5)' }}>School ID <span style={{ color: 'rgba(255,255,255,.3)', fontSize: 11 }}>(from your admin)</span></label>
                    <input className="form-input" style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', color: '#fff' }}
                      type="text" placeholder="SCH-ABC123" value={suSchoolId} onChange={e => setSuSchoolId(e.target.value)} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label" style={{ color: 'rgba(255,255,255,.5)' }}>Your Class</label>
                    <input className="form-input" style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', color: '#fff' }}
                      type="text" placeholder="Grade 7A" value={suClass} onChange={e => setSuClass(e.target.value)} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label" style={{ color: 'rgba(255,255,255,.5)' }}>School Name</label>
                    <input className="form-input" style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', color: '#fff' }}
                      type="text" placeholder="Westlands Primary School" value={suSchoolName} onChange={e => setSuSchoolName(e.target.value)} required />
                  </div>
                </>
              )}

              <div className="form-group">
                <label className="form-label" style={{ color: 'rgba(255,255,255,.5)' }}>Password</label>
                <input className="form-input" style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', color: '#fff' }}
                  type="password" placeholder="Min. 6 characters" value={suPw} onChange={e => setSuPw(e.target.value)} required />
              </div>
              <div className="form-group">
                <label className="form-label" style={{ color: 'rgba(255,255,255,.5)' }}>Confirm Password</label>
                <input className="form-input" style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', color: '#fff' }}
                  type="password" placeholder="Repeat password" value={suPw2} onChange={e => setSuPw2(e.target.value)} required />
              </div>

              <div style={{ background: 'rgba(0,200,150,.07)', border: '1px solid rgba(0,200,150,.15)', borderRadius: 10, padding: 12, fontSize: 12, color: 'rgba(255,255,255,.5)', marginBottom: 16, lineHeight: 1.6 }}>
                🎁 <strong style={{ color: 'rgba(255,255,255,.7)' }}>100 free message tokens</strong> on signup. The platform is free forever — tokens are only for WhatsApp/SMS parent notifications.
              </div>

              <button className="btn-primary" type="submit" disabled={loading} style={{ width: '100%', justifyContent: 'center', padding: 15, fontSize: 15, marginTop: 8 }}>
                {loading ? 'Creating account...' : 'Create Free Account →'}
              </button>

              <div style={{ marginTop: 20, padding: 14, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 10, fontSize: 13, color: 'rgba(255,255,255,.4)', lineHeight: 1.6 }}>
                Already have an account? <span style={{ color: 'var(--mint)', cursor: 'pointer', fontWeight: 600 }} onClick={() => setTab('login')}>Sign in →</span>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

