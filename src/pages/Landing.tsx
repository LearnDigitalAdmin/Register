
import { useNavigate } from 'react-router-dom';

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div style={{ background: 'var(--ink)', color: '#fff', minHeight: '100vh' }}>
      {/* NAV */}
      <nav className="lp-nav">
        <div className="lp-logo">my<span>register</span></div>
        <div className="lp-nav-links">
          <a onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}>Features</a>
          <a onClick={() => document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' })}>Pricing</a>
          <a onClick={() => document.getElementById('about')?.scrollIntoView({ behavior: 'smooth' })}>About</a>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button className="btn-ghost-lp" onClick={() => navigate('/login')} style={{ padding: '9px 22px', border: '1px solid rgba(255,255,255,.2)', borderRadius: 8, color: '#fff', background: 'transparent', fontFamily: "'Sora',sans-serif", fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
            Sign In
          </button>
          <button onClick={() => navigate('/signup')} style={{ padding: '9px 22px', border: 'none', borderRadius: 8, background: 'var(--mint)', color: 'var(--ink)', fontFamily: "'Sora',sans-serif", fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
            Get Started Free
          </button>
        </div>
      </nav>

      {/* HERO */}
      <section style={{ padding: '100px 60px 80px', maxWidth: 1300, margin: '0 auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 80, alignItems: 'center' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--mint)', animation: 'pulse 2s infinite' }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--mint)', letterSpacing: '1.5px', textTransform: 'uppercase' }}>Live in Kenya</span>
          </div>
          <h1 style={{ fontSize: 58, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2, marginBottom: 24 }}>
            Kenya's smartest<br /><em style={{ fontStyle: 'normal', color: 'var(--mint)' }}>school register.</em>
          </h1>
          <p style={{ fontSize: 17, lineHeight: 1.7, color: 'rgba(255,255,255,.6)', marginBottom: 40, fontFamily: "'Literata',serif" }}>
            Digital attendance, WhatsApp parent notifications, assignment sharing, and full analytics — built for CBC and 8-4-4. Free platform, pay only for messages.
          </p>
          <div style={{ display: 'flex', gap: 14, marginBottom: 32 }}>
            <button onClick={() => navigate('/signup')} style={{ padding: '16px 32px', borderRadius: 10, background: 'var(--mint)', color: 'var(--ink)', border: 'none', fontFamily: "'Sora',sans-serif", fontSize: 15, fontWeight: 700, cursor: 'pointer' }}>
              Start for Free →
            </button>
            <button onClick={() => navigate('/login')} style={{ padding: '16px 32px', borderRadius: 10, background: 'transparent', color: '#fff', border: '1.5px solid rgba(255,255,255,.25)', fontFamily: "'Sora',sans-serif", fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
              Sign In
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,.4)' }}>Trusted by schools in</span>
            {['Nairobi', 'Nakuru', 'Mombasa', 'Kisumu'].map(c => (
              <span key={c} style={{ padding: '4px 12px', border: '1px solid rgba(255,255,255,.1)', borderRadius: 20, fontSize: 11, color: 'rgba(255,255,255,.5)', fontWeight: 500 }}>{c}</span>
            ))}
          </div>
        </div>

        {/* HERO VISUAL */}
        <div style={{ position: 'relative' }}>
          <div style={{ background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 20, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', background: 'rgba(255,255,255,.04)', borderBottom: '1px solid rgba(255,255,255,.07)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ display: 'flex', gap: 6 }}>
                {['#e84545','#f5a623','#00c896'].map(c => <div key={c} style={{ width: 10, height: 10, borderRadius: '50%', background: c, opacity: .7 }} />)}
              </div>
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,.5)', fontWeight: 500 }}>Grade 7A · Today's Register</span>
            </div>
            <div style={{ padding: 20 }}>
              {[
                { n: 'Achieng Otieno', adm: '1024-G7A-0001', s: 'present' },
                { n: 'Brian Kamau',    adm: '1024-G7A-0002', s: 'present' },
                { n: 'Cynthia Mwangi', adm: '1024-G7A-0003', s: 'absent' },
                { n: 'David Odhiambo', adm: '1024-G7A-0004', s: 'late' },
              ].map(r => (
                <div key={r.adm} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderRadius: 8, marginBottom: 6, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,.85)' }}>{r.n}</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,.35)', fontFamily: "'DM Mono',monospace" }}>{r.adm}</div>
                  </div>
                  <div className={`att-cell ${r.s}`}>{r.s === 'present' ? 'P' : r.s === 'absent' ? 'A' : 'L'}</div>
                </div>
              ))}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginTop: 14 }}>
                {[['34','Present'],['2','Absent'],['94%','Rate']].map(([v,l]) => (
                  <div key={l} style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 10, padding: 12, textAlign: 'center' }}>
                    <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--mint)' }}>{v}</div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,.35)', marginTop: 2, textTransform: 'uppercase', letterSpacing: .5 }}>{l}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div style={{ position: 'absolute', bottom: -20, left: -30, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 12, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--mint)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>📱</div>
            <div><div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)' }}>WhatsApp sent to</div><div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>2 parents</div></div>
          </div>
        </div>
      </section>

      {/* SERVICES */}
      <section id="features" style={{ padding: '80px 60px', borderTop: '1px solid rgba(255,255,255,.07)', maxWidth: 1300, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 60 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--mint)', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 }}>Our Products</div>
          <h2 style={{ fontSize: 42, fontWeight: 800, letterSpacing: -1.5, marginBottom: 16 }}>Everything your school needs.</h2>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,.5)', fontFamily: "'Literata',serif" }}>One platform. Multiple tools. Built for Kenyan schools.</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 24 }}>
          {[
            { icon: '📋', label: 'School Registry', title: 'Smart Attendance & Parent Comms', desc: 'Digital registers with one-tap marking, WhatsApp/SMS parent notifications, assignment sharing, and full attendance history with exportable PDFs.', live: true },
            { icon: '📚', label: 'Library System', title: 'Library Management', desc: 'Track books by class, subject, language. Issue books to students with QR code generation, and manage returns, conditions, and lost items.', live: false },
            { icon: '💰', label: 'Fee Management', title: 'Fee Collection & Receipting', desc: 'Track fee payments, send M-Pesa reminders, generate receipts, and manage arrears reports for every student.', live: false },
            { icon: '📝', label: 'Exams', title: 'Exam & Results Management', desc: 'Enter marks, auto-compute CBC or 8-4-4 grades, generate printable report cards, and push results directly to parents.', live: false },
            { icon: '👩‍💼', label: 'HR & Staff', title: 'Staff & HR Register', desc: 'Leave management, timetables, TSC number tracking, and payroll summaries for all teaching and support staff.', live: false },
            { icon: '🔧', label: 'Inventory', title: 'Asset & Inventory Register', desc: 'Track school furniture, computers, lab equipment, and sports gear.', live: false },
          ].map(s => (
            <div key={s.title} onClick={s.live ? () => navigate('/signup') : undefined} style={{ background: s.live ? 'rgba(0,200,150,.05)' : 'rgba(255,255,255,.04)', border: `1px solid ${s.live ? 'rgba(0,200,150,.25)' : 'rgba(255,255,255,.08)'}`, borderRadius: 20, padding: 32, cursor: s.live ? 'pointer' : 'default', position: 'relative', transition: '.3s' }}>
              <span style={{ position: 'absolute', top: 20, right: 20, padding: '4px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: s.live ? 'rgba(0,200,150,.15)' : 'rgba(255,255,255,.06)', color: s.live ? 'var(--mint)' : 'rgba(255,255,255,.35)', border: `1px solid ${s.live ? 'rgba(0,200,150,.3)' : 'rgba(255,255,255,.1)'}` }}>{s.live ? 'LIVE' : 'COMING SOON'}</span>
              <div style={{ width: 52, height: 52, borderRadius: 14, background: s.live ? 'rgba(0,200,150,.15)' : 'rgba(255,255,255,.07)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, marginBottom: 20 }}>{s.icon}</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: s.live ? 'var(--mint)' : 'rgba(255,255,255,.3)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>{s.label}</div>
              <h3 style={{ fontSize: 20, fontWeight: 700, marginBottom: 10 }}>{s.title}</h3>
              <p style={{ fontSize: 14, color: 'rgba(255,255,255,.5)', lineHeight: 1.7 }}>{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" style={{ padding: '80px 60px', borderTop: '1px solid rgba(255,255,255,.07)', maxWidth: 1300, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 60 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--mint)', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 }}>Pricing</div>
          <h2 style={{ fontSize: 42, fontWeight: 800, letterSpacing: -1.5, marginBottom: 16 }}>Totally free platform.</h2>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,.5)', fontFamily: "'Literata',serif" }}>Pay only for message tokens when you communicate with parents. The platform itself is always free.</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 24 }}>
          {[
            { name: 'Platform', price: 'Free', period: 'Forever', desc: 'The entire MyRegister platform — attendance, analytics, reports — at no cost.', features: ['Unlimited classes & students', 'Daily registers with PDF export', 'Full attendance history & analytics', 'Admin + Teacher roles', 'Assignment & notice management'], highlight: false },
            { name: 'Message Tokens', price: 'KSh 1', period: 'per SMS/WhatsApp', desc: 'Buy tokens when you need to notify parents. No subscription, no commitment.', features: ['100 free tokens on signup', 'WhatsApp & SMS delivery', 'Absence alerts to parents', 'Broadcast to class or all school', 'Top up via M-Pesa anytime'], highlight: true },
            { name: 'County / Group', price: 'Custom', period: 'Volume pricing', desc: 'For county education offices, school groups, and NGOs managing multiple schools.', features: ['Multiple schools under one account', 'Cross-school reporting & analytics', 'Dedicated onboarding & training', 'Bulk token discounts'], highlight: false },
          ].map(p => (
            <div key={p.name} style={{ background: p.highlight ? 'var(--mint)' : 'rgba(255,255,255,.04)', border: `1px solid ${p.highlight ? 'var(--mint)' : 'rgba(255,255,255,.08)'}`, borderRadius: 20, padding: 36, color: p.highlight ? 'var(--ink)' : '#fff' }}>
              <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 16, color: p.highlight ? 'rgba(13,17,23,.6)' : 'rgba(255,255,255,.5)' }}>{p.name}</div>
              <div style={{ fontSize: 48, fontWeight: 800, letterSpacing: -2 }}>{p.price}</div>
              <div style={{ fontSize: 14, color: p.highlight ? 'rgba(13,17,23,.6)' : 'rgba(255,255,255,.4)', marginBottom: 12 }}>{p.period}</div>
              <p style={{ fontSize: 14, color: p.highlight ? 'rgba(13,17,23,.65)' : 'rgba(255,255,255,.5)', marginBottom: 28, lineHeight: 1.6, fontFamily: "'Literata',serif" }}>{p.desc}</p>
              <hr style={{ border: 'none', borderTop: `1px solid ${p.highlight ? 'rgba(0,0,0,.1)' : 'rgba(255,255,255,.08)'}`, marginBottom: 24 }} />
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 32 }}>
                {p.features.map(f => (
                  <li key={f} style={{ fontSize: 14, color: p.highlight ? 'rgba(13,17,23,.8)' : 'rgba(255,255,255,.65)', display: 'flex', gap: 8, alignItems: 'flex-start', paddingBottom: 10, borderBottom: `1px solid ${p.highlight ? 'rgba(0,0,0,.06)' : 'rgba(255,255,255,.05)'}` }}>
                    <span style={{ color: p.highlight ? 'var(--ink)' : 'var(--mint)', fontWeight: 700, flexShrink: 0 }}>✓</span>{f}
                  </li>
                ))}
              </ul>
              <button onClick={() => navigate('/signup')} style={{ width: '100%', padding: 14, borderRadius: 10, fontFamily: "'Sora',sans-serif", fontSize: 14, fontWeight: 700, cursor: 'pointer', background: p.highlight ? 'var(--ink)' : 'transparent', color: p.highlight ? '#fff' : '#fff', border: p.highlight ? 'none' : '1.5px solid rgba(255,255,255,.2)' }}>
                {p.highlight ? 'Get Started Free →' : 'Get Started'}
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* FOOTER */}
      <footer id="about" style={{ borderTop: '1px solid rgba(255,255,255,.07)', padding: '60px', maxWidth: 1300, margin: '0 auto', display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 60 }}>
        <div>
          <div className="lp-logo">my<span>register</span></div>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,.4)', lineHeight: 1.7, marginTop: 12, maxWidth: 260, fontFamily: "'Literata',serif" }}>Kenya's school operations platform. Built for teachers, by people who care about education.</p>
        </div>
        {[
          { h: 'Product', links: ['Attendance', 'Parent Comms', 'Reports', 'Analytics'] },
          { h: 'Company', links: ['About', 'Blog', 'Careers', 'Contact'] },
          { h: 'Support', links: ['Help Center', 'WhatsApp Support', 'Privacy Policy', 'Terms'] },
        ].map(col => (
          <div key={col.h}>
            <h4 style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,.35)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 16 }}>{col.h}</h4>
            {col.links.map(l => <a key={l} href="#" style={{ display: 'block', fontSize: 14, color: 'rgba(255,255,255,.5)', textDecoration: 'none', marginBottom: 10 }}>{l}</a>)}
          </div>
        ))}
      </footer>
      <div style={{ borderTop: '1px solid rgba(255,255,255,.07)', padding: '24px 60px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,.3)' }}>© 2025 MyRegister. Made with ❤️ in Kenya.</p>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,.3)' }}>Platform free · Pay only for messages</p>
      </div>
    </div>
  );
}
