/**
 * src/components/ContactUs.tsx
 *
 * Contact Us modal — matches the MyRegister dark design system.
 * Import and use:
 *   import ContactUs from './components/ContactUs';
 *   <ContactUs isOpen={showContact} onClose={() => setShowContact(false)} />
 *
 * Also export a small trigger button:
 *   import { ContactButton } from './components/ContactUs';
 */

import React, { useState } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  isOpen:  boolean;
  onClose: () => void;
}

// ─── Data ─────────────────────────────────────────────────────────────────────

const CONTACTS = {
  phone:     '0791286165',
  phoneHref: 'tel:+254791286165',
  wa:        '+254791286165',
  waHref:    'https://wa.me/254791286165',
  email:     'info@cogvana.co.ke',
  emailHref: 'mailto:info@cogvana.co.ke',
};

const LINKS = [
  {
    label:   'Cogvana',
    sub:     'Our main web presence',
    url:     'https://cogvana.co.ke',
    icon:    '🌐',
    accent:  'rgba(0,200,150,.15)',
    border:  'rgba(0,200,150,.25)',
    color:   'var(--mint-d)',
  },
  {
    label:   'Properties Management',
    sub:     'pms.cogvana.co.ke',
    url:     'https://pms.cogvana.co.ke',
    icon:    '🏢',
    accent:  'rgba(44,111,173,.12)',
    border:  'rgba(44,111,173,.25)',
    color:   'var(--blue)',
  },
];

// ─── Helper: contact row ──────────────────────────────────────────────────────

function ContactRow({
  icon, label, value, href, tag,
}: {
  icon: string; label: string; value: string; href: string; tag?: string;
}) {
  const [copied, setCopied] = useState(false);

  function handleCopy(e: React.MouseEvent) {
    e.preventDefault();
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  return (
    <a
      href={href}
      target={href.startsWith('http') ? '_blank' : undefined}
      rel="noopener noreferrer"
      style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '13px 16px',
        background: 'var(--surface-2)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        textDecoration: 'none',
        transition: 'border-color .18s, background .18s',
        cursor: 'pointer',
        position: 'relative',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--mint)';
        (e.currentTarget as HTMLAnchorElement).style.background  = 'rgba(0,200,150,.04)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--border)';
        (e.currentTarget as HTMLAnchorElement).style.background  = 'var(--surface-2)';
      }}
    >
      <div style={{
        width: 38, height: 38, borderRadius: 10, flexShrink: 0,
        background: 'rgba(0,200,150,.1)', border: '1px solid rgba(0,200,150,.2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 18,
      }}>
        {icon}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 2 }}>
          {label}
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', fontFamily: "'DM Mono', monospace", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {value}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        {tag && (
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 20,
            background: 'rgba(0,200,150,.1)', color: 'var(--mint-d)',
            border: '1px solid rgba(0,200,150,.2)',
          }}>
            {tag}
          </span>
        )}
        <button
          onClick={handleCopy}
          title="Copy"
          style={{
            width: 28, height: 28, borderRadius: 7,
            background: copied ? 'rgba(0,200,150,.15)' : 'rgba(0,0,0,.04)',
            border: `1px solid ${copied ? 'rgba(0,200,150,.3)' : 'var(--border)'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', fontSize: 12, transition: 'background .15s',
          }}
        >
          {copied ? '✓' : '⧉'}
        </button>
        <span style={{ fontSize: 16, color: 'var(--text-3)' }}>›</span>
      </div>
    </a>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────

export default function ContactUs({ isOpen, onClose }: Props) {
  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay open"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal" style={{ maxWidth: 520 }}>

        {/* Header */}
        <div className="modal-header">
          <div>
            <div className="modal-title">Contact Us</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 3 }}>
              We're here to help — reach us any way you prefer.
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Direct contact */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: .8, marginBottom: 10 }}>
            Direct Contact
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <ContactRow
              icon="📞"
              label="Call Us"
              value={CONTACTS.phone}
              href={CONTACTS.phoneHref}
              tag="Calls"
            />
            <ContactRow
              icon="💬"
              label="WhatsApp"
              value={CONTACTS.wa}
              href={CONTACTS.waHref}
              tag="WhatsApp"
            />
            <ContactRow
              icon="✉️"
              label="Email"
              value={CONTACTS.email}
              href={CONTACTS.emailHref}
            />
          </div>
        </div>

        {/* Quick actions */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 24 }}>
          <a
            href={CONTACTS.waHref}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '11px 16px', borderRadius: 10,
              background: '#25d366', color: '#fff',
              fontFamily: "'Sora', sans-serif", fontSize: 13, fontWeight: 700,
              textDecoration: 'none', transition: 'opacity .15s',
            }}
            onMouseEnter={e => (e.currentTarget as HTMLAnchorElement).style.opacity = '.88'}
            onMouseLeave={e => (e.currentTarget as HTMLAnchorElement).style.opacity = '1'}
          >
            💬 Chat on WhatsApp
          </a>
          <a
            href={CONTACTS.phoneHref}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '11px 16px', borderRadius: 10,
              background: 'var(--mint)', color: 'var(--ink)',
              fontFamily: "'Sora', sans-serif", fontSize: 13, fontWeight: 700,
              textDecoration: 'none', transition: 'background .15s',
            }}
            onMouseEnter={e => (e.currentTarget as HTMLAnchorElement).style.background = 'var(--mint-d)'}
            onMouseLeave={e => (e.currentTarget as HTMLAnchorElement).style.background = 'var(--mint)'}
          >
            📞 Call Now
          </a>
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: 'var(--border)', marginBottom: 20 }} />

        {/* Our other products */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: .8, marginBottom: 10 }}>
            Our Other Products
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {LINKS.map(l => (
              <a
                key={l.url}
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  padding: '13px 16px',
                  background: l.accent,
                  border: `1px solid ${l.border}`,
                  borderRadius: 12,
                  textDecoration: 'none',
                  transition: 'opacity .15s',
                }}
                onMouseEnter={e => (e.currentTarget as HTMLAnchorElement).style.opacity = '.82'}
                onMouseLeave={e => (e.currentTarget as HTMLAnchorElement).style.opacity = '1'}
              >
                <div style={{
                  width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                  background: 'rgba(255,255,255,.5)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 18,
                }}>
                  {l.icon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', marginBottom: 1 }}>
                    {l.label}
                  </div>
                  <div style={{ fontSize: 11, color: l.color, fontFamily: "'DM Mono', monospace" }}>
                    {l.sub}
                  </div>
                </div>
                <span style={{ fontSize: 16, color: l.color }}>↗</span>
              </a>
            ))}
          </div>
        </div>

        {/* Footer note */}
        <div style={{
          marginTop: 20, padding: '10px 14px',
          background: 'var(--surface-2)', border: '1px solid var(--border)',
          borderRadius: 10, fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6,
          textAlign: 'center',
        }}>
          Part of <strong style={{ color: 'var(--text-2)' }}>Cogvana</strong> · Built with care in Kenya 🇰🇪
        </div>
      </div>
    </div>
  );
}

// ─── Convenience trigger button ────────────────────────────────────────────────

export function ContactButton({
  onClick,
  variant = 'secondary',
}: {
  onClick: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
}) {
  const styles: Record<string, React.CSSProperties> = {
    primary: {
      background: 'var(--mint)', color: 'var(--ink)',
      border: 'none',
    },
    secondary: {
      background: 'var(--surface)', color: 'var(--text)',
      border: '1px solid var(--border)',
    },
    ghost: {
      background: 'transparent',
      color: 'rgba(255,255,255,.55)',
      border: '1px solid rgba(255,255,255,.12)',
    },
  };

  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '10px 18px', borderRadius: 10,
        fontFamily: "'Sora', sans-serif", fontSize: 13, fontWeight: 600,
        cursor: 'pointer', transition: 'opacity .15s',
        ...styles[variant],
      }}
      onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.opacity = '.82'}
      onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.opacity = '1'}
    >
      📬 Contact Us
    </button>
  );
}