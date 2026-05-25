import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { pwaManager } from './utils/pwa-registration';

// Single PWA init — pwaManager handles SW registration, install prompt, storage
pwaManager.initialize().catch(console.error);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);