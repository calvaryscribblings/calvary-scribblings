'use client';
// Everything in the root layout that needs the browser. layout.js itself is a server
// component so it can export `metadata` and `viewport` — a 'use client' layout cannot,
// and when it doesn't, Next emits its own default viewport meta alongside any
// hand-written one. See the note in app/layout.js.
import { useEffect } from 'react';
import { AuthProvider } from '../lib/AuthContext';
import CookieBanner from './CookieBanner';

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
      {children}
      <CookieBanner />
    </AuthProvider>
  );
}
