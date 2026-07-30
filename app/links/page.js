// The link-in-bio page — the one URL that goes in every social profile.
//
// STATIC SERVER COMPONENT, and nothing about that is incidental. There is no interactivity
// here, no auth, no Firebase read, not one client hook: the whole page is a string of HTML and
// a <style> block by the time it reaches Cloudflare. That is what lets it open on hotel wifi
// while a reader is standing in a queue, which is the only condition this page is ever used in.
// The pattern follows app/ai-policy/page.js — the house's other static page with its own
// metadata and its own scoped CSS.
//
// NO CHROME, BY OMISSION. The root layout injects no Navbar and no TabBar (see app/layout.js:
// it renders Providers and nothing else), so chrome is opt-in per page and this page simply
// does not opt in. There is nothing to suppress and no flag to set — importing neither
// component IS the decision. A link-in-bio page with a nav bar on it would be a page that
// argues with the profile that sent the reader here.
//
// WHERE THE LONG REASONING LIVES. Everything below the config is documented in JS comments,
// including the style notes, and the CSS itself carries only short markers. That is not the
// house habit and it is deliberate here: a comment inside the <style> template literal is
// shipped to every reader, and the first draft of this page spent 6 KB of a 14 KB stylesheet
// on prose. JS comments are compiled away. On the one page whose brief is 'loads instantly',
// the reasoning belongs where it costs nothing.
//
// AND THE INTERNAL LINKS ARE PLAIN ANCHORS, not next/link. Measured on the built export: a
// <Link> to /public-library and /bookstore makes the router prefetch both routes' RSC payloads
// the moment this page settles — six requests for two destinations, on the page whose entire
// brief is to open on hotel wifi, for a reader who is about to tap exactly one of them. A
// reader arriving from an Instagram bio is getting a fresh document load at the far end either
// way, so client-side routing buys nothing here and costs the prefetch.

const BASE_URL = 'https://calvaryscribblings.co.uk';
// favicon.png, not cs-logo-512-v3.png: it carries an opaque background so it composites
// predictably in the places that will actually render this card. Same choice, same reason, as
// the gateway (app/page.js).
const OG_IMAGE = `${BASE_URL}/favicon.png`;

// ── THE CONFIG ───────────────────────────────────────────────────────────────
//
// EVERY destination on this page is declared here, in one object, and nowhere else. The page
// was built before the accounts and the store listings existed, so the config is the whole
// point: filling in a real URL is a one-line edit by someone who never has to read the JSX.
//
// A PLACEHOLDER MUST NOT PRODUCE A LINK. Anything still on its TODO value renders visibly but
// inert — dimmed, no href, marked 'coming soon' — because the failure mode this guards against
// is the one that costs trust: a reader taps App Store from an Instagram bio, lands on a 404
// or on the word TODO, and does not tap anything of ours again. Deploying today with four
// honest 'coming soon' labels is strictly better than deploying one dead link.
//
// The gate is isLive() below, and it is deliberately not 'does this contain the word TODO'. It
// admits a value only if it is an absolute https:// URL or a site-relative path, so a
// half-finished entry ('instagram.com/calvary', 'coming soon', an empty string, a note to
// self) fails closed and renders as 'coming soon' rather than as a broken link.
const LINKS = {
  // The reading app. Both are TODO until the listings are public — App Store URLs only exist
  // once the app has a numeric ID, and Play URLs once the package name is registered.
  app: {
    appStore: 'TODO — https://apps.apple.com/gb/app/story-island/id0000000000',
    googlePlay: 'TODO — https://play.google.com/store/apps/details?id=uk.co.calvary.storyisland',
  },
  // The social accounts. Paste the full profile URL, not the handle.
  social: {
    instagram: 'TODO — https://www.instagram.com/<handle>/',
    x: 'TODO — https://x.com/<handle>',
    tiktok: 'TODO — https://www.tiktok.com/@<handle>',
    youtube: 'TODO — https://www.youtube.com/@<handle>',
  },
  // Known today, so wired live today. Internal paths stay relative so they never need touching
  // if the domain changes — and relative is also what keeps them out of the external-link
  // branch, which is the one that opens a new tab.
  own: {
    library: '/public-library',
    bookstore: '/bookstore',
    films: 'https://calvaryfilms.co.uk',
  },
};

// The Book Store is built and browsable, so the link is live — only the label carries the date.
// Flip this one boolean on launch day and the suffix goes; nothing else changes.
const BOOKSTORE_LAUNCHED = false;
const BOOKSTORE_LABEL = BOOKSTORE_LAUNCHED ? 'Book Store' : 'Book Store · opens 30 Sept';

/**
 * A destination is live only if it is unambiguously a destination: an absolute https:// URL or
 * a site-relative path. Everything else — a TODO line, a bare domain, a stray note, undefined
 * — is treated as not yet filled in, which is the safe direction to be wrong in.
 */
function isLive(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  return v.startsWith('/') || v.startsWith('https://');
}

const isExternal = (href) => href.startsWith('https://');

export const metadata = {
  title: 'Calvary Scribblings — Links',
  description:
    'Everything Calvary Scribblings in one place — the Public Library, the Book Store, Story Island and Calvary Films.',
  alternates: { canonical: '/links' },
  openGraph: {
    type: 'website',
    url: `${BASE_URL}/links`,
    siteName: 'Calvary Scribblings',
    title: 'Calvary Scribblings — Links',
    description:
      'Everything Calvary Scribblings in one place — the Public Library, the Book Store, Story Island and Calvary Films.',
    images: [{ url: OG_IMAGE, width: 1206, height: 1168, alt: 'Calvary Scribblings' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Calvary Scribblings — Links',
    description: 'Everything Calvary Scribblings in one place.',
    images: [OG_IMAGE],
  },
};

// ── THE ENTRANCE ─────────────────────────────────────────────────────────────
//
// One cascade, top to bottom, and it is CSS only: no observer, no mount effect, no hydration
// gate. A server-rendered page can run an animation from first paint, and the moment it needs
// JavaScript to become visible it also needs JavaScript to become visible on a slow phone —
// which is the one machine this page exists for. (The global scroll-reveal in Providers is not
// used here for the same reason: it would hold the page at opacity 0 until a client bundle
// arrives.)
//
// The delays live here rather than in the stylesheet so the rhythm is readable as a list. Each
// element carries its own --lk-at, and the buttons are 60 ms apart: enough to read as a
// sequence, not enough to make a reader wait for the third one.
const AT = {
  mark: '40ms',
  wordmark: '110ms',
  tagline: '210ms',
  buttons: ['300ms', '360ms', '420ms'],
  divider: '500ms',
  appHead: '560ms',
  badges: '620ms',
  socials: '700ms',
  footer: '780ms',
};

const SOCIALS = [
  { key: 'instagram', label: 'Instagram', href: LINKS.social.instagram },
  { key: 'x', label: 'X', href: LINKS.social.x },
  { key: 'tiktok', label: 'TikTok', href: LINKS.social.tiktok },
  { key: 'youtube', label: 'YouTube', href: LINKS.social.youtube },
];

// ── STYLE NOTES ──────────────────────────────────────────────────────────────
//
// THE GLASS is adopted from the source of truth (app/voices/[slug]/page-client.js,
// '.cs-vp-chip') by way of the gateway: same fill, blur, saturate, border and inset
// highlights, same @supports solid fallback. Do not fork those values here — change them at
// the canonical site.
//
// AND backdrop-filter IS DECLARED BARE, EXACTLY ONCE, per the house rule: hand-writing the
// -webkit- form beside it makes the build's autoprefixer skip its own pass, after which the
// minifier collapses the pair to the -webkit- property alone and Chrome ships with no blur at
// all (the failure documented at app/components/NewsletterInvite.js).
//
// ONE THING ABOUT THAT RULE DOES NOT HOLD ON THIS PAGE, and it is worth stating rather than
// quietly relying on. The rule's premise is a prefixer. This page's CSS is a raw style element
// in a server component: PostCSS runs on globals.css and styled-jsx runs on its own tagged
// blocks, and this is neither — measured, the built out/links.html contains exactly the bare
// property I wrote, and the built CSS chunks contain no -webkit- form anywhere. Safari shipped
// backdrop-filter unprefixed in 18; on iOS 17 and earlier, bare means no blur, and the
// canonical @supports fallback does NOT catch it (that engine supports the -webkit- form, so
// the condition is false) — the glass would render as an unblurred translucent smudge on the
// exact platform most likely to open a link from a bio.
//
// So the canonical rule stays bare and unforked, and old WebKit is served separately, in a
// nested @supports that only that engine can enter. It is not a hand-written pair: the two
// declarations are in different rules under mutually exclusive conditions, and no prefixer or
// minifier is present to collapse anything.
//
// NOTHING IN THIS STYLESHEET MAY CONTAIN THE LITERAL SEQUENCE '<' + 'style'. React's server
// renderer escapes it inside a style element (it emits a CSS hex escape, so the raw text cannot
// close the tag early) and the client render does not, so the two text nodes differ and the page
// throws a hydration error — React 418 — in production only. Dev does not reproduce it. It cost
// a bisect to find, and the culprit was a COMMENT: a sentence in this very block that named the
// element it was describing. Describe it in prose, never in markup.
//
// THE BADGES, AND WHY THEIR BOXES DIFFER. Both files are the platform owners' own artwork,
// unmodified. Apple's SVG is 119.66x40 with the badge flush to the box; Google's PNG is 646x250
// with the badge occupying 564x168 at the centre — Google bakes its mandated clear space into
// the file, 41 px on every side. Render both at one box height and Google's badge comes out a
// quarter smaller than Apple's, which is the misalignment this page would be judged on. So the
// dial is the INK height (--lk-badge-ink) and Google's box is scaled by 250/168 to put the same
// badge on the glass; its baked padding then serves as the gap between them, which is what it
// is for. Both are centred in a flex row, so the two badges share a centreline.
//
// THE ORNAMENT APPEARS ONCE in the body of the page — the ✦ divider between the stack and the
// app section. The mark above the wordmark is the masthead's, not the body's. Sprinkling ✦ down
// a page is what makes a house mark read as decoration instead of as a signature.
//
// HOVER IS GATED on a real pointer. On a phone :hover sticks after a tap, and a button left
// glowing after the reader has already navigated is a bug that only shows up on the device
// nobody tests on. The pressed state is therefore not left to hover — it is the one state a
// touch reader actually sees.
//
// NO MOTION is a real path, not a switch-off: the cascade and the breathing both stop, and
// everything they were animating is asserted into its finished state, so a reader with the
// preference set gets the whole page immediately at full opacity — never a page held at
// opacity 0 by a cancelled animation.
const CSS = `
  .cs-lk {
    --lk-ink:#080610;
    --lk-violet:#6b2fad;
    --lk-gold:#c9a84c;
    --lk-cream:#f5f0e8;
    --lk-display:'Cinzel',Georgia,serif;
    --lk-serif:'Cormorant Garamond',Georgia,serif;
    /* The rhythm, declared once: 8 / 16 / 28 / 44. Every gap on this page is one of these. */
    --lk-s1:8px; --lk-s2:16px; --lk-s3:28px; --lk-s4:44px;
    --lk-badge-ink:40px;          /* badge INK height — see the style notes */
    position:relative;
    min-height:100vh;
    min-height:100dvh;
    /* The ground is a colour: no cover wall, nothing to decode. */
    background:var(--lk-ink);
    color:var(--lk-cream);
    font-family:var(--lk-serif);
    overflow-x:hidden;            /* the glow layer is wider than the viewport */
    padding:calc(var(--lk-s4) + env(safe-area-inset-top)) 20px
            calc(var(--lk-s4) + env(safe-area-inset-bottom));
  }
  .cs-lk *,.cs-lk *::before,.cs-lk *::after { box-sizing:border-box; }

  /* ── The glow: one violet radial, lighter than the gateway's, breathing on 12s ── */
  .cs-lk-glow {
    position:fixed; left:50%; top:-18vh; transform:translateX(-50%);
    width:160vw; height:110vh; max-width:none;
    pointer-events:none; z-index:0;
    background:radial-gradient(50% 50% at 50% 50%,
      rgba(107,47,173,.34) 0%, rgba(107,47,173,.16) 42%, rgba(107,47,173,0) 72%);
    animation:csLkBreathe 12s ease-in-out infinite;
    will-change:opacity;          /* opacity only — the compositor carries it, nothing relayouts */
  }
  @keyframes csLkBreathe { 0%,100% { opacity:.72; } 50% { opacity:1; } }

  .cs-lk-inner {
    position:relative; z-index:1;
    width:100%; max-width:420px; margin:0 auto;
    display:flex; flex-direction:column; align-items:center;
  }

  /* ── The head ───────────────────────────────────────────────────────────── */
  /* The header is a shrink-to-fit flex child (its parent centres it), so its own children
     inherit left alignment and the masthead mark lands off-centre beside the wordmark unless
     the header centres them itself. */
  .cs-lk-head { display:flex; flex-direction:column; align-items:center; width:100%; }
  .cs-lk-mark {
    font-family:var(--lk-display); font-size:15px; line-height:1;
    color:var(--lk-gold); opacity:.9; margin-bottom:var(--lk-s2);
  }
  .cs-lk-wordmark {
    font-family:var(--lk-display); font-weight:600;
    /* Nineteen characters of a wide display serif, on one line at 360px: the vw term shrinks
       it there without shrinking it on a larger phone. */
    font-size:clamp(1.32rem,6vw,1.72rem);
    letter-spacing:.055em; white-space:nowrap;
    color:var(--lk-cream); text-align:center; margin:0;
  }
  .cs-lk-tagline {
    font-family:var(--lk-serif); font-style:italic;
    /* 17px floor: allowed to wrap to two lines rather than be set smaller. */
    font-size:clamp(1.0625rem,4.2vw,1.1875rem); line-height:1.5;
    color:rgba(245,240,232,.82); text-align:center;
    margin:var(--lk-s1) 0 0; max-width:22em;
  }

  /* ── Canonical glass — do not fork these values here ─────────────────────── */
  .cs-lk-glass {
    background:linear-gradient(180deg, rgba(245,240,232,.055), rgba(91,43,160,.10));
    backdrop-filter:blur(14px) saturate(1.35);
    border:1px solid rgba(201,168,76,.35);
    box-shadow:inset 0 1px 0 rgba(245,240,232,.14), inset 0 -1px 0 rgba(0,0,0,.25);
  }
  @supports not ((backdrop-filter: blur(14px)) or (-webkit-backdrop-filter: blur(14px))) {
    .cs-lk-glass { background:rgba(11,7,22,.88); }
  }
  /* iOS 17 and earlier only — nothing prefixes this stylesheet. See the style notes. */
  @supports not (backdrop-filter: blur(1px)) {
    @supports (-webkit-backdrop-filter: blur(1px)) {
      .cs-lk-glass { -webkit-backdrop-filter:blur(14px) saturate(1.35); }
    }
  }

  /* ── The stack ──────────────────────────────────────────────────────────── */
  .cs-lk-stack {
    width:100%; margin-top:var(--lk-s4);
    display:flex; flex-direction:column; gap:var(--lk-s2);
  }
  .cs-lk-btn {
    display:flex; align-items:center; justify-content:center; gap:10px;
    min-height:56px; padding:10px 18px;   /* the whole row is the hit area */
    border-radius:14px;
    text-decoration:none; color:var(--lk-cream);
    font-family:var(--lk-display); font-weight:500;
    font-size:.78rem; letter-spacing:.16em; text-transform:uppercase; text-align:center;
    transition:transform 200ms ease-out, border-color 200ms ease-out,
               box-shadow 200ms ease-out, background-color 200ms ease-out;
  }
  /* ❦ is a printer's ornament, and it must not be resolved to a colour emoji by a platform
     whose fallback chain happens to reach one first — a coloured floret among gold Cinzel
     capitals. Verified here (Chromium, CDP platform-fonts) that both marks land on a
     monochrome text face and take the gold; the serif stack, font-variant-emoji and the
     U+FE0E selector in the markup are the request that keeps that true on a device whose
     fallback we cannot inspect. All three are inert where they are already unnecessary. */
  .cs-lk-orn {
    font-family:var(--lk-serif); font-variant-emoji:text;
    font-size:.9rem; line-height:1; color:var(--lk-gold); opacity:.85;
  }

  @media (hover:hover) and (pointer:fine) {
    .cs-lk-btn:not(.is-soon):hover {
      transform:translateY(-1px);
      border-color:rgba(201,168,76,.62);
      background-color:rgba(201,168,76,.04);
      box-shadow:inset 0 1px 0 rgba(245,240,232,.14), inset 0 -1px 0 rgba(0,0,0,.25),
                 0 0 0 1px rgba(201,168,76,.16), 0 10px 26px -14px rgba(201,168,76,.5);
    }
  }
  .cs-lk-btn:not(.is-soon):active {
    transform:translateY(1px);
    box-shadow:inset 0 1px 0 rgba(245,240,232,.14), inset 0 -1px 0 rgba(0,0,0,.25),
               0 0 0 1px rgba(201,168,76,.22);
  }
  .cs-lk-btn:focus-visible,
  .cs-lk-social:focus-visible,
  .cs-lk-badge:focus-visible {
    outline:2px solid var(--lk-gold); outline-offset:3px; border-radius:14px;
  }

  /* ── Not yet filled in: designed, not broken ─────────────────────────────── */
  .cs-lk-btn.is-soon, .cs-lk-social.is-soon, .cs-lk-badge.is-soon {
    opacity:.4; cursor:default;
  }
  .cs-lk-soon {
    font-family:var(--lk-serif); font-style:italic; font-weight:400;
    font-size:.8rem; letter-spacing:.02em; text-transform:none;
    color:rgba(245,240,232,.75);
  }
  .cs-lk-soon-line {
    font-family:var(--lk-serif); font-style:italic; font-size:.9rem;
    color:rgba(245,240,232,.5); text-align:center; margin:var(--lk-s2) 0 0;
  }

  /* ── The one ornament in the body ────────────────────────────────────────── */
  .cs-lk-divider {
    display:flex; align-items:center; gap:var(--lk-s2);
    width:100%; margin:var(--lk-s4) 0;
    font-family:var(--lk-display); font-size:.7rem; color:var(--lk-gold);
  }
  .cs-lk-divider::before, .cs-lk-divider::after {
    content:''; flex:1 1 auto; height:1px;
    background:linear-gradient(90deg, rgba(201,168,76,0), rgba(201,168,76,.34), rgba(201,168,76,0));
  }

  /* ── The app section ────────────────────────────────────────────────────── */
  .cs-lk-app { width:100%; display:flex; flex-direction:column; align-items:center; }
  .cs-lk-app-h {
    font-family:var(--lk-display); font-weight:500;
    font-size:.74rem; letter-spacing:.2em; text-transform:uppercase;
    color:var(--lk-gold); text-align:center; margin:0;
  }
  .cs-lk-badges {
    display:flex; align-items:center; justify-content:center;
    gap:var(--lk-s1); margin-top:var(--lk-s3); width:100%;
  }
  .cs-lk-badge {
    display:flex; align-items:center; justify-content:center;
    min-height:48px;              /* the artwork is 40px; the tap target is not */
    border-radius:10px;
    transition:transform 200ms ease-out, box-shadow 200ms ease-out;
  }
  @media (hover:hover) and (pointer:fine) {
    .cs-lk-badge:not(.is-soon):hover {
      transform:translateY(-1px); box-shadow:0 10px 26px -16px rgba(201,168,76,.55);
    }
  }
  .cs-lk-badge:not(.is-soon):active { transform:translateY(1px); box-shadow:none; }
  .cs-lk-badge img { display:block; width:auto; max-width:100%; }
  /* Equal INK, unequal boxes: Google bakes 41px of clear space into a 646x250 file. */
  .cs-lk-badge-apple { height:var(--lk-badge-ink); }
  .cs-lk-badge-google { height:calc(var(--lk-badge-ink) * 250 / 168); }

  /* ── The socials ────────────────────────────────────────────────────────── */
  /* One row, at 360 too: four labels of tracked Cinzel plus their tap padding come to ~273px,
     so the column gap is the small step and not the large one. flex-wrap stays as the safety
     net for a longer handle set — but with these four it must never fire, or YouTube ends up
     alone on a second line, which reads as an accident rather than a row. */
  .cs-lk-socials {
    display:flex; align-items:center; justify-content:center;
    flex-wrap:wrap; gap:var(--lk-s1);
    width:100%; margin:var(--lk-s4) 0 0; padding:0; list-style:none;
  }
  .cs-lk-social {
    display:inline-flex; align-items:center; justify-content:center; gap:6px;
    min-height:48px; padding:0 6px;
    font-family:var(--lk-display); font-weight:500;
    font-size:.7rem; letter-spacing:.18em; text-transform:uppercase;
    color:var(--lk-gold); text-decoration:none;
    transition:color 200ms ease-out, opacity 200ms ease-out;
  }
  @media (hover:hover) and (pointer:fine) {
    .cs-lk-social:not(.is-soon):hover { color:#e6c977; }
  }
  .cs-lk-social:not(.is-soon):active { opacity:.75; }
  .cs-lk-social .cs-lk-soon { font-size:.72rem; }

  .cs-lk-footer {
    font-family:var(--lk-serif); font-size:.8rem; letter-spacing:.02em;
    color:rgba(245,240,232,.42); text-align:center; margin:var(--lk-s4) 0 0;
  }

  /* ── The cascade: each element carries its own --lk-at from the AT table ─── */
  @keyframes csLkRise {
    from { opacity:0; transform:translateY(10px); }
    to   { opacity:1; transform:none; }
  }
  .cs-lk-rise { animation:csLkRise 520ms cubic-bezier(.22,1,.36,1) var(--lk-at,0ms) both; }

  @media (prefers-reduced-motion:reduce) {
    .cs-lk-rise { animation:none; opacity:1; transform:none; }
    .cs-lk-glow { animation:none; opacity:.86; }
    .cs-lk-btn, .cs-lk-badge, .cs-lk-social { transition:none; }
  }

  /* Below 380px the two badges plus Google's baked clear space stop fitting side by side, so
     the ink comes down 4px rather than the row wrapping. */
  @media (max-width:379px) {
    .cs-lk { --lk-badge-ink:36px; padding-left:16px; padding-right:16px; }
  }
`;

/**
 * One row of the stack. Live entries are anchors; TODO entries are <span>s — not disabled
 * anchors, because an <a> without an href is still focusable in some engines and still reads as
 * a link to a screen reader. A span with aria-disabled says the true thing: this is a label,
 * and there is nowhere to go yet.
 */
function StackRow({ ornament, label, href, at }) {
  const live = isLive(href);
  const inner = (
    <>
      {ornament ? <span className="cs-lk-orn" aria-hidden="true">{ornament}</span> : null}
      <span>{label}</span>
      {live ? null : <span className="cs-lk-soon">coming soon</span>}
    </>
  );

  if (!live) {
    return (
      <span className="cs-lk-btn cs-lk-glass cs-lk-rise is-soon" aria-disabled="true" style={{ '--lk-at': at }}>
        {inner}
      </span>
    );
  }
  if (isExternal(href)) {
    return (
      <a
        className="cs-lk-btn cs-lk-glass cs-lk-rise"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        style={{ '--lk-at': at }}
      >
        {inner}
      </a>
    );
  }
  return (
    <a className="cs-lk-btn cs-lk-glass cs-lk-rise" href={href} style={{ '--lk-at': at }}>
      {inner}
    </a>
  );
}

/** A store badge: an anchor when the listing exists, a dimmed span until it does. */
function Badge({ href, src, className, alt, width, height }) {
  const live = isLive(href);
  const img = (
    <img className={className} src={src} alt={alt} width={width} height={height} />
  );
  return live ? (
    <a className="cs-lk-badge" href={href} target="_blank" rel="noopener noreferrer">
      {img}
    </a>
  ) : (
    <span className="cs-lk-badge is-soon" aria-disabled="true">
      {img}
    </span>
  );
}

export default function LinksPage() {
  // The 'coming soon' captions are written for the state the page is actually in. Two captions
  // under two badges reads as a fault; one line under both reads as a date — and when exactly
  // one store goes live, the line names the one still missing rather than disappearing and
  // leaving a dimmed badge unexplained.
  const appleLive = isLive(LINKS.app.appStore);
  const googleLive = isLive(LINKS.app.googlePlay);
  const appNote = appleLive && googleLive
    ? null
    : !appleLive && !googleLive
      ? 'coming soon to both stores'
      : appleLive
        ? 'Google Play coming soon'
        : 'App Store coming soon';

  // Same rule for the socials row: all four missing is one line under the row; a partial state
  // marks the individual entries instead, since a shared line could not say which.
  const liveSocials = SOCIALS.filter((s) => isLive(s.href)).length;
  const socialsAllSoon = liveSocials === 0;

  return (
    <main className="cs-lk">
      <style>{CSS}</style>

      <div className="cs-lk-glow" aria-hidden="true" />

      <div className="cs-lk-inner">
        <header className="cs-lk-head">
          <div className="cs-lk-mark cs-lk-rise" aria-hidden="true" style={{ '--lk-at': AT.mark }}>
            &#10022;
          </div>
          <h1 className="cs-lk-wordmark cs-lk-rise" style={{ '--lk-at': AT.wordmark }}>
            Calvary Scribblings
          </h1>
          <p className="cs-lk-tagline cs-lk-rise" style={{ '--lk-at': AT.tagline }}>
            The Story Island — original fiction, poetry and essays
          </p>
        </header>

        <nav className="cs-lk-stack" aria-label="Calvary Scribblings">
          <StackRow
            ornament="&#10022;"
            label="Read on Calvary Scribblings"
            href={LINKS.own.library}
            at={AT.buttons[0]}
          />
          <StackRow
            ornament="&#10086;&#65038;"
            label={BOOKSTORE_LABEL}
            href={LINKS.own.bookstore}
            at={AT.buttons[1]}
          />
          <StackRow label="Calvary Films" href={LINKS.own.films} at={AT.buttons[2]} />
        </nav>

        <div className="cs-lk-divider cs-lk-rise" aria-hidden="true" style={{ '--lk-at': AT.divider }}>
          &#10022;
        </div>

        <section className="cs-lk-app" aria-labelledby="cs-lk-app-h">
          <h2 className="cs-lk-app-h cs-lk-rise" id="cs-lk-app-h" style={{ '--lk-at': AT.appHead }}>
            Story Island — the reading app
          </h2>
          <div className="cs-lk-badges cs-lk-rise" style={{ '--lk-at': AT.badges }}>
            <Badge
              href={LINKS.app.appStore}
              src="/badges/download-on-the-app-store.svg"
              className="cs-lk-badge-apple"
              alt={appleLive ? 'Download Story Island on the App Store' : 'Download on the App Store — coming soon'}
              width="120"
              height="40"
            />
            <Badge
              href={LINKS.app.googlePlay}
              src="/badges/google-play-badge.png"
              className="cs-lk-badge-google"
              alt={googleLive ? 'Get Story Island on Google Play' : 'Get it on Google Play — coming soon'}
              width="646"
              height="250"
            />
          </div>
          {appNote ? (
            <p className="cs-lk-soon-line cs-lk-rise" style={{ '--lk-at': AT.badges }}>
              {appNote}
            </p>
          ) : null}
        </section>

        <ul className="cs-lk-socials cs-lk-rise" style={{ '--lk-at': AT.socials }}>
          {SOCIALS.map((s) => (
            <li key={s.key}>
              {isLive(s.href) ? (
                <a className="cs-lk-social" href={s.href} target="_blank" rel="noopener noreferrer">
                  {s.label}
                </a>
              ) : (
                <span className="cs-lk-social is-soon" aria-disabled="true">
                  {s.label}
                  {socialsAllSoon ? null : <span className="cs-lk-soon">soon</span>}
                </span>
              )}
            </li>
          ))}
        </ul>
        {socialsAllSoon ? (
          <p className="cs-lk-soon-line cs-lk-rise" style={{ '--lk-at': AT.socials }}>
            social accounts coming soon
          </p>
        ) : null}

        <p className="cs-lk-footer cs-lk-rise" style={{ '--lk-at': AT.footer }}>
          © Calvary Media UK Ltd
        </p>
      </div>
    </main>
  );
}
