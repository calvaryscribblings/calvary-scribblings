'use client';
// MY LIBRARY — the reader's own shelf. PLATFORM territory, gateway grammar (night canvas,
// gold + cream, Cinzel labels over Cormorant prose), not the purple platform chrome and not
// the bookstore's gold/black retail look.
//
// Two sections behind one switch:
//   ✦ STORIES — offline-saved stories. Shell only this round: the empty state is the whole
//               surface. The saving machinery (service worker, shelf writes, tier caps) is
//               Round 2 — nothing here reads or writes a shelf yet.
//   ❦ BOOKS   — purchased books, ported verbatim from the retired /library: reads
//               bookstore_purchases/{uid}, resolves display fields from bookstore_titles/{id}
//               (keyed by the same slug), 'Read now' → /reader/{slug}. Since the Book Store
//               doesn't open until 30 September 2026 there are no purchases yet, so the
//               countdown IS the empty state.
//
// /library is retired into this page (redirect in scripts/generate-redirects.mjs). It was
// platform territory, not bookstore-owned — it *was* the BOOKS half of this page.
//
// The countdown is the gateway's, verbatim in shape: London-anchored, date-only so it ticks
// over at London midnight, and server-rendered as the static LAUNCH_TEXT with the day count
// hydrated in — exactly as app/components/Gateway.js does it, so the no-JS and crawler render
// is a true sentence rather than a blank.
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { db } from '../lib/firebaseCore';
import AuthModal from '../components/AuthModal';
import TabBar, { TabLinks } from '../components/TabBar';
import CoverImage from '../components/CoverImage';
import {
  listSaved, removeSaved, getCoverURL, capFor, isUnlimitedCap, keptAgo,
  isIOSSafariBrowser, getMeta, setMeta,
} from '../lib/shelf';
import { useMembership } from '../lib/MembershipContext';
import { formatCatalogueNumber } from '../bookstore/components/fields';
import { registerShelfWorker, sealShelf } from '../lib/shelfWorker';
import { useOffline } from '../lib/useOffline';

const DISPLAY = "'Cormorant Garamond', Georgia, serif";
const LABEL = "'Cinzel', 'Cormorant Garamond', Georgia, serif";

// Mirrors app/components/Gateway.js — same date, same fallback sentence.
const LAUNCH = { y: 2026, m: 9, d: 30 };
const LAUNCH_TEXT = 'Opens 30 September';

function daysUntilLaunch() {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const get = (t) => Number(parts.find((p) => p.type === t).value);
    const today = Date.UTC(get('year'), get('month') - 1, get('day'));
    const target = Date.UTC(LAUNCH.y, LAUNCH.m - 1, LAUNCH.d);
    return Math.round((target - today) / 86400000);
  } catch {
    return null;
  }
}

// Cover fallback gradients, carried over from /library so a title with no artwork still
// reads as a book rather than a hole in the grid.
const COVERS = [
  'linear-gradient(150deg,#3a1f52,#140b22)',
  'linear-gradient(150deg,#1b2c4a,#0d1120)',
  'linear-gradient(150deg,#4a2036,#1c0c18)',
  'linear-gradient(150deg,#22324a,#0b1018)',
  'linear-gradient(150deg,#2c2440,#120e1e)',
  'linear-gradient(150deg,#1a2a24,#0a1210)',
];
function gradientFor(seed) {
  let h = 0;
  const s = String(seed || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return COVERS[h % COVERS.length];
}

// R9.1 LB-8 — a book whose access has been withdrawn renders IN PLACE, in the position its
// purchase date earns it. It is never filtered out, never pushed to the bottom, never
// reordered: a reader who paid for a book and then lost access needs to SEE that, and a row
// that quietly vanishes reads as a bug in the shelf rather than a fact about the purchase.
//
// The treatment matches the reader's own revoked gate (app/reader/[slug]/book-reader.js) so
// the two surfaces read as one product: the same "Access Withdrawn" wording, and the same
// quiet route onward to the Book Store instead of a dead end.
// A VOLUME ON THE LEDGE.
//
// The shelf used to be a grid of rectangles with a link underneath — inventory. The three
// things a grid cannot say on its own are the three this renders: that the book is OWNED
// (the bookplate), that it stands somewhere (the ledge and its shadow), and how far into it
// the reader is (the ribbon).
//
// PORTABILITY. This is the Phase A reference for the app's shelf, so every effect here has a
// plain equivalent on RN: gradients, borders, opacity, box-shadow, translate/scale. No 3D
// transforms, no backdrop-filter, no :has(), no mix-blend-mode. BoundBook's full flip is the
// bookstore's language and deliberately NOT borrowed — "slight dimensionality", per the
// brief, is a fore-edge, a spine shadow and one sheen, not a rotating object.
function BookCard({ book, index, progress }) {
  const withdrawn = !book.active;
  const cat = formatCatalogueNumber(book.catalogueNumber);
  // Fraction only. No CFI maths, no page estimates: the record carries a 0–1 number and the
  // shelf reports it. A book with no record has not been opened, which is a "Begin", not 0%.
  const pct = progress != null ? Math.max(1, Math.min(100, Math.round(progress * 100))) : null;
  const started = pct != null && !withdrawn;

  return (
    <article className={`ml-vol${withdrawn ? ' is-withdrawn' : ''}`} style={{ '--i': index }}>
      <div className="ml-stage">
        <a
          className="ml-book"
          href={withdrawn ? `/bookstore/${book.slug}` : `/reader/${book.slug}`}
          aria-label={withdrawn ? `${book.title} — access withdrawn` : book.title}
        >
          <span className="ml-boards" style={{ background: gradientFor(book.slug || book.title) }}>
            {book.coverUrl
              ? <img src={book.coverUrl} alt="" className="ml-art" loading="lazy" decoding="async" />
              : <span className="ml-art-t">{book.title}</span>}
            {/* Lamplight from above-left: one sheen, one spine shadow, one fore-edge. */}
            <span className="ml-sheen" aria-hidden="true" />
            <span className="ml-spine" aria-hidden="true" />
            <span className="ml-foreedge" aria-hidden="true" />
            {/* THE RIBBON IS THE PROGRESS. Its length down the boards is the fraction read,
                so the marker sits where the reader stopped — the same information the text
                gives, in the object's own language. Hidden from AT: the line below says it
                in words, and a decorative ribbon announcing "43 percent" twice is noise. */}
            {started && (
              <span className="ml-ribbon" style={{ height: `calc(6% + ${pct * 0.82}%)` }} aria-hidden="true" />
            )}
          </span>
        </a>
        <span className="ml-ledge" aria-hidden="true" />
      </div>

      {/* The bookplate — printed matter, cream stock and brown ink, the same register as
          BoundBook's back face. It is pasted inside the cover of a book you own, which is
          exactly what it is being used to say here. */}
      <div className="ml-plate">
        <span className="ml-plate-cat">{cat || 'CS —'}</span>
        <span className="ml-plate-state">{withdrawn ? 'WITHDRAWN' : 'PURCHASED'}</span>
      </div>

      <h3 className="ml-vol-t">{book.title}</h3>
      {book.author && <p className="ml-vol-a">{book.author}</p>}

      {withdrawn ? (
        <>
          {/* R9.1 LB-8, unchanged in substance: same wording, same quiet route onward. */}
          <div className="ml-withdrawn">ACCESS WITHDRAWN</div>
          <a className="ml-quiet" href={`/bookstore/${book.slug}`}>VIEW IN THE BOOK STORE</a>
        </>
      ) : started ? (
        <div className="ml-vol-foot">
          <span className="ml-pct">{pct}% in</span>
          <a className="ml-gild" href={`/reader/${book.slug}`}>CONTINUE READING</a>
        </div>
      ) : (
        <div className="ml-vol-foot">
          <a className="ml-gild" href={`/reader/${book.slug}`}>BEGIN</a>
        </div>
      )}
    </article>
  );
}

// A saved story on the shelf.
//
// A LEAN LOCAL CARD, not app/components/StoryCard. That component is built for the public
// library grid: it renders a QuizPill, an isNew() badge, a live read count and an optional
// rank, inside the purple platform chrome. None of that belongs on a night-canvas shelf,
// and the read count is live data a saved story deliberately does not carry. This card
// reuses the page's own .ml-cover/.ml-meta-* grid — already built for BOOKS — so STORIES
// and BOOKS are visibly the same shelf.
//
// CoverImage IS reused, because it earns its keep here more than anywhere: it decodes the
// blurhash from coverHash with zero network, so a cover whose blob went missing degrades to
// the story's own colour rather than a hole in the grid.
function ShelfStoryCard({ record, onRemove, busy, index }) {
  const [coverURL, setCoverURL] = useState(null);

  useEffect(() => {
    let url = null;
    let cancelled = false;
    getCoverURL(record).then((u) => {
      if (cancelled) { if (u) URL.revokeObjectURL(u); return; }
      url = u;
      setCoverURL(u);
    });
    // Object URLs are held by the document until revoked; a shelf that mounts and unmounts
    // without this leaks a blob per visit.
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [record.id, record.coverBlobKey]);

  const href = `/my-library/read?slug=${encodeURIComponent(record.slug)}`;

  return (
    <article className="ml-vol" style={{ '--i': index }}>
      <div className="ml-stage">
        <a className="ml-book" href={href} aria-label={record.title}>
          <span className="ml-boards">
            {/* No `cover` fallback URL on purpose: offline that remote URL cannot load, and
                CoverImage holds the <img> at opacity 0 until it decodes — so a missing blob
                leaves the blurhash showing rather than a broken-image glyph over it. */}
            <CoverImage
              fill
              coverSizes={coverURL ? { w360: coverURL } : null}
              coverHash={record.coverHash}
              alt=""
            />
            <span className="ml-sheen" aria-hidden="true" />
            <span className="ml-spine" aria-hidden="true" />
            <span className="ml-foreedge" aria-hidden="true" />
            {/* THE SEAL. The on-this-device fact was a grey caption; it is the whole reason
                this half of the shelf exists, so it becomes a stamp pressed on the object.
                Gold as light, not trim — it reads as something applied, not as a badge. */}
            <span className="ml-seal" aria-hidden="true">✦</span>
          </span>
        </a>
        <span className="ml-ledge" aria-hidden="true" />
      </div>

      <h3 className="ml-vol-t">{record.title}</h3>
      {record.author && <p className="ml-vol-a">{record.author}</p>}
      <p className="ml-kept">
        <span className="ml-kept-mark" aria-hidden="true">✦</span>
        {keptAgo(record.savedAt)}
        <span className="ml-sr">, saved on this device</span>
      </p>

      <div className="ml-vol-foot">
        <a className="ml-gild" href={href}>READ</a>
        {/* Quiet, never alarming: no red, no border, no warning shape. Removing a story you
            saved is an ordinary act and the shelf should not flinch at it. */}
        <button className="ml-quiet ml-quiet-btn" type="button" disabled={busy} onClick={() => onRemove(record.slug)}>
          REMOVE
        </button>
      </div>
    </article>
  );
}

// Capacity as slots, not a fraction. Two filled pips out of two says "your shelf is full" at
// a glance in a way "2 of 2" never did.
//
// BUILT FOR 20 FROM THE START, because tiers are coming and a pip row that works at 2 and
// falls apart at 20 would have to be redesigned exactly when it matters. Past twelve the pips
// would be a smear, so it switches to a filled rail with the same reading — same component,
// same vocabulary, one branch. R11.6 collected on that: Gold's 20 arrived and took the rail
// branch that was already here.
//
// PLATINUM HAS NO DENOMINATOR. Its cap is Infinity, so there is nothing to draw a fraction
// against and nothing to fill a rail to — `used / Infinity` is 0 and would render a full
// shelf as an empty bar, which is worse than drawing no bar at all. It gets the count and the
// word instead. (Array.from({ length: Infinity }) throws, which is the other reason this
// branch comes first.)
function SlotPips({ used, cap }) {
  const label = `${used} of ${cap} saved`;
  if (isUnlimitedCap(cap)) {
    return (
      <div className="ml-slots" role="img" aria-label={`${used} saved, no limit`}>
        <span className="ml-slots-n">{used}<span className="ml-slots-of"> saved · no limit</span></span>
      </div>
    );
  }
  if (cap > 12) {
    const pctFull = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
    return (
      <div className="ml-slots" role="img" aria-label={label}>
        <span className="ml-rail"><span className="ml-rail-fill" style={{ width: `${pctFull}%` }} /></span>
        <span className="ml-slots-n">{used}<span className="ml-slots-of"> / {cap}</span></span>
      </div>
    );
  }
  return (
    <div className="ml-slots" role="img" aria-label={label}>
      {Array.from({ length: cap }).map((_, i) => (
        <span key={i} className={`ml-pip${i < used ? ' is-filled' : ''}`} />
      ))}
    </div>
  );
}

export default function MyLibraryPage() {
  const { user, loading } = useAuth();
  const [section, setSection] = useState('stories');
  const [showAuth, setShowAuth] = useState(false);
  const [opensLabel, setOpensLabel] = useState(LAUNCH_TEXT);
  const [books, setBooks] = useState(null); // null = not loaded, [] = none owned
  // titleId -> fraction (0–1). {} once read; a titleId absent from it has never been opened.
  const [progress, setProgress] = useState({});

  // ── STORIES — the offline shelf ────────────────────────────────────────────────────────
  const offline = useOffline();
  const [saved, setSaved] = useState(null); // null = not loaded, [] = nothing saved
  const [removing, setRemoving] = useState(false);
  const [showNudge, setShowNudge] = useState(false);

  // The cap is the reader's: Free 2 · Gold 20 · Platinum unlimited, live from the membership
  // record and recomputed the moment a pass lapses. `tierLoading` is true for the one beat
  // before the record arrives, and during it `tier` is the 'free' default — so every surface
  // that would print a number treats that beat as "not loaded yet" rather than printing 2 at
  // a Gold member. Same discipline as SaveForOffline's disabled button.
  const { tier, loading: tierLoading } = useMembership();
  const cap = capFor('story', tier);
  const unlimited = isUnlimitedCap(cap);
  // The shelf grid's placeholder count. It cannot be the cap: Platinum's is Infinity, and
  // twenty skeletons for Gold would be a page of grey where two seconds ago there was none.
  const skeletons = unlimited ? 6 : Math.min(cap, 6);

  const loadShelf = useCallback(async () => {
    if (!user) { setSaved(null); return; }
    setSaved(await listSaved(user.uid, 'story'));
  }, [user]);

  useEffect(() => { if (!loading) loadShelf(); }, [loadShelf, loading]);

  // Register here as well as on the story page: a reader can arrive at the shelf first
  // (it is the manifest's start_url, so an installed launch lands here), and the shell
  // must be sealed against the CURRENT deploy before they next lose signal.
  useEffect(() => {
    registerShelfWorker().then((reg) => { if (reg) sealShelf(); });
  }, []);

  const doRemove = useCallback(async (slug) => {
    if (!user) return;
    setRemoving(true);
    try {
      await removeSaved(user.uid, slug);
      await loadShelf();
    } finally {
      setRemoving(false);
    }
  }, [user, loadShelf]);

  // The iOS nudge, EARNED rather than pre-emptive. Safari clears all script-writable
  // storage after ~7 days without a visit, and the only exemption is a site on the Home
  // Screen — so a reader with a filled shelf on an iPhone is about to lose it silently.
  // Conditions, all required: iOS, in Safari's browser UI (not already installed), and at
  // least one story actually saved. Asking someone to install an app before they have used
  // it is an interstitial; asking after they have saved something is a warning.
  useEffect(() => {
    if (!Array.isArray(saved) || saved.length === 0) { setShowNudge(false); return; }
    if (!isIOSSafariBrowser()) { setShowNudge(false); return; }
    let cancelled = false;
    getMeta('iosNudgeDismissedAt', 0).then((ts) => {
      if (cancelled) return;
      // Re-offer after 30 days: still on iOS, still not installed, still holding a shelf
      // that Safari will bin. Once is polite; never again would be negligent.
      const RE_OFFER_MS = 30 * 24 * 60 * 60 * 1000;
      setShowNudge(!ts || Date.now() - ts > RE_OFFER_MS);
    });
    return () => { cancelled = true; };
  }, [saved]);

  const dismissNudge = async () => {
    setShowNudge(false);
    await setMeta('iosNudgeDismissedAt', Date.now());
  };

  // Countdown: static wording on the server, day count hydrated on the client. Re-ticks each
  // minute so a page left open across London midnight doesn't go stale.
  useEffect(() => {
    const tick = () => {
      const n = daysUntilLaunch();
      if (n === null || n <= 0) setOpensLabel(LAUNCH_TEXT);
      else if (n === 1) setOpensLabel('Opens tomorrow');
      else setOpensLabel(`Opens in ${n} days`);
    };
    tick();
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, []);

  // R9.7 — READING POSITION. bookstore_reading_progress/{uid} is owner-only, so this is ONE
  // read of the reader's own node rather than a fetch per book: a shelf of twelve should not
  // cost twelve round trips to draw twelve ribbons.
  //
  // It is deliberately separate from the purchases effect and deliberately non-blocking. A
  // failure here — offline, rules, a half-written record — must leave the shelf rendering
  // books with no ribbons, never an empty shelf: position is an ornament on ownership, and
  // ownership is what the purchases read establishes.
  useEffect(() => {
    if (loading || !user) { setProgress({}); return undefined; }
    let cancelled = false;
    (async () => {
      try {
        const { ref, get } = await import('firebase/database');
        const snap = await get(ref(db, `bookstore_reading_progress/${user.uid}`));
        if (cancelled || !snap.exists()) return;
        const map = {};
        snap.forEach((child) => {
          const f = child.val()?.fraction;
          // The rule bounds this 0–1, but the shelf is downstream of a client write and a
          // ribbon drawn from a bad number is a visibly broken book.
          if (typeof f === 'number' && f > 0 && f <= 1) map[child.key] = f;
          return false;
        });
        if (!cancelled) setProgress(map);
      } catch (e) {
        console.error('[my-library] reading progress load failed', e);
      }
    })();
    return () => { cancelled = true; };
  }, [user, loading]);

  // BOOKS — ported from /library.
  useEffect(() => {
    if (loading || !user) { setBooks(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const { ref, get } = await import('firebase/database');
        const snap = await get(ref(db, `bookstore_purchases/${user.uid}`));
        if (!snap.exists()) { if (!cancelled) setBooks([]); return; }

        const entries = [];
        snap.forEach((child) => { entries.push({ id: child.key, ...(child.val() || {}) }); return false; });

        const resolved = await Promise.all(entries.map(async (p) => {
          let titleDoc = null;
          try {
            const tsnap = await get(ref(db, `bookstore_titles/${p.id}`));
            if (tsnap.exists()) titleDoc = tsnap.val();
          } catch { /* fall back to denormalised purchase fields */ }
          return {
            // R9.7: the titleId is carried through now. bookstore_reading_progress is keyed
            // by titleId while this shelf is keyed by slug, so without it the progress
            // record cannot be matched to the row it belongs to. Nothing else about this
            // read changed — same node, same fields, same fallbacks.
            id: p.id,
            slug: titleDoc?.slug || p.slug || p.id,
            title: titleDoc?.title || p.title || 'Untitled',
            author: titleDoc?.author || p.author || '',
            coverUrl: titleDoc?.coverUrl || p.coverUrl || null,
            // Presentation field for the bookplate. Absent ⇒ the plate prints no mark, the
            // same rule book-reader.js applies: an id is not a catalogue number.
            catalogueNumber: titleDoc?.catalogueNumber ?? null,
            purchasedAt: typeof p.purchasedAt === 'number' ? p.purchasedAt : 0,
            // R9.1 LB-8. `status === 'active'` verbatim, because that is the exact test the
            // server gate applies before it will hand over the file
            // (functions/api/bookstore/stream.js). Any looser reading here — treating a
            // missing status as owned, say — would show a READ NOW that 403s on tap.
            active: p.status === 'active',
          };
        }));

        // ── ONE ROW PER SLUG, ACTIVE WINS ─────────────────────────────────────────
        // Purchases are keyed by titleId, but the shelf is keyed by SLUG: two catalogue
        // entries can carry the same slug (a re-issue, a publisher migration), and the
        // reader owns "the book", not the row. So if ANY record for a slug is active the
        // reader owns it and no withdrawn ghost appears beside it; the withdrawn row shows
        // only when EVERY record for that slug is revoked.
        //
        // This also removes a latent duplicate-key warning — the grid below keys on slug.
        const bySlug = new Map();
        for (const row of resolved) {
          const prev = bySlug.get(row.slug);
          if (!prev) { bySlug.set(row.slug, row); continue; }
          // Active beats withdrawn outright. Between two of the same standing, the most
          // recent purchase is the one that describes the reader's position today.
          if (row.active !== prev.active) {
            if (row.active) bySlug.set(row.slug, row);
          } else if ((row.purchasedAt || 0) > (prev.purchasedAt || 0)) {
            bySlug.set(row.slug, row);
          }
        }

        // Sorted by purchase date ALONE. Status deliberately plays no part: a withdrawn book
        // holds the place it earned, which is what "renders in place" means.
        const shelf = [...bySlug.values()].sort((a, b) => (b.purchasedAt || 0) - (a.purchasedAt || 0));
        if (!cancelled) setBooks(shelf);
      } catch (e) {
        console.error('[my-library] purchases load failed', e);
        if (!cancelled) setBooks([]);
      }
    })();
    return () => { cancelled = true; };
  }, [user, loading]);

  const initials = user ? (user.displayName || 'R').split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() : '';
  // R9.1 LB-8: withdrawn books are shown but not counted as owned — the switch says "N owned"
  // and a book whose access has been withdrawn is precisely the one the reader no longer owns.
  const ownedCount = Array.isArray(books) ? books.filter((b) => b.active).length : 0;

  return (
    <div className="ml-page">
      <style>{`
        .ml-page {
          min-height: 100vh;
          background: radial-gradient(130% 60% at 50% -10%, #241347 0%, #0b0716 58%, #080610 100%);
          background-attachment: fixed;
          color: #f5f0e8; font-family: ${DISPLAY};
        }
        .ml-topbar { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 16px 18px 12px; }
        @media (min-width: 768px) { .ml-topbar { padding: 16px 40px 12px; } }
        .ml-wordmark { font-family: ${LABEL}; font-size: 11px; letter-spacing: .28em; color: #f5f0e8; text-decoration: none; white-space: nowrap; }
        .ml-hairline { height: 1px; background: linear-gradient(90deg, transparent, rgba(201,168,76,.5), transparent); }

        /* Canonical glass — .cs-gw-glass, verbatim (see app/components/Gateway.js). */
        .ml-glass {
          background: linear-gradient(160deg, rgba(245,240,232,.055), rgba(91,43,160,.10));
          -webkit-backdrop-filter: blur(14px) saturate(1.35);
          backdrop-filter: blur(14px) saturate(1.35);
          border: 1px solid rgba(201,168,76,.35);
          box-shadow: inset 0 1px 0 rgba(245,240,232,.14), inset 0 -1px 0 rgba(0,0,0,.25);
        }
        @supports not ((backdrop-filter: blur(14px)) or (-webkit-backdrop-filter: blur(14px))) {
          .ml-glass { background: rgba(11,7,22,.88); }
        }

        .ml-avatar {
          width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0;
          display: grid; place-items: center; text-decoration: none;
          font-family: ${LABEL}; font-size: 9px; color: #e2c876;
          border: 1px solid rgba(201,168,76,.35);
          background: linear-gradient(160deg, rgba(245,240,232,.055), rgba(91,43,160,.10));
          overflow: hidden;
        }
        .ml-signin {
          border-radius: 999px; padding: 7px 15px; cursor: pointer;
          font-family: ${LABEL}; font-size: 8.5px; letter-spacing: .2em; color: #e2c876;
        }

        .ml-body { padding: 22px 18px 34px; max-width: 1180px; margin: 0 auto; }
        @media (min-width: 768px) { .ml-body { padding: 26px 40px 48px; } }

        .ml-eyebrow { font-family: ${LABEL}; font-size: 9.5px; letter-spacing: .3em; color: #c9a84c; text-align: center; }
        .ml-rule { width: 60px; height: 1px; background: #c9a84c; opacity: .55; margin: 9px auto 0; }

        /* THE PLAQUES — what the STORIES / BOOKS switch became. Engraved brass on the wall
           of the corner, not two buttons: an inset ground, a hairline edge catching the same
           lamplight as the shelves, and the active one lit rather than outlined. */
        .ml-switch { display: flex; gap: 10px; justify-content: center; margin: 22px 0 4px; }
        .ml-sw {
          flex: 1; max-width: 172px; border-radius: 4px; padding: 12px 9px 11px; text-align: center;
          cursor: pointer; font: inherit; color: inherit; position: relative;
          border: 1px solid rgba(201,168,76,.28);
          background: linear-gradient(180deg, rgba(245,240,232,.05), rgba(0,0,0,.22));
          box-shadow: inset 0 1px 0 rgba(255,246,222,.14), inset 0 -1px 0 rgba(0,0,0,.4), 0 2px 6px rgba(0,0,0,.4);
          transition: border-color .2s ease, background .2s ease;
        }
        .ml-sw:focus-visible { outline: 2px solid #e2c876; outline-offset: 3px; }
        .ml-sw-g { display: block; font-size: 14px; color: rgba(201,168,76,.7); margin-bottom: 5px; }
        .ml-sw-t { display: block; font-family: ${LABEL}; font-size: 9.5px; letter-spacing: .2em; color: rgba(245,240,232,.72); }
        .ml-sw-n { display: block; font-size: 11px; color: rgba(245,240,232,.6); margin-top: 3px; }
        /* Lit, not merely outlined: the plaque the reader is standing at catches the lamp. */
        .ml-sw.is-on {
          border-color: rgba(226,200,118,.7);
          background: linear-gradient(180deg, rgba(201,168,76,.16), rgba(0,0,0,.2));
          box-shadow: inset 0 1px 0 rgba(255,246,222,.24), inset 0 -1px 0 rgba(0,0,0,.4), 0 2px 10px rgba(201,168,76,.14);
        }
        .ml-sw.is-on .ml-sw-g { color: #e2c876; }
        .ml-sw.is-on .ml-sw-t { color: #f5f0e8; }
        .ml-sw-slots { display: flex; justify-content: center; margin-top: 6px; }

        .ml-empty { text-align: center; padding: 56px 22px 30px; }
        .ml-empty-g { font-size: 22px; color: rgba(201,168,76,.5); }
        .ml-empty-h { font-size: 20px; color: #f5f0e8; margin-top: 14px; }
        .ml-empty-p { font-size: 14.5px; line-height: 1.55; color: rgba(245,240,232,.62); max-width: 290px; margin: 8px auto 0; }
        .ml-empty-p i { color: #e2c876; font-style: normal; }
        .ml-btn {
          display: inline-block; margin-top: 20px; border-radius: 999px; padding: 11px 22px;
          font-family: ${LABEL}; font-size: 9px; letter-spacing: .2em; color: #e2c876;
          text-decoration: none; cursor: pointer; transition: transform .09s ease;
        }
        .ml-btn:active { transform: scale(.985); }
        .ml-btn:focus-visible { outline: 1px solid rgba(226,200,118,.9); outline-offset: 3px; }

        .ml-soon { text-align: center; padding: 50px 22px 30px; }
        .ml-soon-g { font-size: 20px; color: rgba(201,168,76,.5); }
        .ml-soon-d { font-style: italic; font-size: 26px; color: #e2c876; margin-top: 12px; }
        .ml-soon-p { font-size: 14.5px; line-height: 1.55; color: rgba(245,240,232,.62); max-width: 300px; margin: 8px auto 0; }
        .ml-soon-note { font-family: ${LABEL}; font-size: 8px; letter-spacing: .16em; color: rgba(245,240,232,.6); margin-top: 22px; }

        /* ═══ THE SHELF ═══════════════════════════════════════════════════════════════════
           EVERY VALUE BELOW HAS A PLAIN RN EQUIVALENT — gradients, borders, opacity,
           box-shadow, translate/scale. No 3D transforms, no backdrop-filter on anything
           load-bearing, no :has(), no mix-blend-mode. This is the Phase A reference for the
           app's shelf, so a trick the app cannot copy is a trick that puts the two surfaces
           out of step on day one.

           CONTRAST. Cream on this ground needs alpha >= .50 to clear AA at 4.5:1, which is
           why nothing below is dimmer than .55 — the old .32 captions measured ~2.5:1.
           tests/ci/my-library-contrast.test.mjs computes these from this stylesheet. */

        /* THE COLUMN COUNT IS THE CARD SIZE. Nothing on a volume is sized in its own right —
           the boards take their height from a 2/3 aspect on whatever width the column gives
           them, and the plate, ribbon, seal and gilded label are fixed type on top. So the
           only honest lever for "smaller cards" is more columns, and the only question worth
           asking is how narrow a column may get before something on the card breaks.

           THE BOOKPLATE IS THE FLOOR, at 103px. It is a flex row of two Cinzel runs that
           cannot wrap — 'CS 001' against 'PURCHASED'/'WITHDRAWN', the longest pair the
           catalogue can produce (formatCatalogueNumber pads to three digits) — plus 14px of
           padding and a 6px gap. Measured in the browser at the real font, not estimated. A
           column under 103px does not make the plate smaller; it makes the two runs collide.
           Every breakpoint below is therefore chosen so the narrowest card it can produce
           still clears that, with slack: the range runs 108px (a 380px phone) to 146px (any
           desktop), against 170-235px before.

           WHY 380px AND NOT 0. Three-up on a 360px phone computes to 101px, which is under
           the floor — so the narrowest phones keep the two-up shelf rather than get a broken
           bookplate. That is the one width this pass cannot improve without shrinking plate
           type, which would be a redesign of the plate rather than a resize of the card. */
        .ml-grid { display: grid; gap: 18px 14px; margin-top: 20px; grid-template-columns: repeat(2, 1fr); }
        @media (min-width: 380px) { .ml-grid { grid-template-columns: repeat(3, 1fr); gap: 16px 10px; } }
        @media (min-width: 560px) { .ml-grid { grid-template-columns: repeat(4, 1fr); gap: 20px 14px; } }
        @media (min-width: 720px) { .ml-grid { grid-template-columns: repeat(5, 1fr); } }
        @media (min-width: 900px) { .ml-grid { grid-template-columns: repeat(6, 1fr); } }
        @media (min-width: 1180px) { .ml-grid { grid-template-columns: repeat(7, 1fr); } }

        .ml-vol { min-width: 0; }

        /* The stage is cover + ledge. The ledge is per-card rather than per-row: a wrapping
           grid has no row element to draw on, and a per-card ledge is what the app can
           reproduce with one view under each cover. */
        .ml-stage { position: relative; }
        .ml-book { display: block; text-decoration: none; border-radius: 3px 6px 6px 3px; }
        .ml-book:focus-visible { outline: 2px solid #e2c876; outline-offset: 4px; }

        .ml-boards {
          position: relative; display: block; aspect-ratio: 2/3; overflow: hidden;
          border-radius: 3px 6px 6px 3px;
          /* Standing, not floating: a contact shadow tight under the boards plus a longer,
             softer cast to the lower right, as one lamp above-left would throw it. */
          box-shadow:
            0 1px 0 rgba(0,0,0,.6),
            6px 10px 22px rgba(0,0,0,.55),
            0 0 0 1px rgba(201,168,76,.16);
          transition: transform .16s ease, box-shadow .16s ease;
        }
        .ml-art { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
        .ml-art-t {
          position: absolute; inset: 0; display: grid; place-items: center; padding: 14px 10px;
          font-family: ${LABEL}; font-size: 10px; letter-spacing: .1em; text-align: center;
          color: rgba(245,240,232,.94); line-height: 1.5;
        }

        /* Lamplight. One sheen across the top-left corner — gold as LIGHT, not as trim. */
        .ml-sheen {
          position: absolute; inset: 0; pointer-events: none;
          background: linear-gradient(122deg, rgba(255,246,222,.16) 0%, rgba(255,246,222,.05) 24%, transparent 46%);
        }
        /* The hinge side: a dark gutter with one bright line where the light catches it. */
        .ml-spine {
          position: absolute; top: 0; bottom: 0; left: 0; width: 9px; pointer-events: none;
          background: linear-gradient(90deg, rgba(0,0,0,.55) 0%, rgba(0,0,0,.18) 55%, rgba(255,246,222,.10) 78%, transparent 100%);
        }
        /* The fore-edge: the page block, which is the one detail that says "book" rather
           than "picture" at this size. Two hairlines, no repeating stripe — at 150px wide a
           striped edge is moiré, not paper. */
        .ml-foreedge {
          position: absolute; top: 3%; bottom: 3%; right: 0; width: 4px; pointer-events: none;
          background: linear-gradient(90deg, rgba(0,0,0,.35), rgba(232,224,200,.62) 45%, rgba(180,170,142,.5) 100%);
          border-radius: 0 3px 3px 0;
        }

        /* THE PROGRESS RIBBON. Anchored at the head, hanging to where the reader stopped. */
        .ml-ribbon {
          position: absolute; top: 0; right: 17%; width: 9px; pointer-events: none;
          background: linear-gradient(180deg, #f0dda0, #c9a44c 55%, #a8842f);
          box-shadow: 0 2px 6px rgba(0,0,0,.55);
          border-radius: 0 0 1px 1px;
        }
        .ml-ribbon::after {
          content: ''; position: absolute; left: 0; right: 0; bottom: -5px; height: 6px;
          background: #a8842f;
          clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 48%, 0 100%);
        }

        /* THE SEAL — stories. Pressed into the lower-left corner of the boards. */
        .ml-seal {
          position: absolute; left: 7px; bottom: 7px; width: 20px; height: 20px;
          display: grid; place-items: center; border-radius: 50%;
          font-size: 9px; line-height: 1; color: #2a2318;
          background: radial-gradient(circle at 34% 30%, #f4e2a6, #c9a44c 62%, #9c7b2c);
          box-shadow: 0 2px 5px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.45);
        }

        /* The ledge itself: a lit front edge, a body, and the shadow it casts into the dark. */
        /* MEASURED, not guessed: the first pass ran a 7px ledge at .22 highlight and it
           disappeared entirely under dark cover art — the books read as floating again. These
           values were compared side by side against the built page before being written here. */
        .ml-ledge {
          display: block; height: 10px; margin-top: -1px; border-radius: 0 0 4px 4px;
          background:
            linear-gradient(180deg, rgba(255,246,222,.42) 0%, rgba(201,168,76,.26) 26%, rgba(38,26,12,.9) 62%, rgba(0,0,0,.85) 100%);
          box-shadow: 0 10px 18px -6px rgba(0,0,0,.9), 0 1px 0 rgba(255,246,222,.18);
        }

        /* THE BOOKPLATE — printed matter. Cream stock, brown ink, the register BoundBook's
           back face already established. Contrast is plate-relative (#2a2318 on #ece4cf,
           ~13:1), which is why this is the one light surface on a dark shelf. */
        .ml-plate {
          display: flex; align-items: center; justify-content: space-between; gap: 6px;
          margin-top: 11px; padding: 3px 7px; border-radius: 2px;
          background: linear-gradient(180deg, #ece4cf, #dcd2b6);
          box-shadow: 0 1px 3px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.5);
        }
        .ml-plate-cat { font-family: ${LABEL}; font-size: 8px; letter-spacing: .12em; color: #2a2318; }
        .ml-plate-state { font-family: ${LABEL}; font-size: 6.5px; letter-spacing: .18em; color: #5a4a2a; }

        .ml-vol-t { font-weight: 600; font-size: 13.5px; line-height: 1.25; color: #f5f0e8; margin: 9px 0 0; }
        .ml-vol-a { font-style: italic; font-size: 12px; color: rgba(245,240,232,.62); margin: 2px 0 0; }

        .ml-vol-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 9px; flex-wrap: wrap; }
        .ml-pct { font-family: ${LABEL}; font-size: 7.5px; letter-spacing: .12em; color: rgba(245,240,232,.72); }

        /* THE GILDED LABEL — what READ NOW became. Struck metal, not a button: a hairline
           of gold, a warm fill, and text bright enough to clear AA on it (~10:1). */
        .ml-gild {
          display: inline-block; font-family: ${LABEL}; font-size: 7.5px; letter-spacing: .16em;
          color: #f0dda0; text-decoration: none; cursor: pointer;
          padding: 5px 9px; border-radius: 3px;
          border: 1px solid rgba(201,168,76,.55);
          background: linear-gradient(180deg, rgba(201,168,76,.24), rgba(201,168,76,.07));
          transition: background .18s ease, border-color .18s ease, transform .09s ease;
        }
        .ml-gild:hover { background: linear-gradient(180deg, rgba(201,168,76,.36), rgba(201,168,76,.12)); border-color: rgba(226,200,118,.8); }
        .ml-gild:active { transform: scale(.97); }
        .ml-gild:focus-visible { outline: 2px solid #e2c876; outline-offset: 2px; }

        /* QUIET — remove, and the withdrawn route onward. No red, no border, no warning
           shape: removing a story you saved is an ordinary act. */
        .ml-quiet {
          display: inline-block; font-family: ${LABEL}; font-size: 7.5px; letter-spacing: .14em;
          color: rgba(245,240,232,.58); text-decoration: none; transition: color .18s ease;
        }
        .ml-quiet:hover { color: rgba(245,240,232,.9); }
        .ml-quiet:focus-visible { outline: 2px solid #e2c876; outline-offset: 3px; border-radius: 2px; }
        .ml-quiet-btn { background: none; border: none; padding: 4px 2px; cursor: pointer; font-family: ${LABEL}; }
        .ml-quiet-btn[disabled] { opacity: .5; cursor: default; }

        .ml-kept { display: flex; align-items: center; gap: 5px; margin: 6px 0 0; font-family: ${LABEL}; font-size: 7.5px; letter-spacing: .1em; color: rgba(245,240,232,.58); }
        .ml-kept-mark { color: #c9a84c; font-size: 8px; }
        .ml-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

        /* R9.1 LB-8 — WITHDRAWN. Substance unchanged: in place, full size, never filtered or
           reordered, same wording, same quiet route on. The dimming now also lifts the book
           off the ledge — light stops reaching a book you no longer own. */
        .ml-vol.is-withdrawn .ml-boards { filter: grayscale(1); opacity: .38; box-shadow: 0 1px 0 rgba(0,0,0,.5), 2px 4px 10px rgba(0,0,0,.4); }
        .ml-vol.is-withdrawn .ml-ledge { opacity: .35; }
        .ml-vol.is-withdrawn .ml-plate { background: linear-gradient(180deg, #b9b2a2, #a79f8c); }
        .ml-vol.is-withdrawn .ml-vol-t { color: rgba(245,240,232,.6); }
        .ml-vol.is-withdrawn .ml-vol-a { color: rgba(245,240,232,.55); }
        .ml-withdrawn {
          font-family: ${LABEL}; font-size: 7.5px; letter-spacing: .18em;
          color: rgba(245,240,232,.62); margin-top: 9px;
        }
        .ml-vol.is-withdrawn .ml-quiet { margin-top: 5px; }

        /* SLOT PIPS — capacity as slots. Sized to stay legible from 2 up to 12; past that
           SlotPips switches to the rail. */
        .ml-slots { display: flex; align-items: center; gap: 5px; }
        .ml-pip {
          width: 7px; height: 7px; border-radius: 50%;
          border: 1px solid rgba(201,168,76,.55); background: transparent;
        }
        .ml-pip.is-filled { background: radial-gradient(circle at 34% 30%, #f4e2a6, #c9a44c 70%); border-color: rgba(226,200,118,.85); }
        .ml-rail { display: block; width: 54px; height: 4px; border-radius: 2px; background: rgba(245,240,232,.16); overflow: hidden; }
        .ml-rail-fill { display: block; height: 100%; background: linear-gradient(90deg, #c9a44c, #f4e2a6); }
        .ml-slots-n { font-family: ${LABEL}; font-size: 8px; letter-spacing: .1em; color: rgba(245,240,232,.72); }
        .ml-slots-of { color: rgba(245,240,232,.58); }

        /* ENTRANCE — covers settle onto the ledge. Staggered by index, capped so a full
           shelf does not make the last book wait. */
        @keyframes ml-settle {
          from { opacity: 0; transform: translateY(9px); }
          to { opacity: 1; transform: none; }
        }
        .ml-vol { animation: ml-settle .42s cubic-bezier(.2,.7,.3,1) both; animation-delay: calc(min(var(--i, 0) * 45ms, 450ms)); }

        /* TAP FEEDBACK — the cover lifts toward the reader. */
        @media (hover: hover) {
          .ml-book:hover .ml-boards { transform: translateY(-3px); box-shadow: 0 1px 0 rgba(0,0,0,.6), 8px 14px 28px rgba(0,0,0,.6), 0 0 0 1px rgba(201,168,76,.28); }
        }
        .ml-book:active .ml-boards { transform: translateY(-2px) scale(.99); }

        /* OFFLINE — the banner. Shelf surfaces only. */
        .ml-offline {
          display: flex; align-items: center; justify-content: center; gap: 8px;
          margin: 14px auto 0; max-width: 380px; padding: 9px 14px; border-radius: 9px;
          font-family: ${LABEL}; font-size: 8.5px; letter-spacing: .2em; color: #e2c876; text-align: center;
        }

        /* The device line — stated every time the shelf is looked at, not once at save time. */
        .ml-section-head {
          display: flex; align-items: baseline; justify-content: center; gap: 10px;
          margin-top: 20px; font-family: ${LABEL}; font-size: 8px; letter-spacing: .2em;
          color: rgba(245,240,232,.62); text-align: center; flex-wrap: wrap;
        }
        .ml-section-head b { font-weight: 400; color: rgba(226,200,118,.7); }

        /* R11.7. Quiet by design — one line, prose weight, no button. It appears at the moment
           the shelf fills and says what the limit is before it says what fixes it. */
        .ml-roomier {
          margin: 8px auto 0; text-align: center; max-width: 460px;
          font-size: 13px; line-height: 1.55; color: rgba(232,224,212,.72);
        }
        .ml-roomier a { color: #e2c876; text-decoration: none; white-space: nowrap; }
        .ml-roomier a:hover { text-decoration: underline; }

        .ml-nudge {
          max-width: 420px; margin: 18px auto 0; border-radius: 12px; padding: 15px 16px 13px;
          display: flex; gap: 12px; align-items: flex-start; text-align: left;
        }
        .ml-nudge-g { font-size: 15px; color: rgba(201,168,76,.65); line-height: 1.2; flex-shrink: 0; }
        .ml-nudge-t { font-size: 14px; color: #f5f0e8; line-height: 1.35; }
        .ml-nudge-p { font-size: 12.5px; line-height: 1.5; color: rgba(245,240,232,.6); margin: 4px 0 0; }
        .ml-nudge-x {
          background: none; border: none; padding: 2px 4px; cursor: pointer; flex-shrink: 0;
          font-family: ${LABEL}; font-size: 12px; color: rgba(245,240,232,.62); line-height: 1;
        }
        .ml-nudge-x:hover { color: rgba(245,240,232,.7); }

        .ml-skel { border-radius: 8px; background: rgba(245,240,232,.04); animation: ml-pulse 1.4s ease-in-out infinite; }
        @keyframes ml-pulse { 0%,100% { opacity: .45 } 50% { opacity: .8 } }

        /* The gate — an invitation to save, not a description of an empty container. */
        .ml-gate { max-width: 380px; margin: 44px auto 0; border-radius: 16px; padding: 40px 26px 34px; text-align: center; }
        .ml-gate-g { font-size: 22px; color: rgba(201,168,76,.6); }
        .ml-gate-h { font-size: 20px; color: #f5f0e8; margin-top: 14px; }
        .ml-gate-p { font-size: 14.5px; line-height: 1.55; color: rgba(245,240,232,.62); max-width: 290px; margin: 8px auto 0; }

        /* REDUCED MOTION. The settle is removed outright rather than shortened — a cover
           that still slides, briefly, is still a cover that slides. Everything arrives at
           its final state instantly; nothing that carries meaning is lost, because the
           stagger was never carrying any. The tap lift goes too: it is motion under a
           finger, which is exactly what the preference is about. */
        @media (prefers-reduced-motion: reduce) {
          .ml-sw, .ml-btn, .ml-boards, .ml-gild, .ml-quiet { transition: none; }
          .ml-sw:active, .ml-btn:active, .ml-gild:active { transform: none; }
          .ml-vol { animation: none; }
          .ml-book:hover .ml-boards, .ml-book:active .ml-boards { transform: none; }
          .ml-skel { animation: none; }
        }
      `}</style>

      <div className="ml-topbar">
        <a className="ml-wordmark" href="/public-library">CALVARY SCRIBBLINGS</a>
        <TabLinks active="library" />
        {user ? (
          <a className="ml-avatar" href="/profile" title={user.displayName || 'Profile'}>{initials}</a>
        ) : (
          <button className="ml-signin ml-glass" type="button" onClick={() => setShowAuth(true)}>SIGN IN</button>
        )}
      </div>
      <div className="ml-hairline" />

      <div className="ml-body">
        <div className="ml-eyebrow">MY LIBRARY</div>
        <div className="ml-rule" />

        {/* Signed out — the gate sells the shelf rather than naming the container. */}
        {!loading && !user && (
          <div className="ml-gate ml-glass">
            <div className="ml-gate-g" aria-hidden="true">✦</div>
            <div className="ml-gate-h">Save stories to read offline</div>
            <p className="ml-gate-p">Your shelf keeps them for the tube, the bus, anywhere with no signal. Sign in to start one.</p>
            {/* Said at the gate, before anyone invests in a shelf: this one does not follow
                you between devices. IndexedDB has no sync, and the copy must not imply it does. */}
            <p className="ml-gate-p" style={{ marginTop: 8, fontSize: 13, opacity: .72 }}>
              Your shelf lives on the device you save from.
            </p>
            <button className="ml-btn ml-glass" type="button" onClick={() => setShowAuth(true)}>SIGN IN</button>
          </div>
        )}

        {!loading && user && (
          <>
            <div className="ml-switch">
              <button
                type="button"
                className={`ml-sw ml-glass${section === 'stories' ? ' is-on' : ''}`}
                aria-pressed={section === 'stories'}
                onClick={() => setSection('stories')}
              >
                <span className="ml-sw-g" aria-hidden="true">✦</span>
                <span className="ml-sw-t">STORIES</span>
                {saved === null || tierLoading ? (
                  <span className="ml-sw-n">—</span>
                ) : (
                  <span className="ml-sw-slots"><SlotPips used={saved.length} cap={cap} /></span>
                )}
              </button>
              <button
                type="button"
                className={`ml-sw ml-glass${section === 'books' ? ' is-on' : ''}`}
                aria-pressed={section === 'books'}
                onClick={() => setSection('books')}
              >
                <span className="ml-sw-g" aria-hidden="true">❦</span>
                <span className="ml-sw-t">BOOKS</span>
                <span className="ml-sw-n">{ownedCount > 0 ? `${ownedCount} owned` : 'opens 30 Sept'}</span>
              </button>
            </div>

            {/* ── STORIES — the offline shelf ─────────────────────────── */}
            {section === 'stories' && (
              <>
                {offline && (
                  <div className="ml-offline ml-glass" role="status">
                    <span aria-hidden="true">✦</span> OFFLINE — YOUR SHELF IS HERE
                  </div>
                )}

                {saved === null && (
                  <div className="ml-grid" aria-hidden="true">
                    {Array.from({ length: skeletons }).map((_, i) => (
                      <div key={i}>
                        <div className="ml-skel" style={{ width: '100%', aspectRatio: '2/3' }} />
                        <div className="ml-skel" style={{ height: 11, width: '80%', marginTop: 9 }} />
                        <div className="ml-skel" style={{ height: 9, width: '55%', marginTop: 5 }} />
                      </div>
                    ))}
                  </div>
                )}

                {saved !== null && saved.length > 0 && (
                  <>
                    {/* The device line stays — it is the honesty line, and the seal on each
                        cover is a reminder, not a replacement for saying it once in words. */}
                    <div className="ml-section-head">
                      <span>KEPT ON THIS DEVICE</span>
                      <span aria-hidden="true">·</span>
                      {/* Four readings of the same shelf, and the wrong one is a lie about
                          what the reader owns. Unlimited has no denominator; an over-cap
                          shelf (a lapsed pass — see the ruling above CAPS in app/lib/shelf.js)
                          must say what the plan holds WITHOUT implying anything was taken;
                          and while the tier is still in flight there is no number to print. */}
                      {tierLoading ? (
                        <span><b>{saved.length}</b> SAVED</span>
                      ) : unlimited ? (
                        <span><b>{saved.length}</b> SAVED · NO LIMIT</span>
                      ) : saved.length > cap ? (
                        <span><b>{saved.length}</b> SAVED · YOUR PLAN HOLDS {cap}</span>
                      ) : (
                        <span><b>{saved.length}</b> OF {cap} SLOTS FILLED</span>
                      )}
                    </div>

                    {/* R11.7 — offered only when the shelf is actually FULL, which is the one
                        moment a bigger one is an answer rather than an advert. Withheld while
                        the tier is unknown (it would be a guess), from Platinum (there is no
                        bigger shelf), and from an over-cap reader on a lapsed pass — see the
                        matching note in SaveForOffline. */}
                    {!tierLoading && !unlimited && saved.length === cap && (
                      <div className="ml-roomier">
                        Your shelf is full. <a href="/membership">A bigger one starts at Gold →</a>
                      </div>
                    )}

                    {showNudge && (
                      <div className="ml-nudge ml-glass">
                        <span className="ml-nudge-g" aria-hidden="true">⇧</span>
                        <div style={{ flex: 1 }}>
                          <div className="ml-nudge-t">Keep your shelf longer</div>
                          <p className="ml-nudge-p">
                            iPhone clears saved stories after about a week away — unless Calvary
                            Scribblings is on your Home Screen. Tap <b>Share</b>, then <b>Add to Home Screen</b>.
                          </p>
                        </div>
                        <button className="ml-nudge-x" type="button" onClick={dismissNudge} aria-label="Dismiss">✕</button>
                      </div>
                    )}

                    <div className="ml-grid">
                      {saved.map((r, i) => (
                        <ShelfStoryCard key={r.id} record={r} onRemove={doRemove} busy={removing} index={i} />
                      ))}
                    </div>
                  </>
                )}

                {saved !== null && saved.length === 0 && (
                  <div className="ml-empty">
                    <div className="ml-empty-g" aria-hidden="true">✦</div>
                    <div className="ml-empty-h">Nothing on your shelf yet</div>
                    <p className="ml-empty-p">
                      Open any story and tap <i>⤓ Save for offline</i>. It stays readable with no signal — on the tube, on the bus, anywhere.
                    </p>
                    {/* The honesty line, in the empty state as well as the full one: the
                        constraint should be known BEFORE the first save, not discovered after. */}
                    {/* The honesty line waits for the tier rather than guessing at it: an
                        empty shelf is not urgent, and "your shelf holds 2" shown to a Gold
                        member for one beat is the kind of small lie that costs a subscription. */}
                    {!tierLoading && (
                      <p className="ml-empty-p" style={{ marginTop: 10, fontSize: 13, opacity: .75 }}>
                        {unlimited
                          ? 'Saved stories live on this device only. Your shelf has no limit.'
                          : `Saved stories live on this device only, and your shelf holds ${cap}.`}
                      </p>
                    )}
                    {/* No sell on an EMPTY shelf. A reader who has saved nothing has no cap
                        problem, and offering them a bigger shelf here would be advertising
                        rather than answering — the constraint is stated above and that is
                        enough. The route in appears when the shelf is actually full. */}
                    <a className="ml-btn ml-glass" href="/public-library">BROWSE THE LIBRARY</a>
                  </div>
                )}
              </>
            )}

            {/* ── BOOKS — purchases when they exist, countdown when they don't ── */}
            {section === 'books' && books === null && (
              <div className="ml-grid" aria-hidden="true">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i}>
                    <div className="ml-skel" style={{ width: '100%', aspectRatio: '2/3' }} />
                    <div className="ml-skel" style={{ height: 11, width: '80%', marginTop: 9 }} />
                    <div className="ml-skel" style={{ height: 9, width: '55%', marginTop: 5 }} />
                  </div>
                ))}
              </div>
            )}

            {section === 'books' && books !== null && books.length > 0 && (
              <div className="ml-grid">
                {books.map((b, i) => (
                  <BookCard key={b.slug} book={b} index={i} progress={progress[b.id]} />
                ))}
              </div>
            )}

            {section === 'books' && books !== null && books.length === 0 && (
              <div className="ml-soon">
                <div className="ml-soon-g" aria-hidden="true">❦</div>
                <div className="ml-soon-d">{opensLabel}</div>
                <p className="ml-soon-p">Books you buy from the Book Store live here — yours to keep, on every device you read on.</p>
                <div className="ml-soon-note">THE BOOK STORE OPENS 30 SEPTEMBER</div>
              </div>
            )}
          </>
        )}
      </div>

      <TabBar active="library" />
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </div>
  );
}
