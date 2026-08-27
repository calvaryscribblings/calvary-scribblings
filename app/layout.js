// Server component, deliberately. The client half — AuthProvider, CookieBanner and the
// global scroll-reveal effect — lives in ./components/Providers. This file stays on the
// server because only a server component can export `metadata` and `viewport`, and both
// exports below depend on that.
import './globals.css';
import Providers from './components/Providers';
// R22C — the two lines that must be in every document's parsed <head> for a cross-document
// view transition, and R22.1C's flag, which is what decides whether they are emitted at all.
// See the note in <head> below and BOOK_TRANSITION_WITHHELD in that file.
import {
  BOOK_TRANSITION_SHIPPED, VIEW_TRANSITION_OPT_IN_CSS, VIEW_TRANSITION_GUARD_JS,
} from './bookstore/components/bookTransition';

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
        {/* ═══════════════════════════════════════════════════════════════════════════════
            R22.1C — THE OPT-IN IS WITHHELD. THIS BLOCK EMITS NOTHING UNTIL R9.
            ═══════════════════════════════════════════════════════════════════════════════

            `BOOK_TRANSITION_SHIPPED` is false, so neither element below is rendered and no
            document in the export carries `@view-transition`. A shelf → detail navigation is
            therefore a plain instant swap. Ikenna's ruling of 27 Aug 2026: the guard was
            proven in Chromium only, the pair cannot form until R9 unwinds the launch gate, and
            the app shipped this exact effect and it failed on glass as an unpaired translucent
            dissolve. See BOOK_TRANSITION_WITHHELD in app/bookstore/components/bookTransition.js
            for all three reasons and for what to do on the day.

            ⭑ THE ARRANGEMENT IS KEPT RATHER THAN DELETED, and this is the reason it has to be:
            a cross-document view transition needs `@view-transition{navigation:auto}` READABLE
            ON BOTH DOCUMENTS at moments neither the app nor React controls — on the outgoing
            one when the navigation starts, and on the ARRIVING one at `pagereveal`, which fires
            before the first render. The shop renders everything, its stylesheet included,
            behind the launch gate in an effect; measured against the real export, the arriving
            page declined the transition every single time because its <style> did not exist
            yet. TWO LINES IN A PRERENDERED <head> ARE THE WHOLE FIX, and there is nowhere lower
            in the tree that is early enough. That finding cost R22C its first working version
            and must not be relearned.

            The guard is a CLASSIC inline script for the same reason: it has to be listening
            before `pagereveal`, and without it a navigation whose names did not pair would get
            the browser's default root cross-fade — which is the dissolve the app just shipped
            by accident. */}
        {BOOK_TRANSITION_SHIPPED && (
          <>
            <style dangerouslySetInnerHTML={{ __html: VIEW_TRANSITION_OPT_IN_CSS }} />
            <script dangerouslySetInnerHTML={{ __html: VIEW_TRANSITION_GUARD_JS }} />
          </>
        )}
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
