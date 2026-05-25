import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { pwaManager } from './utils/pwa-registration';

// ── PWA: initialise service worker, install prompt, storage ──────────────────
// Mirrors the Cogvana Cyber pattern exactly.
// pwaManager.initialize() is non-blocking — runs in the background.
pwaManager.initialize().catch(console.error);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);