import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import SignupWizard from '../components/SignupWizard';
import ContactUs, { ContactButton } from '../components/ContactUs';

type Tab = 'login' | 'signup';

export default function AuthPage({ defaultTab = 'login' }: { defaultTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(defaultTab);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showContact, setShowContact] = useState(false);
  const navigate = useNavigate();
  const { signIn, signUp } = useAuth();

  // Login state
  const [loginId, setLoginId] = useState(''); // email or phone
  const [loginPw, setLoginPw] = useState('');

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
              : 'Set up your school in a few short steps. The platform is completely free — you only pay for message tokens when notifying parents.'}
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <ContactButton onClick={() => setShowContact(true)} variant="ghost" />
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.25)', paddingTop: 20, borderTop: '1px solid rgba(255,255,255,.06)' }}>
            🔒 Secured by Firebase Authentication · Data stored in Europe (GDPR-ready)
          </div>
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

          {tab === 'login' ? (
            <form onSubmit={handleLogin}>
              <div style={{ fontSize: 26, fontWeight: 800, color: '#fff', marginBottom: 8, letterSpacing: -1 }}>Sign in</div>
              <div style={{ fontSize: 14, color: 'rgba(255,255,255,.4)', marginBottom: 28 }}>Use your email or Kenyan phone number</div>

              {error && <div className="error-msg">{error}</div>}

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
            <SignupWizard
              signUp={signUp}
              onSuccess={() => navigate('/app')}
              onSwitchToLogin={() => setTab('login')}
            />
          )}
        </div>
      </div>

      <ContactUs isOpen={showContact} onClose={() => setShowContact(false)} />
    </div>
  );
}
