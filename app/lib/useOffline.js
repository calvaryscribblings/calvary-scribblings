'use client';
import { useEffect, useState } from 'react';

// Offline detection for the shelf surfaces.
//
// navigator.onLine is only half a signal. It reports "this device has a network interface",
// not "this device can reach the internet", so `true` means very little — a captive portal,
// a dead hotel wifi and a working connection all read as true. But `false` is reliable, and
// false is the direction the banner needs.
//
// The second signal closes the other half: when the service worker's network-first
// navigation falls back to cache, it broadcasts CS_OFFLINE. That catches exactly the cases
// navigator.onLine lies about. A later successful `online` event clears it.
export function useOffline() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const sync = () => setOffline(typeof navigator !== 'undefined' && navigator.onLine === false);
    sync();

    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);

    const onMsg = (e) => { if (e.data?.type === 'CS_OFFLINE') setOffline(true); };
    try { navigator.serviceWorker?.addEventListener('message', onMsg); } catch {}

    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
      try { navigator.serviceWorker?.removeEventListener('message', onMsg); } catch {}
    };
  }, []);

  return offline;
}
