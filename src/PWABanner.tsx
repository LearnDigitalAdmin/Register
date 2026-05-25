/**
 * PWABanner.tsx
 * Add <PWABanner /> inside <AuthProvider> in App.tsx (outside Routes is fine).
 *
 * Shows:
 *  - "Add to Home Screen" banner when installable
 *  - "Update available" toast when a new SW is waiting
 *  - "You're offline" bar at the top when connection drops
 */

import { useEffect, useState } from 'react';
import { usePWA } from './usePWA';

export default function PWABanner() {
  const {
    isInstallable,
    isInstalled,
    isOnline,
    isUpdateReady,
    promptInstall,
    applyUpdate,
  } = usePWA();

  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (isInstalled) {
      console.log('[PWA] Running as installed app');
    }
  }, [isInstalled]);

  return (
    <>
      {/* ── Offline Bar ──────────────────────────────────────────────── */}
      {!isOnline && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
          background: '#e84545', color: '#fff',
          padding: '10px 20px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 10, fontSize: 13, fontWeight: 600,
          fontFamily: "'Sora', sans-serif",
        }}>
          <span>📡</span>
          <span>You're offline — data will sync when connection returns.</span>
        </div>
      )}

      {/* ── Update Available Toast ────────────────────────────────────── */}
      {isUpdateReady && (
        <div style={{
          position: 'fixed', bottom: 88, left: '50%',
          transform: 'translateX(-50%)',
          background: '#1e2730', border: '1px solid rgba(255,255,255,.12)',
          color: '#fff', borderRadius: 14,
          padding: '14px 20px',
          display: 'flex', alignItems: 'center', gap: 14,
          fontSize: 13, fontFamily: "'Sora', sans-serif",
          boxShadow: '0 8px 40px rgba(0,0,0,0.35)',
          zIndex: 9998, whiteSpace: 'nowrap',
        }}>
          <span style={{ fontSize: 20 }}>🔄</span>
          <div>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>Update available</div>
            <div style={{ color: 'rgba(255,255,255,.5)', fontSize: 12 }}>
              A new version of MyRegister is ready.
            </div>
          </div>
          <button
            onClick={applyUpdate}
            style={{
              background: '#00c896', color: '#0d1117',
              border: 'none', borderRadius: 8,
              padding: '8px 16px',
              fontFamily: "'Sora', sans-serif",
              fontSize: 13, fontWeight: 700, cursor: 'pointer',
              marginLeft: 8,
            }}
          >
            Update
          </button>
        </div>
      )}

      {/* ── Install Banner ────────────────────────────────────────────── */}
      {isInstallable && !isInstalled && !dismissed && (
        <div style={{
          position: 'fixed', bottom: 88, right: 20,
          background: '#1e2730', border: '1px solid rgba(0,200,150,.25)',
          color: '#fff', borderRadius: 16,
          padding: '16px 20px', maxWidth: 320,
          fontFamily: "'Sora', sans-serif",
          boxShadow: '0 8px 40px rgba(0,0,0,0.35)',
          zIndex: 9997,
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
            <img
              src="/icons/manifest-icon-192.maskable.png"
              alt="MyRegister"
              style={{ width: 44, height: 44, borderRadius: 10, flexShrink: 0 }}
            />
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
                Install MyRegister
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,.5)', lineHeight: 1.5 }}>
                Add to your home screen for faster access and offline support.
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={promptInstall}
              style={{
                flex: 1, background: '#00c896', color: '#0d1117',
                border: 'none', borderRadius: 8, padding: '10px',
                fontFamily: "'Sora', sans-serif",
                fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}
            >
              📲 Install App
            </button>
            <button
              onClick={() => setDismissed(true)}
              style={{
                background: 'rgba(255,255,255,.06)', color: 'rgba(255,255,255,.5)',
                border: '1px solid rgba(255,255,255,.08)',
                borderRadius: 8, padding: '10px 14px',
                fontFamily: "'Sora', sans-serif",
                fontSize: 13, cursor: 'pointer',
              }}
            >
              Not now
            </button>
          </div>
        </div>
      )}
    </>
  );
}