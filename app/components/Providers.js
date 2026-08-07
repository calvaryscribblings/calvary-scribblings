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

export default function Providers({ children }) {
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
          widened AuthContext because AuthContext's 3s isDeleted bound is tuned to exactly one
          read and /my-library's whole shelf is gated on it — see the header of
          app/lib/MembershipContext.js. It subscribes only when signed in, holds its own
          loading state, and nothing structural waits on it. */}
      <MembershipProvider>
        {children}
        {/* Mounted globally like CookieBanner, and it excludes the reading surfaces itself —
            see IMMERSIVE_ROUTES in the component. It needs AuthProvider, so it stays inside. */}
        <VerifyEmailBanner />
        <CookieBanner />
      </MembershipProvider>
    </AuthProvider>
  );
}
