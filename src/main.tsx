import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { PullToRefresh } from './components/PullToRefresh';
import './index.css';

// PWA: service worker нь push мэдэгдэл хүлээж, аппыг утасны дэлгэцээс
// шууд нээх боломжийг бүрдүүлнэ.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* SW дэмжихгүй орчинд апп хэвийн ажиллана */
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PullToRefresh>
      <App />
    </PullToRefresh>
  </StrictMode>
);
