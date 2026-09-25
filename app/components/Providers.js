'use client';
// Everything in the root layout that needs the browser. layout.js itself is a server
// component so it can export `metadata` and `viewport` — a 'use client' layout cannot,
// and when it doesn't, Next emits its own default viewport meta alongside any
// hand-written one. See the note in app/layout.js.
import { useEffect } from 'react';
import { AuthProvider } from '../lib/AuthContext';
import { MembershipProvider } from '../lib/MembershipContext';
import CookieBanner from './CookieBanner';
import VerifyEmailBanner from './VerifyEmailBanner';
import ProfileCompletion from './ProfileCompletion';
import GatePreviewBanner from './GatePreview';

export default function Providers({ children }) {
  // W2 / SPD-09 — THE SERVICE WORKER, SITE-WIDE. It used to register only from the shelf
  // surfaces, so a reader who had never opened My Library had no worker at all, and every tab
  // offline was the browser's own error page. It precaches nothing, and every document stays
  // network-first (public/sw.js, THE ONE RULE), so registering it everywhere costs one small
  // script and buys the house offline page on every later visit. Deferred to idle so it never
  // competes with the page's own first paint. (A reader's VERY first visit with no connection
  // cannot be answered by anything of ours: no page has loaded to install a worker.)
  useEffect(() => {
    const go = () => { import('../lib/shelfWorker').then((m) => m.registerShelfWorker()).catch(() => {}); };
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(go, { timeout: 5000 });
      return () => window.cancelIdleCallback(id);
    }
    const t = setTimeout(go, 3000);
    return () => clearTimeout(t);
  }, []);

  // Global scroll-reveal: adds .is-revealed to [data-reveal] elements as they
  // enter the viewport (see globals.css for the animations). The
  // MutationObserver picks up elements added after mount — client-side
  // navigation and async Firebase content.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-revealed');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: '0px 0px -40px 0px' }
    );

    const observe = () => {
      document.querySelectorAll('[data-reveal]:not(.is-revealed)').forEach((el) => {
        observer.observe(el);
      });
    };

    observe();

    const mutationObserver = new MutationObserver(observe);
    mutationObserver.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      mutationObserver.disconnect();
    };
  }, []);

  return (
    <AuthProvider>
      {/* INSIDE AuthProvider because it needs the uid, and a separate provider rather than a
          widened AuthContext because AuthContext's `loading` gates /my-library's whole shelf and
          must never wait on a membership lookup — see the header of
          app/lib/MembershipContext.js. It subscribes only when signed in, holds its own
          loading state, and nothing structural waits on it. */}
      <MembershipProvider>
        {children}
        {/* Mounted globally like CookieBanner, and it excludes the reading surfaces itself —
            see IMMERSIVE_ROUTES in the component. It needs AuthProvider, so it stays inside. */}
        <VerifyEmailBanner />
        {/* A signed-in reader with no identity chooses one first — app/lib/profileCompletion.js. */}
        <ProfileCompletion />
        <CookieBanner />
        <GatePreviewBanner />
      </MembershipProvider>
    </AuthProvider>
  );
}
