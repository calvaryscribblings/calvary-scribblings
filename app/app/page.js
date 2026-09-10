import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import AppInvite from '../components/AppInvite';
import { anyAppLive, liveStores, NO_DEEP_LINK_NOTE, APP_PITCH } from '../lib/appLinks';

// ── /app — THE ONE PAGE THAT EXPLAINS ITSELF ─────────────────────────────────────────────
//
// The footer row and the story-tail panel are INVITATIONS: one line and a link, in the middle
// of something else the reader came for. Neither is the place to explain what a store link
// does and does not do. This page is.
//
// It exists for three reasons and would not be worth a route for any one of them alone:
//
//   1. SOMEWHERE TO SAY THE DEEP-LINK CAVEAT OUT LOUD. There are no universal links on either
//      platform — no apple-app-site-association, no assetlinks.json — so a link shared from
//      this site opens the website even on a phone with the app installed, and a store link
//      opens the store rather than the story it sat beside. That is a risk accepted for
//      launch (owner Ikenna, review post-launch), and an accepted risk that lives only in a
//      code comment is one somebody builds a share flow on top of six months from now.
//   2. A DESTINATION FOR ANYONE SPEAKING ABOUT THE APP. An influencer brief, an email, a
//      social bio needs one URL that is not a store — because a store URL is wrong for half
//      the audience by definition, and /links is a link-in-bio page with its own job.
//   3. A PLACE THE FLAGS ARE VISIBLY HONEST. With Android in review this page offers the App
//      Store and says nothing whatever about Google Play; on approval day it offers both. No
//      "coming soon", no apology, no second-class row.
//
// ⚠ WHEN BOTH FLAGS ARE FALSE THIS PAGE STILL EXISTS AND STILL RESOLVES — a 404 on a URL
// printed in someone's Instagram bio is worse than a page that says the app is not out yet.
// It just says so plainly, in one line, and offers nothing.
//
// ⭑ THE GROUND IS THE HOUSE INK the rest of the spine paints (#0a0a0a). Nothing here invents
// a surface; this is an addition, not a redesign.

export const metadata = {
  title: 'Story Island — the reading app | Calvary Scribblings',
  description: APP_PITCH,
  alternates: { canonical: 'https://calvaryscribblings.co.uk/app' },
  openGraph: {
    title: 'Story Island — the reading app',
    description: APP_PITCH,
    url: 'https://calvaryscribblings.co.uk/app',
    images: ['https://calvaryscribblings.co.uk/favicon.png'],
  },
};

export default function AppPage() {
  const live = anyAppLive();
  const stores = liveStores();

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600&family=Cinzel:wght@400;500&display=swap');
        .cs-app-page { min-height: 100vh; background: #0a0a0a; color: #f5f0e8;
                       font-family: 'Cormorant Garamond', Georgia, serif; }
        .cs-app-body { max-width: 640px; margin: 0 auto; padding: 7rem 1.5rem 4rem; }
        .cs-app-eyebrow { font-family: 'Cinzel', serif; font-size: 0.56rem; letter-spacing: 0.3em;
                          text-transform: uppercase; color: #c9a84c; opacity: 0.75; }
        .cs-app-h1 { font-size: clamp(2.2rem, 8vw, 3.2rem); font-weight: 300; line-height: 1.05;
                     margin: 0.7rem 0 0.9rem; letter-spacing: -0.01em; color: #f5f0e8; }
        .cs-app-h1 em { font-style: italic; color: #c4b5fd; }
        .cs-app-lede { font-size: 1.15rem; line-height: 1.55; color: rgba(245,240,232,.72);
                       margin: 0 0 2.2rem; }
        .cs-app-rule { width: 60px; height: 1px; background: #c9a84c; opacity: .55; margin: 2.4rem 0; }
        .cs-app-h2 { font-family: 'Cinzel', serif; font-size: 0.6rem; letter-spacing: 0.28em;
                     text-transform: uppercase; color: #c9a84c; margin: 0 0 0.9rem; font-weight: 400; }
        .cs-app-p { font-size: 1rem; line-height: 1.6; color: rgba(245,240,232,.6); margin: 0 0 1rem; }
        .cs-app-none { font-size: 1.05rem; font-style: italic; color: rgba(245,240,232,.6); }
        @media (min-width: 720px) { .cs-app-body { padding: 7.5rem 2rem 5rem; } }
      `}</style>

      <Navbar />

      <div className="cs-app-page">
        <div className="cs-app-body">
          <div className="cs-app-eyebrow">Calvary Scribblings</div>
          <h1 className="cs-app-h1">Story Island, <em>offline</em></h1>
          <p className="cs-app-lede">{APP_PITCH}</p>

          {live ? (
            /* The panel carries the store links, the platform detection and the press — one
               component, so this page can never drift from the footer row or the story tail.
               ⭑ showPitch={false}: the lede three lines above IS the pitch, and the first
               render of this page printed that sentence twice. */
            <AppInvite variant="panel" id="cs-app-get" showPitch={false} />
          ) : (
            <p className="cs-app-none">
              The app is not in the stores yet. When it is, it will be here.
            </p>
          )}

          <div className="cs-app-rule" aria-hidden="true" />

          <h2 className="cs-app-h2">What the library brings with it</h2>
          <p className="cs-app-p">
            Every story you save is kept on the device, not streamed. Once a story is on your
            phone it opens the same on a flight, on the Underground, and on a signal that has
            given up entirely — and it does not spend your data twice.
          </p>

          {/* ⚠ THE CAVEAT, SAID AT THE SITE RATHER THAN ONLY IN A COMMENT. See the header. */}
          <h2 className="cs-app-h2">About these links</h2>
          <p className="cs-app-p">{NO_DEEP_LINK_NOTE}</p>
          {stores.length > 0 && (
            <p className="cs-app-p">
              {stores.length === 1
                ? `Today the app is in the ${stores[0].label}.`
                : 'The app is in both stores.'}{' '}
              If you are reading this on a computer, the link opens the store page — install it
              from the phone you actually read on.
            </p>
          )}
        </div>
        <Footer showAppRow={false} />
      </div>
    </>
  );
}
