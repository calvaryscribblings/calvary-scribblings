// Server component, deliberately. The client half — AuthProvider, CookieBanner and the
// global scroll-reveal effect — lives in ./components/Providers. This file stays on the
// server because only a server component can export `metadata` and `viewport`, and both
// exports below depend on that.
import './globals.css';
import Providers from './components/Providers';

const BASE_URL = 'https://calvaryscribblings.co.uk';

export const metadata = {
  // Declared once here so every page inherits it. This is a guardrail, not a fix for a live
  // bug: every openGraph/twitter URL in the tree is currently written absolute, so adding
  // this changed no emitted tag. It matters the first time someone writes a relative image
  // path — without a metadataBase Next cannot resolve one and drops the tag silently.
  // Child declarations still win; the three routes that set their own (app/page.js,
  // public-library/layout.js, voices/layout.js) set this same value.
  metadataBase: new URL(BASE_URL),
};

// R4a.3: viewport-fit=cover MUST be declared statically, and it must be the *only* viewport
// declaration on the page.
//
// R4a.2 appended it at runtime from a reader-scoped effect; iOS Safari switched the page to
// edge-to-edge but the stylesheet's env(safe-area-inset-*) values had already resolved to 0
// and were never recomputed — so the reader drew full-bleed with zero inset compensation and
// put the first line of every page under the status bar.
//
// R4a.3 moved it to a literal <meta> in <head>, but the layout was 'use client' at the time,
// so Next could not see a viewport declaration and emitted its own default *after* ours.
// Every page shipped two viewport metas, the second lacking viewport-fit. Which one wins is
// not something we pinned down — the spec's merge-vs-replace behaviour for duplicate viewport
// metas is not consistently defined across engines, and it is not observable in headless
// Chromium (CDP's safe-area override sets the resolved insets directly, bypassing the
// viewport-fit gate, so both shapes test identically). Exporting viewport from a server
// layout emits one tag and no default, which retires the question rather than answering it.
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        {/* preconnect must precede the stylesheet or it buys nothing — keep this order. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;500;600;700&family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600;1,700&display=swap"
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
