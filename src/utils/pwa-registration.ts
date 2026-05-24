// src/utils/pwa-registration.ts
// MyRegister PWA Manager — based on Cogvana Cyber's pattern
// Handles: SW registration, install prompt, updates, persistent storage,
//          background sync registration, push permission, storage quota.

interface SyncManager {
  register(tag: string): Promise<void>;
}

interface PWAInstallPrompt {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

class PWAManager {
  private deferredPrompt: PWAInstallPrompt | null = null;
  private registration: ServiceWorkerRegistration | null = null;

  // ── Service Worker Registration ───────────────────────────────────────────
  async registerServiceWorker(): Promise<void> {
    if (!('serviceWorker' in navigator)) {
      console.log('[PWA] Service Worker not supported');
      return;
    }

    try {
      this.registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
      });

      console.log('[PWA] ✅ Service Worker registered:', this.registration.scope);

      // New version available
      this.registration.addEventListener('updatefound', () => {
        const newWorker = this.registration!.installing;
        console.log('[PWA] 🔄 Update found');

        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (
              newWorker.state === 'installed' &&
              navigator.serviceWorker.controller
            ) {
              console.log('[PWA] ✨ New version ready');
              this.notifyUserOfUpdate(newWorker);
            }
          });
        }
      });

      // Check for updates every hour
      setInterval(() => {
        this.registration?.update();
      }, 60 * 60 * 1000);

      // Reload when new SW takes control
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.location.reload();
      });

      // Listen for messages from SW (background sync triggers, etc.)
      navigator.serviceWorker.addEventListener('message', (event) => {
        this.handleSWMessage(event.data);
      });

    } catch (error) {
      console.error('[PWA] ❌ Service Worker registration failed:', error);
    }
  }

  // ── Persistent Storage ────────────────────────────────────────────────────
  async requestPersistentStorage(): Promise<boolean> {
    if (!('storage' in navigator) || !('persist' in navigator.storage)) return false;

    try {
      const isPersisted = await navigator.storage.persisted();
      if (isPersisted) {
        console.log('[PWA] ✅ Storage already persistent');
        return true;
      }

      const granted = await navigator.storage.persist();
      console.log(`[PWA] ${granted ? '✅' : '⚠️'} Persistent storage ${granted ? 'granted' : 'denied'}`);
      return granted;
    } catch (error) {
      console.error('[PWA] ❌ Persistent storage request failed:', error);
      return false;
    }
  }

  // ── Storage Quota ─────────────────────────────────────────────────────────
  async checkStorageQuota(): Promise<{
    usage: number; quota: number; percentUsed: number; available: number;
  }> {
    if (!('storage' in navigator) || !('estimate' in navigator.storage)) {
      return { usage: 0, quota: 0, percentUsed: 0, available: 0 };
    }

    try {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate();
      const percentUsed = quota > 0 ? (usage / quota) * 100 : 0;
      const available = quota - usage;

      console.log(`[PWA] 📊 Storage: ${(usage / 1024 / 1024).toFixed(1)} MB used of ${(quota / 1024 / 1024).toFixed(0)} MB (${percentUsed.toFixed(1)}%)`);
      return { usage, quota, percentUsed, available };
    } catch (error) {
      console.error('[PWA] ❌ Storage quota check failed:', error);
      return { usage: 0, quota: 0, percentUsed: 0, available: 0 };
    }
  }

  // ── Install Prompt ────────────────────────────────────────────────────────
  setupInstallPrompt(): void {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredPrompt = e as any;
      console.log('[PWA] 💾 Install prompt ready');
      window.dispatchEvent(new CustomEvent('pwa-install-available'));
    });

    window.addEventListener('appinstalled', () => {
      console.log('[PWA] ✅ App installed');
      this.deferredPrompt = null;
      window.dispatchEvent(new CustomEvent('pwa-installed'));
    });
  }

  async showInstallPrompt(): Promise<boolean> {
    if (!this.deferredPrompt) {
      console.log('[PWA] ⚠️ No install prompt available');
      return false;
    }

    try {
      await this.deferredPrompt.prompt();
      const { outcome } = await this.deferredPrompt.userChoice;
      console.log(`[PWA] Install outcome: ${outcome}`);
      this.deferredPrompt = null;
      return outcome === 'accepted';
    } catch (error) {
      console.error('[PWA] ❌ Install prompt failed:', error);
      return false;
    }
  }

  isInstalled(): boolean {
    const standalone  = window.matchMedia('(display-mode: standalone)').matches;
    const fullscreen  = window.matchMedia('(display-mode: fullscreen)').matches;
    const minimalUI   = window.matchMedia('(display-mode: minimal-ui)').matches;
    const iosStandalone = (window.navigator as any).standalone === true;
    return standalone || fullscreen || minimalUI || iosStandalone;
  }

  // ── Push Notifications ────────────────────────────────────────────────────
  async requestPushPermission(): Promise<NotificationPermission> {
    if (!('Notification' in window)) return 'denied';
    if (Notification.permission === 'granted') return 'granted';
    const result = await Notification.requestPermission();
    console.log(`[PWA] 🔔 Push permission: ${result}`);
    return result;
  }

  // ── Background Sync ───────────────────────────────────────────────────────
  async registerBackgroundSync(tag: string = 'sync-attendance'): Promise<boolean> {
    if (!this.registration || !('sync' in this.registration)) {
      console.log('[PWA] ⚠️ Background Sync not supported');
      return false;
    }

    try {
      await (this.registration.sync as SyncManager).register(tag);
      console.log(`[PWA] ✅ Background sync registered: ${tag}`);
      return true;
    } catch (error) {
      console.error('[PWA] ❌ Background sync failed:', error);
      return false;
    }
  }

  // ── Apply Update ──────────────────────────────────────────────────────────
  async applyUpdate(): Promise<void> {
    if (!this.registration?.waiting) return;
    this.registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    // controllerchange listener above handles the reload
  }

  // ── Clear Caches ──────────────────────────────────────────────────────────
  async clearAllCaches(): Promise<void> {
    if (!('caches' in window)) return;
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      console.log('[PWA] ✅ All caches cleared');
    } catch (error) {
      console.error('[PWA] ❌ Clear caches failed:', error);
    }
  }

  // ── Private/Incognito Detection ───────────────────────────────────────────
  async isPrivateMode(): Promise<boolean> {
    try {
      const { quota = 0 } = await navigator.storage.estimate();
      return quota < 120_000_000; // private mode typically < 120 MB
    } catch {
      return false;
    }
  }

  // ── SW Message Handler ────────────────────────────────────────────────────
  private handleSWMessage(data: any): void {
    switch (data?.type) {
      case 'SYNC_ATTENDANCE':
        window.dispatchEvent(new CustomEvent('pwa:sync-attendance', { detail: data.records }));
        break;
      case 'SYNC_MESSAGES':
        window.dispatchEvent(new CustomEvent('pwa:sync-messages', { detail: data.records }));
        break;
    }
  }

  // ── Update Notifier ───────────────────────────────────────────────────────
  private notifyUserOfUpdate(worker: ServiceWorker): void {
    window.dispatchEvent(
      new CustomEvent('pwa-update-available', {
        detail: {
          message: 'A new version of MyRegister is ready.',
          apply: () => {
            worker.postMessage({ type: 'SKIP_WAITING' });
          },
        },
      })
    );
  }

  // ── Full Init ─────────────────────────────────────────────────────────────
  async initialize(): Promise<void> {
    console.log('[PWA] 🚀 Initialising MyRegister PWA...');

    await this.registerServiceWorker();
    await this.requestPersistentStorage();
    await this.checkStorageQuota();
    this.setupInstallPrompt();

    const isPrivate = await this.isPrivateMode();
    if (isPrivate) {
      console.warn('[PWA] ⚠️ Private/incognito mode — data may not persist');
      window.dispatchEvent(new CustomEvent('pwa-private-mode-detected'));
    }

    if (this.isInstalled()) {
      console.log('[PWA] ✅ Running as installed PWA');
      window.dispatchEvent(new CustomEvent('pwa-is-installed'));
    }

    console.log('[PWA] ✅ PWA Manager ready');
  }
}

// Singleton
export const pwaManager = new PWAManager();