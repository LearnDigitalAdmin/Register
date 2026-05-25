/**
 * usePWA.ts
 * Thin React hook that bridges PWAManager events into component state.
 * Does NOT register a service worker — that is pwaManager's job (called in main.tsx).
 */

import { useEffect, useState, useCallback } from 'react';
import { pwaManager } from './utils/pwa-registration';

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
  const [isInstallable, setIsInstallable] = useState(false);
  const [isInstalled,   setIsInstalled]   = useState(() => pwaManager.isInstalled());
  const [isOnline,      setIsOnline]      = useState(navigator.onLine);
  const [isUpdateReady, setIsUpdateReady] = useState(false);

  // ── Listen for install prompt available (fired by pwaManager) ────────────
  useEffect(() => {
    const onInstallAvailable = () => {
      setIsInstallable(true);
    };

    const onInstalled = () => {
      setIsInstalled(true);
      setIsInstallable(false);
    };

    const onUpdateAvailable = () => {
      setIsUpdateReady(true);
    };

    window.addEventListener('pwa-install-available', onInstallAvailable);
    window.addEventListener('pwa-installed',         onInstalled);
    window.addEventListener('pwa-update-available',  onUpdateAvailable);

    // In case the beforeinstallprompt already fired before this hook mounted
    // (e.g. on hot reload during dev), check if pwaManager already has it
    if (pwaManager.hasInstallPrompt()) {
      setIsInstallable(true);
    }

    return () => {
      window.removeEventListener('pwa-install-available', onInstallAvailable);
      window.removeEventListener('pwa-installed',         onInstalled);
      window.removeEventListener('pwa-update-available',  onUpdateAvailable);
    };
  }, []);

  // ── Online / Offline ──────────────────────────────────────────────────────
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

  // ── Actions delegated to pwaManager ──────────────────────────────────────
  const promptInstall = useCallback(async () => {
    const accepted = await pwaManager.showInstallPrompt();
    if (accepted) {
      setIsInstalled(true);
      setIsInstallable(false);
    }
  }, []);

  const applyUpdate = useCallback(() => {
    pwaManager.applyUpdate();
  }, []);

  const requestPushPermission = useCallback((): Promise<NotificationPermission> => {
    return pwaManager.requestPushPermission();
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