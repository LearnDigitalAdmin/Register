import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import ContactUs from '../components/ContactUs';

export default function Landing() {
  const navigate = useNavigate();
  const [showContact, setShowContact] = useState(false);

  return (
    <div style={{ background: 'var(--ink)', color: '#fff', minHeight: '100vh' }}>
      <style>{`
        .lp-nav {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 20px;
          position: sticky;
          top: 0;
          z-index: 100;
          background: var(--ink);
          border-bottom: 1px solid rgba(255,255,255,.07);
        }
        .lp-nav-links { display: none; }
        .hero-grid {
          padding: 56px 20px 60px;
          display: flex;
          flex-direction: column;
          gap: 48px;
          max-width: 1300px;
          margin: 0 auto;
        }
        .hero-h1 { font-size: 38px; font-weight: 800; line-height: 1.08; letter-spacing: -1.5px; margin-bottom: 16px; }
        .hero-p  { font-size: 15px; line-height: 1.7; color: rgba(255,255,255,.6); margin-bottom: 32px; font-family: 'Literata', serif; }
        .hero-btns { display: flex; flex-direction: column; gap: 12px; margin-bottom: 28px; }
        .hero-btns button { width: 100%; padding: 15px 24px; }
        .hero-badges { flex-wrap: wrap; gap: 8px; }
        .hero-visual-wrap { position: relative; padding-bottom: 24px; }
        .sms-pill {
          position: absolute; bottom: 0; left: 0;
          background: rgba(255,255,255,.05);
          border: 1px solid rgba(255,255,255,.12);
          border-radius: 12px; padding: 10px 14px;
          display: flex; align-items: center; gap: 10;
        }
        .section-pad { padding: 60px 20px; max-width: 1300px; margin: 0 auto; border-top: 1px solid rgba(255,255,255,.07); }
        .features-grid { display: grid; grid-template-columns: 1fr; gap: 16px; }
        .section-h2 { font-size: 30px; font-weight: 800; letter-spacing: -1px; margin-bottom: 12px; }
        .pricing-explainer {
          background: rgba(0,200,150,.05); border: 1px solid rgba(0,200,150,.2);
          border-radius: 16px; padding: 24px 20px; margin-bottom: 32px;
          display: flex; flex-direction: column; gap: 28px;
        }
        .pricing-grid { display: grid; grid-template-columns: 1fr; gap: 20px; }
        .footer-grid {
          display: grid; grid-template-columns: 1fr 1fr; gap: 40px;
          padding: 48px 20px; max-width: 1300px; margin: 0 auto;
          border-top: 1px solid rgba(255,255,255,.07);
        }
        .footer-brand { grid-column: 1 / -1; }
        .bottom-bar {
          border-top: 1px solid rgba(255,255,255,.07);
          padding: 20px;
          display: flex; flex-direction: column; gap: 6px; align-items: center; text-align: center;
        }
        @media (min-width: 640px) {
          .lp-nav { padding: 18px 40px; }
          .hero-grid { padding: 72px 40px 72px; }
          .hero-h1 { font-size: 48px; }
          .hero-btns { flex-direction: row; }
          .hero-btns button { width: auto; }
          .features-grid { grid-template-columns: repeat(2, 1fr); }
          .pricing-explainer { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; }
          .pricing-grid { grid-template-columns: repeat(2, 1fr); }
          .section-pad { padding: 72px 40px; }
          .footer-grid { padding: 56px 40px; grid-template-columns: 2fr 1fr 1fr; }
          .footer-brand { grid-column: auto; }
          .bottom-bar { padding: 24px 40px; flex-direction: row; justify-content: space-between; }
        }
        @media (min-width: 1024px) {
          .lp-nav { padding: 20px 60px; }
          .lp-nav-links { display: flex; gap: 32px; }
          .lp-nav-links a { font-size: 14px; color: rgba(255,255,255,.6); cursor: pointer; text-decoration: none; transition: color .2s; }
          .lp-nav-links a:hover { color: #fff; }
          .hero-grid { padding: 100px 60px 80px; display: grid; grid-template-columns: 1fr 1fr; gap: 80px; align-items: center; }
          .hero-h1 { font-size: 58px; letter-spacing: -2px; }
          .features-grid { grid-template-columns: repeat(3, 1fr); }
          .pricing-grid { grid-template-columns: repeat(3, 1fr); }
          .section-pad { padding: 80px 60px; }
          .footer-grid { grid-template-columns: 2fr 1fr 1fr 1fr; padding: 60px; }
          .bottom-bar { padding: 24px 60px; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: .5; transform: scale(1.4); }
        }
      `}</style>

      {/* NAV */}
      <nav className="lp-nav">
        <div className="lp-logo">MY<span>REGISTER</span></div>
        <div className="lp-nav-links">
          <a onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}>Features</a>
          <a onClick={() => document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' })}>Pricing</a>
          <a onClick={() => document.getElementById('about')?.scrollIntoView({ behavior: 'smooth' })}>About</a>
          <a onClick={() => setShowContact(true)}>Contact</a>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => navigate('/login')}
            style={{ padding: '8px 16px', border: '1px solid rgba(255,255,255,.2)', borderRadius: 8, color: '#fff', background: 'transparent', fontFamily: "'Sora',sans-serif", fontSize: 13, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            Sign In
          </button>
          <button
            onClick={() => navigate('/signup')}
            style={{ padding: '8px 16px', border: 'none', borderRadius: 8, background: 'var(--mint)', color: 'var(--ink)', fontFamily: "'Sora',sans-serif", fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            Get Started
          </button>
        </div>
      </nav>

      {/* HERO */}
      <section className="hero-grid">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--mint)', animation: 'pulse 2s infinite', flexShrink: 0 }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--mint)', letterSpacing: '1.5px', textTransform: 'uppercase' }}>Live in Kenya</span>
          </div>
          <h1 className="hero-h1">
            Kenya's smartest<br /><em style={{ fontStyle: 'normal', color: 'var(--mint)' }}>school register.</em>
          </h1>
          <p className="hero-p">
            Digital attendance, SMS parent notifications, assignment sharing, and full analytics — built for CBC and 8-4-4. Free platform, pay only for SMS messages.
          </p>
          <div className="hero-btns">
            <button
              onClick={() => navigate('/signup')}
              style={{ padding: '15px 28px', borderRadius: 10, background: 'var(--mint)', color: 'var(--ink)', border: 'none', fontFamily: "'Sora',sans-serif", fontSize: 15, fontWeight: 700, cursor: 'pointer' }}
            >
              Start for Free →
            </button>
            <button
              onClick={() => navigate('/login')}
              style={{ padding: '15px 28px', borderRadius: 10, background: 'transparent', color: '#fff', border: '1.5px solid rgba(255,255,255,.25)', fontFamily: "'Sora',sans-serif", fontSize: 15, fontWeight: 600, cursor: 'pointer' }}
            >
              Sign In
            </button>
          </div>
          <div className="hero-badges" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,.4)', flexShrink: 0 }}>Trusted in</span>
            {['Nairobi', 'Nakuru', 'Mombasa', 'Kisumu'].map(c => (
              <span key={c} style={{ padding: '4px 10px', border: '1px solid rgba(255,255,255,.1)', borderRadius: 20, fontSize: 11, color: 'rgba(255,255,255,.5)', fontWeight: 500, whiteSpace: 'nowrap' }}>{c}</span>
            ))}
          </div>
        </div>

        {/* HERO VISUAL */}
        <div className="hero-visual-wrap">
          <div style={{ background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 20, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', background: 'rgba(255,255,255,.04)', borderBottom: '1px solid rgba(255,255,255,.07)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ display: 'flex', gap: 6 }}>
                {['#e84545', '#f5a623', '#00c896'].map(c => (
                  <div key={c} style={{ width: 10, height: 10, borderRadius: '50%', background: c, opacity: .7 }} />
                ))}
              </div>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', fontWeight: 500 }}>Grade 7A · Today's Register</span>
            </div>
            <div style={{ padding: 16 }}>
              {[
                { n: 'Achieng Otieno',  adm: '1024-G7A-0001', s: 'present' },
                { n: 'Brian Kamau',     adm: '1024-G7A-0002', s: 'present' },
                { n: 'Cynthia Mwangi', adm: '1024-G7A-0003', s: 'absent' },
                { n: 'David Odhiambo', adm: '1024-G7A-0004', s: 'late' },
              ].map(r => (
                <div key={r.adm} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 10px', borderRadius: 8, marginBottom: 6, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,.85)' }}>{r.n}</div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,.35)', fontFamily: "'DM Mono',monospace" }}>{r.adm}</div>
                  </div>
                  <div className={`att-cell ${r.s}`}>{r.s === 'present' ? 'P' : r.s === 'absent' ? 'A' : 'L'}</div>
                </div>
              ))}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 12 }}>
                {[['34', 'Present'], ['2', 'Absent'], ['94%', 'Rate']].map(([v, l]) => (
                  <div key={l} style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 10, padding: '10px 8px', textAlign: 'center' }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--mint)' }}>{v}</div>
                    <div style={{ fontSize: 9, color: 'rgba(255,255,255,.35)', marginTop: 2, textTransform: 'uppercase', letterSpacing: .5 }}>{l}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="sms-pill">
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--mint)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>📲</div>
            <div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,.5)' }}>SMS sent to</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>2 parents</div>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="section-pad">
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--mint)', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 }}>Our Products</div>
          <h2 className="section-h2">Everything your school needs.</h2>
          <p style={{ fontSize: 15, color: 'rgba(255,255,255,.5)', fontFamily: "'Literata',serif" }}>One platform. Multiple tools. Built for Kenyan schools.</p>
        </div>
        <div className="features-grid">
          {[
            { icon: '📋', label: 'School Registry', title: 'Smart Attendance & Parent Comms', desc: 'Digital registers with one-tap marking, SMS parent notifications, assignment sharing, and full attendance history with exportable PDFs.', live: true },
            { icon: '📚', label: 'Library System', title: 'Library Management', desc: 'Track books by class, subject, language. Issue books to students with QR code generation, and manage returns, conditions, and lost items.', live: false },
            { icon: '💰', label: 'Fee Management', title: 'Fee Collection & Receipting', desc: 'Track fee payments, send M-Pesa reminders, generate receipts, and manage arrears reports for every student.', live: false },
            { icon: '📝', label: 'Exams', title: 'Exam & Results Management', desc: 'Enter marks, auto-compute CBC or 8-4-4 grades, generate printable report cards, and push results directly to parents via SMS.', live: false },
            { icon: '👩‍💼', label: 'HR & Staff', title: 'Staff & HR Register', desc: 'Leave management, timetables, TSC number tracking, and payroll summaries for all teaching and support staff.', live: false },
            { icon: '🔧', label: 'Inventory', title: 'Asset & Inventory Register', desc: 'Track school furniture, computers, lab equipment, and sports gear.', live: false },
          ].map(s => (
            <div
              key={s.title}
              onClick={s.live ? () => navigate('/signup') : undefined}
              style={{
                background: s.live ? 'rgba(0,200,150,.05)' : 'rgba(255,255,255,.04)',
                border: `1px solid ${s.live ? 'rgba(0,200,150,.25)' : 'rgba(255,255,255,.08)'}`,
                borderRadius: 20, padding: '24px 20px',
                cursor: s.live ? 'pointer' : 'default',
                position: 'relative', transition: '.3s',
              }}
            >
              <span style={{
                position: 'absolute', top: 16, right: 16,
                padding: '4px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700,
                background: s.live ? 'rgba(0,200,150,.15)' : 'rgba(255,255,255,.06)',
                color: s.live ? 'var(--mint)' : 'rgba(255,255,255,.35)',
                border: `1px solid ${s.live ? 'rgba(0,200,150,.3)' : 'rgba(255,255,255,.1)'}`,
              }}>
                {s.live ? 'LIVE' : 'COMING SOON'}
              </span>
              <div style={{ width: 48, height: 48, borderRadius: 12, background: s.live ? 'rgba(0,200,150,.15)' : 'rgba(255,255,255,.07)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, marginBottom: 16 }}>{s.icon}</div>
              <div style={{ fontSize: 10, fontWeight: 600, color: s.live ? 'var(--mint)' : 'rgba(255,255,255,.3)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>{s.label}</div>
              <h3 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>{s.title}</h3>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,.5)', lineHeight: 1.7 }}>{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="section-pad">
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--mint)', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 }}>Pricing</div>
          <h2 className="section-h2">Totally free platform.</h2>
          <p style={{ fontSize: 15, color: 'rgba(255,255,255,.5)', fontFamily: "'Literata',serif" }}>
            Pay only for SMS tokens when you communicate with parents. The platform itself is always free.
          </p>
        </div>
        <div className="pricing-explainer">
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--mint)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
              How SMS token pricing works
            </div>
            <p style={{ fontSize: 14, color: 'rgba(255,255,255,.6)', lineHeight: 1.75, fontFamily: "'Literata',serif" }}>
              Tokens are priced per SMS part per recipient. One SMS = 140 characters.
              A 285-character message counts as 2 SMS parts (140 + 145). Sending that to 10 parents costs 20 tokens.
              Emojis and special characters are automatically stripped. Maximum message length is 400 characters (3 SMS parts).
            </p>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.4)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
              Cost per SMS part by school size
            </div>
            {[
              { range: '≤ 100 recipients', rate: '0.7 tokens / SMS part', example: '10 parents × 2 parts = 14 tokens' },
              { range: '101 – 300 recipients', rate: '0.5 tokens / SMS part', example: '200 parents × 1 part = 100 tokens' },
              { range: '> 300 recipients', rate: '0.4 tokens / SMS part', example: '400 parents × 3 parts = 480 tokens' },
            ].map(row => (
              <div key={row.range} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                padding: '10px 12px', borderRadius: 10, marginBottom: 6,
                background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.07)',
                gap: 12,
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,.75)' }}>{row.range}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,.35)', marginTop: 2 }}>{row.example}</div>
                </div>
                <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--mint)', whiteSpace: 'nowrap', paddingTop: 2, flexShrink: 0 }}>
                  {row.rate}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="pricing-grid">
          {[
            {
              name: 'Platform', price: 'Free', period: 'Forever',
              desc: 'The entire MyRegister platform — attendance, analytics, reports — at no cost.',
              features: ['Unlimited classes & students','Daily registers with PDF export','Full attendance history & analytics','Admin + Teacher roles','Assignment & notice management'],
              highlight: false,
            },
            {
              name: 'SMS Tokens', price: 'From 0.4', period: 'tokens per SMS part',
              desc: 'Buy tokens when you need to notify parents. No subscription, no commitment.',
              features: ['100 free tokens on signup','Plain-text SMS delivery','Absence alerts to parents','Broadcast to class or all school','Top up via M-Pesa anytime','Tokens never expire'],
              highlight: true,
              subDetail: '0.7 tok (≤100) · 0.5 tok (≤300) · 0.4 tok (300+)',
            },
            {
              name: 'County / Group', price: 'Custom', period: 'Volume pricing',
              desc: 'For county education offices, school groups, and NGOs managing multiple schools.',
              features: ['Multiple schools under one account','Cross-school reporting & analytics','Dedicated onboarding & training','Bulk token discounts'],
              highlight: false,
            },
          ].map(p => (
            <div key={p.name} style={{
              background: p.highlight ? 'var(--mint)' : 'rgba(255,255,255,.04)',
              border: `1px solid ${p.highlight ? 'var(--mint)' : 'rgba(255,255,255,.08)'}`,
              borderRadius: 20, padding: '28px 24px',
              color: p.highlight ? 'var(--ink)' : '#fff',
            }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 14, color: p.highlight ? 'rgba(13,17,23,.6)' : 'rgba(255,255,255,.5)' }}>{p.name}</div>
              <div style={{ fontSize: 44, fontWeight: 800, letterSpacing: -2 }}>{p.price}</div>
              <div style={{ fontSize: 13, color: p.highlight ? 'rgba(13,17,23,.6)' : 'rgba(255,255,255,.4)', marginBottom: 4 }}>{p.period}</div>
              {'subDetail' in p && p.subDetail && (
                <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(13,17,23,.5)', background: 'rgba(13,17,23,.08)', borderRadius: 6, padding: '3px 8px', display: 'inline-block', marginBottom: 8 }}>
                  {p.subDetail}
                </div>
              )}
              <p style={{ fontSize: 14, color: p.highlight ? 'rgba(13,17,23,.65)' : 'rgba(255,255,255,.5)', marginBottom: 24, lineHeight: 1.6, fontFamily: "'Literata',serif", marginTop: 10 }}>{p.desc}</p>
              <hr style={{ border: 'none', borderTop: `1px solid ${p.highlight ? 'rgba(0,0,0,.1)' : 'rgba(255,255,255,.08)'}`, marginBottom: 20 }} />
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 0, marginBottom: 28 }}>
                {p.features.map(f => (
                  <li key={f} style={{ fontSize: 14, color: p.highlight ? 'rgba(13,17,23,.8)' : 'rgba(255,255,255,.65)', display: 'flex', gap: 8, alignItems: 'flex-start', paddingBottom: 10, paddingTop: 10, borderBottom: `1px solid ${p.highlight ? 'rgba(0,0,0,.06)' : 'rgba(255,255,255,.05)'}` }}>
                    <span style={{ color: p.highlight ? 'var(--ink)' : 'var(--mint)', fontWeight: 700, flexShrink: 0 }}>✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => navigate('/signup')}
                style={{ width: '100%', padding: 14, borderRadius: 10, fontFamily: "'Sora',sans-serif", fontSize: 14, fontWeight: 700, cursor: 'pointer', background: p.highlight ? 'var(--ink)' : 'transparent', color: '#fff', border: p.highlight ? 'none' : '1.5px solid rgba(255,255,255,.2)' }}
              >
                {p.highlight ? 'Get Started Free →' : 'Get Started'}
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* FOOTER */}
      <footer id="about" className="footer-grid">
        <div className="footer-brand">
          <div className="lp-logo">my<span>register</span></div>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,.4)', lineHeight: 1.7, marginTop: 12, maxWidth: 260, fontFamily: "'Literata',serif" }}>
            Kenya's school operations platform. Built for teachers, by people who care about education.
          </p>
          {/* Contact button in footer */}
          <button
            onClick={() => setShowContact(true)}
            style={{
              marginTop: 16, display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '9px 16px', borderRadius: 8,
              background: 'rgba(0,200,150,.1)', border: '1px solid rgba(0,200,150,.22)',
              color: 'var(--mint)', fontFamily: "'Sora',sans-serif",
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            📬 Contact Us
          </button>
        </div>
        {[
          { h: 'Product', links: ['Attendance', 'Parent SMS', 'Reports', 'Analytics'] },
          { h: 'Company', links: ['About', 'Blog', 'Careers', 'Contact'] },
          { h: 'Support', links: ['Help Center', 'SMS Support', 'Privacy Policy', 'Terms'] },
        ].map(col => (
          <div key={col.h}>
            <h4 style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.35)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 14 }}>
              {col.h}
            </h4>
            {col.links.map(l => (
              <a
                key={l}
                href="#"
                onClick={l === 'Contact' ? (e) => { e.preventDefault(); setShowContact(true); } : undefined}
                style={{ display: 'block', fontSize: 13, color: 'rgba(255,255,255,.5)', textDecoration: 'none', marginBottom: 10 }}
              >
                {l}
              </a>
            ))}
          </div>
        ))}
      </footer>

      <div className="bottom-bar">
        <p style={{ fontSize: 12, color: 'rgba(255,255,255,.3)', margin: 0 }}>© 2025 SAMUHIA BUSINESSES. Made with love in Kenya.</p>
        <p style={{ fontSize: 12, color: 'rgba(255,255,255,.3)', margin: 0 }}>Platform free · Pay only for SMS</p>
      </div>

      {/* Contact modal */}
      <ContactUs isOpen={showContact} onClose={() => setShowContact(false)} />
    </div>
  );
}