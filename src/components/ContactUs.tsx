/**
 * src/components/ContactUs.tsx
 */

import React, { useState } from 'react';

interface Props {
  isOpen:  boolean;
  onClose: () => void;
}

const PHONE     = '0791286165';
const PHONE_HREF= 'tel:+254791286165';
const WA_HREF   = 'https://wa.me/254791286165';
const WA_NUM    = '+254 791 286 165';
const EMAIL     = 'info@cogvana.co.ke';
const EMAIL_HREF= 'mailto:info@cogvana.co.ke';

// ─── Contact row ──────────────────────────────────────────────────────────────

function ContactRow({
  icon, label, value, href, tag,
}: {
  icon: string;
  label: string;
  value: string;
  href: string;
  tag?: string;
}) {
  const [copied, setCopied] = useState(false);

  function handleCopy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
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
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '12px 14px',
        background: 'var(--surface-2)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        textDecoration: 'none',
        transition: 'border-color .18s, background .18s',
        cursor: 'pointer',
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLAnchorElement;
        el.style.borderColor = 'var(--mint)';
        el.style.background  = 'rgba(0,200,150,.04)';
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLAnchorElement;
        el.style.borderColor = 'var(--border)';
        el.style.background  = 'var(--surface-2)';
      }}
    >
      {/* Icon bubble */}
      <div style={{
        width: 38, height: 38, borderRadius: 10, flexShrink: 0,
        background: 'rgba(0,200,150,.1)',
        border: '1px solid rgba(0,200,150,.2)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 18,
      }}>
        {icon}
      </div>

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 10, fontWeight: 700, color: 'var(--text-3)',
          textTransform: 'uppercase', letterSpacing: .6, marginBottom: 2,
        }}>
          {label}
        </div>
        <div style={{
          fontSize: 14, fontWeight: 600, color: 'var(--ink)',
          fontFamily: "'DM Mono', monospace",
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {value}
        </div>
      </div>

      {/* Right: tag + copy + arrow */}
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
            border: `1px solid ${copied ? 'rgba(0,200,150,.35)' : 'var(--border)'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', fontSize: 12, color: copied ? 'var(--mint-d)' : 'var(--text-2)',
            transition: 'all .15s', flexShrink: 0,
            fontFamily: 'inherit',
          }}
        >
          {copied ? '✓' : '⧉'}
        </button>
        <span style={{ fontSize: 16, color: 'var(--text-3)' }}>›</span>
      </div>
    </a>
  );
}

// ─── Link card ────────────────────────────────────────────────────────────────

function LinkCard({
  icon, label, sub, url, accent, border, color,
}: {
  icon: string; label: string; sub: string; url: string;
  accent: string; border: string; color: string;
}) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '13px 16px',
        background: accent,
        border: `1px solid ${border}`,
        borderRadius: 12,
        textDecoration: 'none',
        transition: 'opacity .15s',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.opacity = '.82'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.opacity = '1'; }}
    >
      <div style={{
        width: 38, height: 38, borderRadius: 10, flexShrink: 0,
        background: 'rgba(255,255,255,.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 18,
      }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', marginBottom: 1 }}>
          {label}
        </div>
        <div style={{ fontSize: 11, color, fontFamily: "'DM Mono', monospace" }}>
          {sub}
        </div>
      </div>
      <span style={{ fontSize: 16, color, flexShrink: 0 }}>↗</span>
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
            <div className="modal-title">📬 Contact Us</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 3 }}>
              We're here to help — reach us any way you prefer.
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Direct contact rows */}
        <div style={{ marginBottom: 20 }}>
          <div style={{
            fontSize: 10, fontWeight: 700, color: 'var(--text-3)',
            textTransform: 'uppercase', letterSpacing: .8, marginBottom: 10,
          }}>
            Direct Contact
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <ContactRow
              icon="📞"
              label="Call Us"
              value={PHONE}
              href={PHONE_HREF}
              tag="Call"
            />
            <ContactRow
              icon="💬"
              label="WhatsApp"
              value={WA_NUM}
              href={WA_HREF}
              tag="WhatsApp"
            />
            <ContactRow
              icon="✉️"
              label="Email"
              value={EMAIL}
              href={EMAIL_HREF}
            />
          </div>
        </div>

        {/* Quick-action buttons */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 22 }}>
          <a
            href={WA_HREF}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '11px 14px', borderRadius: 10,
              background: '#25d366', color: '#fff',
              fontFamily: "'Sora', sans-serif", fontSize: 13, fontWeight: 700,
              textDecoration: 'none', transition: 'opacity .15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.opacity = '.88'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.opacity = '1'; }}
          >
            💬 Chat on WhatsApp
          </a>
          <a
            href={PHONE_HREF}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '11px 14px', borderRadius: 10,
              background: 'var(--mint)', color: 'var(--ink)',
              fontFamily: "'Sora', sans-serif", fontSize: 13, fontWeight: 700,
              textDecoration: 'none', transition: 'background .15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.background = 'var(--mint-d)'; (e.currentTarget as HTMLAnchorElement).style.color = '#fff'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.background = 'var(--mint)'; (e.currentTarget as HTMLAnchorElement).style.color = 'var(--ink)'; }}
          >
            📞 Call Now
          </a>
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: 'var(--border)', marginBottom: 20 }} />

        {/* Other products */}
        <div style={{ marginBottom: 20 }}>
          <div style={{
            fontSize: 10, fontWeight: 700, color: 'var(--text-3)',
            textTransform: 'uppercase', letterSpacing: .8, marginBottom: 10,
          }}>
            Our Other Products
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <LinkCard
              icon="🌐"
              label="Cogvana"
              sub="cogvana.co.ke"
              url="https://cogvana.co.ke"
              accent="rgba(0,200,150,.07)"
              border="rgba(0,200,150,.22)"
              color="var(--mint-d)"
            />
            <LinkCard
              icon="🏢"
              label="Properties Management"
              sub="pms.cogvana.co.ke"
              url="https://pms.cogvana.co.ke"
              accent="rgba(44,111,173,.08)"
              border="rgba(44,111,173,.22)"
              color="var(--blue)"
            />
          </div>
        </div>

        {/* Footer note */}
        <div style={{
          padding: '10px 14px',
          background: 'var(--surface-2)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          fontSize: 12, color: 'var(--text-3)',
          lineHeight: 1.6, textAlign: 'center',
        }}>
          Part of <strong style={{ color: 'var(--text-2)' }}>Cogvana</strong> · Built with care in Kenya 🇰🇪
        </div>
      </div>
    </div>
  );
}

// ─── Convenience trigger ──────────────────────────────────────────────────────

export function ContactButton({
  onClick,
  variant = 'secondary',
}: {
  onClick: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
}) {
  const base: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 8,
    padding: '10px 18px', borderRadius: 10,
    fontFamily: "'Sora', sans-serif", fontSize: 13, fontWeight: 600,
    cursor: 'pointer', transition: 'opacity .15s',
    border: 'none',
  };
  const variants: Record<string, React.CSSProperties> = {
    primary:   { background: 'var(--mint)',                   color: 'var(--ink)' },
    secondary: { background: 'var(--surface)',                color: 'var(--text)',              border: '1px solid var(--border)' },
    ghost:     { background: 'rgba(255,255,255,.06)',         color: 'rgba(255,255,255,.55)',    border: '1px solid rgba(255,255,255,.12)' },
  };

  return (
    <button
      onClick={onClick}
      style={{ ...base, ...variants[variant] }}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '.8'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}
    >
      📬 Contact Us
    </button>
  );
}