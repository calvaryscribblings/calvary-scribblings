'use client';
import './globals.css';
import { useEffect } from 'react';
import { AuthProvider } from './lib/AuthContext';
import CookieBanner from './components/CookieBanner';
export default function RootLayout({ children }) {
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
    <html lang="en">
      <head>
        {/* R4a.3: viewport-fit=cover MUST be declared statically. R4a.2 appended it at runtime from
            a reader-scoped effect; iOS Safari switched the page to edge-to-edge but the stylesheet's
            env(safe-area-inset-*) values had already resolved to 0 and were never recomputed — so
            the reader drew full-bleed with zero inset compensation and put the first line of every
            page under the status bar. Declared here, the layout mode and the insets agree from the
            first paint. */}
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;500;600;700&family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600;1,700&display=swap"
        />
      </head>
      <body>
        <AuthProvider>
          {children}
          <CookieBanner />
        </AuthProvider>
      </body>
    </html>
  );
}