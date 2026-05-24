/**
 * usePWA.ts
 * Drop this hook into your app and call it once from App.tsx.
 *
 * Handles:
 *  - Service worker registration
 *  - New version detection + update toast
 *  - Install prompt (Add to Home Screen)
 *  - Online/offline status
 *  - Push notification permission request
 */

import { useEffect, useState, useCallback } from 'react';

interface PWAState {
  isInstallable: boolean;
  isInstalled:   boolean;
  isOnline:      boolean;
  isUpdateReady: boolean;
  promptInstall: () => void;
  applyUpdate:   () => void;
  requestPushPermission: () => Promise<NotificationPermission>;
}

export function usePWA(): PWAState {
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [isInstallable, setIsInstallable] = useState(false);
  const [isInstalled,   setIsInstalled]   = useState(false);
  const [isOnline,      setIsOnline]      = useState(navigator.onLine);
  const [isUpdateReady, setIsUpdateReady] = useState(false);
  const [waitingSW,     setWaitingSW]     = useState<ServiceWorker | null>(null);

  // ── Service Worker Registration ─────────────────────────────────────────
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
        });

        console.log('[PWA] Service worker registered:', registration.scope);

        // Check for waiting worker (new version available)
        if (registration.waiting) {
          setIsUpdateReady(true);
          setWaitingSW(registration.waiting);
        }

        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener('statechange', () => {
            if (
              newWorker.state === 'installed' &&
              navigator.serviceWorker.controller
            ) {
              // New version is ready, old one still serving
              console.log('[PWA] New version available');
              setIsUpdateReady(true);
              setWaitingSW(newWorker);
            }
          });
        });

        // Listen for controller change (after update applied)
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          window.location.reload();
        });

        // Listen for messages from SW (background sync, etc.)
        navigator.serviceWorker.addEventListener('message', handleSWMessage);

      } catch (err) {
        console.error('[PWA] Service worker registration failed:', err);
      }
    };

    register();

    return () => {
      navigator.serviceWorker.removeEventListener('message', handleSWMessage);
    };
  }, []);

  // ── Install Prompt ──────────────────────────────────────────────────────
  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e);
      setIsInstallable(true);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setIsInstallable(false);
      setInstallPrompt(null);
      console.log('[PWA] App installed');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    // Check if already running as installed PWA
    if (
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true
    ) {
      setIsInstalled(true);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  // ── Online / Offline ────────────────────────────────────────────────────
  useEffect(() => {
    const goOnline  = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);

    window.addEventListener('online',  goOnline);
    window.addEventListener('offline', goOffline);

    return () => {
      window.removeEventListener('online',  goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // ── SW Message Handler ──────────────────────────────────────────────────
  function handleSWMessage(event: MessageEvent) {
    const { type } = event.data || {};

    if (type === 'SYNC_ATTENDANCE') {
      console.log('[PWA] Background sync: attendance ready to resync');
      // You can dispatch a custom event or call a Firestore function here
      window.dispatchEvent(new CustomEvent('pwa:sync-attendance', {
        detail: event.data.records
      }));
    }

    if (type === 'SYNC_MESSAGES') {
      console.log('[PWA] Background sync: messages ready to resync');
      window.dispatchEvent(new CustomEvent('pwa:sync-messages', {
        detail: event.data.records
      }));
    }

    if (type === 'NOTIFICATION_CLICK') {
      window.dispatchEvent(new CustomEvent('pwa:notification-click', {
        detail: event.data
      }));
    }
  }

  // ── Trigger install prompt ──────────────────────────────────────────────
  const promptInstall = useCallback(async () => {
    if (!installPrompt) return;
    try {
      await installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;
      console.log('[PWA] Install outcome:', outcome);
      if (outcome === 'accepted') {
        setIsInstalled(true);
        setIsInstallable(false);
      }
      setInstallPrompt(null);
    } catch (err) {
      console.error('[PWA] Install prompt failed:', err);
    }
  }, [installPrompt]);

  // ── Apply pending SW update ─────────────────────────────────────────────
  const applyUpdate = useCallback(() => {
    if (!waitingSW) return;
    waitingSW.postMessage({ type: 'SKIP_WAITING' });
    // controllerchange listener above will reload the page
  }, [waitingSW]);

  // ── Request push notification permission ────────────────────────────────
  const requestPushPermission = useCallback(async (): Promise<NotificationPermission> => {
    if (!('Notification' in window)) return 'denied';
    if (Notification.permission === 'granted') return 'granted';

    const permission = await Notification.requestPermission();
    console.log('[PWA] Push permission:', permission);
    return permission;
  }, []);

  return {
    isInstallable,
    isInstalled,
    isOnline,
    isUpdateReady,
    promptInstall,
    applyUpdate,
    requestPushPermission,
  };
}