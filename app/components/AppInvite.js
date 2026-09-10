'use client';
import { useSyncExternalStore } from 'react';
import { PRESS_SCALE, PRESS_MS } from '../lib/houseMotion';
import {
  anyAppLive, storesFor, platformOf, APP_PITCH, APP_PITCH_SHORT,
} from '../lib/appLinks';

// ── THE APP INVITATION ───────────────────────────────────────────────────────────────────
//
// One component, two dresses, and nothing else on the platform may render a store link.
//
//   variant="panel"  the story page's dark tail, beside NewsletterInvite — glass over night,
//                    gold hairline, the full pitch as a sentence.
//   variant="row"    the footer — one line, no panel, the short pitch.
//
// ⚠ IT RENDERS NOTHING AT ALL WHEN BOTH FLAGS ARE FALSE. Not an empty <section>, not a
// heading with nothing under it — the component returns null before it reaches any markup, so
// with both flags down the built HTML contains no trace of it. See app/lib/appLinks.js.
//
// ── NO BADGE IMAGES HERE, AND THAT IS A DECISION ─────────────────────────────────────────
//
// Apple and Google both police their badge artwork, and a stale badge is a takedown notice
// rather than a design note. public/badges/ holds two assets downloaded in July 2026 and this
// round did NOT re-check either against the current brand guidelines, so nothing new adopts
// them: these surfaces set the store's NAME in the house type beside a house glyph.
//
// /links keeps its badges. It has shipped with them since July, changing it is a redesign of
// a page this round was not asked to redesign, and its flag fix is the actual defect there.
// ⭑ IF THE BADGES ARE EVER RE-VERIFIED, /links is the surface to bring in line with THIS one,
// not the other way around — a text link is never a trademark problem.
//
// ── THE GLYPH IS A HOUSE GLYPH, NOT A PLATFORM LOGO ──────────────────────────────────────
//
// Drawing an Apple mark or a Play triangle by hand is the same trademark exposure as a stale
// badge, for a 16px decoration nobody reads. So both stores take the SAME house mark — a
// phone with a stroke coming down into it — in the TabBar's icon register (24 box, stroke 1.5,
// round caps and joins, no fill, currentColor). The store is named in words; the glyph says
// "onto your phone", which is the offer.
//
// ⭑ NO EMOJI. House rule since R39.
function DeviceIcon({ size = 17 }) {
  return (
    <svg
      viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false"
    >
      {/* the handset: 13 wide, 19 tall, generous radius so it reads as a phone at 16px */}
      <rect x="5.5" y="2.5" width="13" height="19" rx="2.5" />
      {/* the earpiece, which is what stops the rectangle reading as a card */}
      <path d="M10.4 5.4 h3.2" />
      {/* the download: a stroke coming down INTO the handset, landing on a shelf. The arrow
          head sits at y=15 and the shelf at 17.6, so the mark reads as "arriving" rather than
          as an arrow drawn inside a box. */}
      <path d="M12 8.4 v6.2" />
      <path d="M9.6 12.4 L12 14.8 L14.4 12.4" />
      <path d="M9 17.6 h6" />
    </svg>
  );
}

/**
 * @param {'panel'|'row'} variant    which dress. Defaults to the story-tail panel.
 * @param {string}        id         optional DOM id for the heading, when a page wants to
 *                                   aria-labelledby it from outside.
 * @param {boolean}       showPitch  panel only. ⭑ /app PASSES FALSE, and it is the only caller
 *                                   that does: its lede already carries APP_PITCH, and the
 *                                   first render printed the same sentence twice down the page
 *                                   — once as the lede and again inside the panel four inches
 *                                   below, which reads as a mistake rather than as emphasis.
 *                                   Everywhere else the panel arrives cold, in the middle of
 *                                   something the reader came for, and the line is the whole
 *                                   reason the panel is worth their attention.
 */
export default function AppInvite({ variant = 'panel', id, showPitch = true }) {
  // ⚠ THE GATE IS A SEPARATE COMPONENT FROM THE BODY, and that is why this early return is
  // legal. This function holds NO hooks, so returning before the body mounts breaks no rule;
  // all the state lives one level down in AppInviteBody, which is only ever reached when the
  // build offers a store. Inlining the body here would put an early return above useState and
  // make the flag a rules-of-hooks violation the moment anyone made it dynamic.
  if (!anyAppLive()) return null;
  return <AppInviteBody variant={variant} id={id} showPitch={showPitch} />;
}

const subscribeNever = () => () => {};
const clientPlatform = () => platformOf(navigator.userAgent, navigator.maxTouchPoints);
// The static export has no user agent, and 'desktop' is the honest answer for "we do not know
// what this is" — it is offered every live store rather than a guessed one.
const serverPlatform = () => 'desktop';

function AppInviteBody({ variant, id, showPitch }) {
  // ⚠ SERVER RENDERS THE SUPERSET, THE CLIENT NARROWS. The static export has no user agent, so
  // the prerendered HTML carries the DESKTOP answer — every live store. The client then reads
  // the real platform and a phone narrows to its own store.
  //
  // ⚠ useSyncExternalStore, NOT useState + useEffect. The first version set state from an
  // effect, which eslint's react-hooks/set-state-in-effect flags and is right to: it renders
  // the component twice on every mount to reach a value that was knowable on the first client
  // render. useSyncExternalStore is the primitive built for exactly this — a value that
  // legitimately DIFFERS between the server snapshot and the client — so React resolves it
  // during hydration instead of after it, with no second render and no effect at all.
  //
  // The subscribe function returns a no-op unsubscribe because the answer cannot change: a
  // reader does not swap phones mid-page, and re-reading on every resize would be a resize
  // listener pretending to be a device check.
  //
  // ⭑ AND THIS IS INERT WHENEVER ONE STORE IS LIVE, which is today's state: there is nothing to
  // narrow, both snapshots agree, and no row ever moves. It only does visible work once BOTH
  // flags are true.
  const platform = useSyncExternalStore(subscribeNever, clientPlatform, serverPlatform);
  const stores = storesFor(platform);

  if (!stores.length) return null;

  const headingId = id || `app-invite-h-${variant}`;

  if (variant === 'row') {
    return (
      <div className="cs-appinv-row">
        <style>{CSS}</style>
        <span className="cs-appinv-row-lead">{APP_PITCH_SHORT} —</span>
        {stores.map((s) => (
          <a
            key={s.key}
            className="cs-appinv-link cs-appinv-press"
            href={s.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            <DeviceIcon size={15} />
            <span>{s.label}</span>
          </a>
        ))}
      </div>
    );
  }

  return (
    <section className="cs-appinv-section" aria-labelledby={headingId}>
      <style>{CSS}</style>
      <div className="cs-appinv-panel">
        <span className="cs-appinv-rule" aria-hidden="true" />
        <div className="cs-appinv-eyebrow" id={headingId}>The reading app</div>
        {showPitch && <p className="cs-appinv-line">{APP_PITCH}</p>}
        <div className={showPitch ? 'cs-appinv-actions' : 'cs-appinv-actions is-bare'}>
          {stores.map((s) => (
            <a
              key={s.key}
              className="cs-appinv-cta cs-appinv-press"
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              <DeviceIcon size={17} />
              <span>{s.label}</span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

// ⚠ THE PRESS IS CSS :active ON THE BROWSER'S OWN DOWN-HANDLER, never React state. A pressed
// state routed through a re-render arrives after the finger has already left on a slow phone,
// which is the one place it is guaranteed to be useless. One token, from houseMotion.
const CSS = `
  /* ── the story tail's panel: glass over night ───────────────────────────────────────────
     Borrows NewsletterInvite's horizontal rhythm exactly — 680px column, 2rem gutter, 14px
     radius — because the two sit in the same dark band and the tail must read as one column
     rather than as two panels that nearly agree. */
  .cs-appinv-section { background: #0a0a0a; padding: 2.25rem 2rem 0; }
  .cs-appinv-panel {
    max-width: 680px; margin: 0 auto; border-radius: 14px; padding: 1.6rem 1.5rem 1.7rem;
    background: rgba(20, 12, 8, 0.5);
    border: 1px solid rgba(201, 168, 76, 0.18);
    -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
    text-align: center;
  }
  .cs-appinv-rule {
    display: block; width: 40px; height: 1px; background: #c9a84c; opacity: 0.7;
    margin: 0 auto 0.9rem;
  }
  .cs-appinv-eyebrow {
    font-family: 'Cinzel', serif; font-size: 0.6rem; letter-spacing: 0.28em;
    text-transform: uppercase; color: #c9a84c; margin-bottom: 0.85rem;
  }
  .cs-appinv-line {
    font-family: 'Cormorant Garamond', Georgia, serif; font-size: 1.05rem; line-height: 1.5;
    color: #f0ead8; margin: 0 auto 1.4rem; max-width: 34em;
  }
  .cs-appinv-actions { display: flex; flex-wrap: wrap; gap: 0.7rem; justify-content: center; }
  /* With no pitch above them the buttons sit directly under the eyebrow, so the panel keeps
     its proportions instead of leaving the 1.4rem the paragraph's margin used to occupy. */
  .cs-appinv-actions.is-bare { margin-top: -0.25rem; }
  .cs-appinv-cta {
    display: inline-flex; align-items: center; gap: 0.5rem;
    font-family: 'Cinzel', serif; font-size: 0.64rem; letter-spacing: 0.16em;
    text-transform: uppercase; color: #c9a84c; text-decoration: none;
    padding: 0.8rem 1.5rem; border-radius: 3px;
    background: rgba(201, 168, 76, 0.06);
    border: 1px solid rgba(201, 168, 76, 0.4);
    transition: background 0.2s ease, border-color 0.2s ease;
    min-height: 48px; box-sizing: border-box;
  }
  .cs-appinv-cta:hover { background: rgba(201, 168, 76, 0.14); border-color: rgba(201, 168, 76, 0.6); }

  /* ── the footer's row: one line, no panel ──────────────────────────────────────────────
     The footer is #111111 and its body text is rgba(255,255,255,.55); this row sits at that
     weight and lets the store name carry the gold, so it reads as part of the footer rather
     than as an advertisement dropped into it. */
  .cs-appinv-row {
    display: flex; flex-wrap: wrap; align-items: center; gap: 0.45rem 0.9rem;
    font-family: 'Cormorant Garamond', Georgia, serif; font-size: 0.875rem;
    color: rgba(255, 255, 255, 0.55);
  }
  .cs-appinv-row-lead { font-style: italic; }
  .cs-appinv-link {
    display: inline-flex; align-items: center; gap: 0.4rem;
    color: #c9a84c; text-decoration: none; font-size: 0.875rem;
    padding: 0.35rem 0; transition: color 0.2s ease;
  }
  .cs-appinv-link:hover { color: #e2c876; }

  .cs-appinv-press { -webkit-tap-highlight-color: transparent; }
  .cs-appinv-press:active { transform: scale(${PRESS_SCALE}); transition: transform ${PRESS_MS}ms ease; }

  @media (prefers-reduced-motion: reduce) {
    .cs-appinv-cta, .cs-appinv-link { transition: none; }
  }
`;
