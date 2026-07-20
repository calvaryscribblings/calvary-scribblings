'use client';
import { useEffect } from 'react';

// R4a.2 — The site-wide <meta name="viewport"> in app/layout.js has no `viewport-fit=cover`, so
// env(safe-area-inset-*) resolves to 0 in every stylesheet and the reader's safe-area padding was
// silently a no-op (fault B). The reader is the only surface that draws edge-to-edge under the
// notch, so rather than flip the flag globally — which would push every other page's content under
// the status bar — we opt in for the lifetime of a reader route and restore the original on exit.
export function useViewportFitCover() {
  useEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return undefined;
    const previous = meta.getAttribute('content') || '';
    if (previous.includes('viewport-fit')) return undefined;
    meta.setAttribute('content', previous + ', viewport-fit=cover');
    return () => { meta.setAttribute('content', previous); };
  }, []);
}
