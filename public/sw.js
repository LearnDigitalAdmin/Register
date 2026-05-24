// MyRegister Service Worker
// Samuhia Businesses / Cogvana
// Plain vanilla SW — no Workbox, no build step needed.

const CACHE_VERSION = 'myregister-v1.0.0';
const STATIC_CACHE  = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const IMAGE_CACHE   = `${CACHE_VERSION}-images`;
const FONT_CACHE    = `${CACHE_VERSION}-fonts`;

const ALL_CACHES = [STATIC_CACHE, RUNTIME_CACHE, IMAGE_CACHE, FONT_CACHE];

// App shell — cached on install for offline support
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.json',
  '/icon.svg',
  '/icons/manifest-icon-192.maskable.png',
  '/icons/manifest-icon-512.maskable.png',
  '/icons/apple-icon-180.png',
];

// Never cache these — auth, payments, live APIs
const NEVER_CACHE = [
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'safaricom.co.ke',
  'sandbox.safaricom.co.ke',
  'africa-south1',
];

// ── INSTALL ──────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => !ALL_CACHES.includes(key))
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// ── FETCH ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET
  if (request.method !== 'GET') return;

  // Skip auth/payment APIs entirely — never intercept
  if (NEVER_CACHE.some((host) => url.hostname.includes(host))) return;

  // Skip chrome extensions
  if (url.protocol === 'chrome-extension:') return;

  // Google Fonts — cache first, 30 days
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(request, FONT_CACHE));
    return;
  }

  // Images & icons — cache first, 7 days
  if (request.destination === 'image') {
    event.respondWith(cacheFirst(request, IMAGE_CACHE));
    return;
  }

  // Firestore / Firebase Realtime DB — network first, short cache
  if (
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('firebasedatabase.app') ||
    url.hostname.includes('firebase.googleapis.com')
  ) {
    event.respondWith(networkFirst(request, RUNTIME_CACHE));
    return;
  }

  // Vite hashed assets (/assets/*.js, /assets/*.css) — cache first, immutable
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE));
    return;
  }

  // HTML navigation (/, /login, /signup) — network first, fallback to cache
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(navigationHandler(request));
    return;
  }

  // Everything else — stale while revalidate
  event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
});

// ── BACKGROUND SYNC ───────────────────────────────────────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-attendance') {
    event.waitUntil(notifyClients({ type: 'SYNC_ATTENDANCE' }));
  }
  if (event.tag === 'sync-messages') {
    event.waitUntil(notifyClients({ type: 'SYNC_MESSAGES' }));
  }
});

// ── PUSH NOTIFICATIONS ────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try { payload = event.data.json(); }
  catch { payload = { title: 'MyRegister', body: event.data.text() }; }

  const {
    title = 'MyRegister',
    body  = 'You have a new notification.',
    icon  = '/icons/manifest-icon-192.maskable.png',
    badge = '/icons/manifest-icon-192.maskable.png',
    tag   = 'myregister',
    type  = 'default',
    url   = '/app',
  } = payload;

  const actionMap = {
    absence:      [{ action: 'view', title: '📋 Open Register' }, { action: 'sms', title: '📲 Send SMS' }],
    topup:        [{ action: 'view', title: '🪙 View Balance' }],
    'low-tokens': [{ action: 'topup', title: '💳 Top Up M-Pesa' }],
    default:      [{ action: 'open', title: 'Open App' }],
  };

  event.waitUntil(
    self.registration.showNotification(title, {
      body, icon, badge, tag,
      renotify: true,
      requireInteraction: type === 'absence',
      vibrate: [200, 100, 200],
      data: { url, type },
      actions: actionMap[type] || actionMap.default,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { url } = event.notification.data || {};
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.includes(self.location.origin) && 'focus' in c) return c.focus();
      }
      return clients.openWindow(url || '/app');
    })
  );
});

// ── MESSAGES FROM APP ─────────────────────────────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();

  if (event.data?.type === 'CACHE_URL' && event.data.url) {
    caches.open(RUNTIME_CACHE).then((cache) => cache.add(event.data.url));
  }
});

// ── STRATEGIES ────────────────────────────────────────────────────────────────

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

async function networkFirst(request, cacheName) {
  try {
    const response = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ]);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response(JSON.stringify({ error: 'offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function navigationHandler(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Try cached version of this specific URL first
    const cached = await caches.match(request);
    if (cached) return cached;
    // Fall back to root index.html (SPA)
    const index = await caches.match('/') || await caches.match('/index.html');
    if (index) return index;
    // Last resort: offline page
    return caches.match('/offline.html');
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => cached);

  return cached || fetchPromise;
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

function notifyClients(message) {
  return self.clients
    .matchAll({ type: 'window', includeUncontrolled: true })
    .then((list) => list.forEach((c) => c.postMessage(message)));
}