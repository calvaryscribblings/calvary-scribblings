'use client';

// ─────────────────────────────────────────────────────────────────────────────────────────
// SEARCH IS THE ISLAND'S INDEX — the back-of-book kind, browsable before anyone types.
//
// ── WHAT THIS REPLACED, AND WHY ──────────────────────────────────────────────────────────
//
// The old screen was blank until you typed. It drew a 🔍 emoji at 3rem and ten hardcoded
// suggestion strings ('Nigeria', 'London', '1967', …) inside rounded grey-violet pills, and
// it paid 215 KB plus 13 round trips to render them. Search is a fifth of a five-tab bar;
// a tab that offers nothing until it is spoken to wastes its place there, and the island has
// 171 stories under 5 forms and 28 subjects, 10 voices and 23 books to offer before a word
// is entered.
//
// So the resting state IS an index: BY FORM with dot leaders and counts, BY SUBJECT as a
// run-on list weighted in three type steps, VOICES with their photographs, and a closing
// line offering serendipity. All of it derived — see app/lib/searchIndex.js — from the
// catalogue this page already fetches for its results, so the whole resting index costs
// NO ADDITIONAL READ and nobody maintains it as the shelf grows.
//
// ── THE DEFECT THIS ROUND FIXED, WHICH WAS NOT A DESIGN ITEM ─────────────────────────────
//
// ⚠ READER SEARCH HAD BEEN DEAD FOR EVERY NON-FOUNDER, SILENTLY, SINCE IT SHIPPED.
// The old code called get(ref(db, 'users')) on every keystroke. database.rules.json gives
// the `users` ROOT .read only to the two founder uids ($uid below it is world-readable, the
// root is not), so for everybody else that read returned PERMISSION_DENIED, hit the catch,
// and set an empty list. The screen said "searching readers…" and then showed nothing, for
// ever, and looked exactly like a search with no matches.
//
// The fix is to read the index that already existed for this: `user_search`, world-readable,
// 165 records of { displayName, username, avatarUrl }. See the VOICES/readers note below for
// why the row still resolves its identity from users/{uid} afterwards.
//
// ── AND THE GROUND IS INK, BY RULING — THE SET WAS ALREADY UNANIMOUS ─────────────────────
//
// Ikenna, on walking the app's version: "search looks so good". The web's white surface read
// as the odd one out, and the survey said it WAS the odd one out — not one of four light
// pages but the only light page in the whole spine. Rendered and sampled, the tab set paints:
//
//   Home        /public-library   #0a0a0a
//   Search      /search           #faf9f7   <- this, and only this
//   Square      /square           #0a0a0a
//   Book Store  /bookstore        #070707
//   My Library  /my-library       radial #241347 -> #0b0716 -> #080610
//   the gateway /                 the same night-violet wash
//
// So this is not one dark page joining four light ones — it is the last light page joining
// five ink ones. The ground taken is #0a0a0a, the exact value Home, The Square and
// globals.css already paint, rather than a sixth near-black of its own.
//
// ⚠ THE HEAD BAND IS UNCHANGED AND THAT IS THE POINT. It was #1a1a2e before this round and
// it is #1a1a2e after. On the white page it was a hard slab; on ink it measures 1.16:1
// against the body and separates by HUE (navy against neutral black) rather than by
// lightness, so the field keeps a plate to sit on and the page still has a top. Every colour
// inside the band was already an on-dark colour and none of them was touched.
//
// ⭑ NOTHING ELSE MOVED. No layout, no type, no copy, no weight, no spacing. The one thing
// the round found and did NOT fix is recorded here rather than adjusted: the standfirst
// (4.03:1) and the magnifier glyph (4.31:1) both fall short of AA inside the head band. Both
// were already there, both are on a ground this round did not touch, and both are a separate
// ruling about the band — not about the ground under it.
// ─────────────────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Link from 'next/link';
import Navbar from '../components/Navbar';
import TabBar from '../components/TabBar';
import { db } from '../lib/firebaseCore';
import { ref, get } from 'firebase/database';
import { resolveIdentities } from '../lib/resolveAuthorNames';
// ⚠ THE QUIZ PILL STAYS ON THIS SURFACE. R45 took the marker off the four CARD components
// and ruled explicitly that /search, /quizzes and the story page keep theirs — search is an
// entry point to the quiz, not a card. tests/quizmarker/marker.spec.mjs asserts it paints
// here ("/search lost its pill — the ruling was about cards"), so dropping it in a redesign
// is reverting a ruling, not simplifying a row.
import QuizPill from '../components/QuizPill';
import { advertisesQuiz } from '../lib/readerCollection';
import { useUserStoryTiers } from '../lib/useUserStoryTiers';
import { PRESS_SCALE, PRESS_MS, MOTION } from '../lib/houseMotion';
import { HOUSE_GOLD_ON_DARK } from '../lib/houseGold';
import {
  formRows,
  subjectRuns,
  markCollisions,
  normalizeQuery,
  matchStories,
  matchVoices,
  matchBooks,
  highlightParts,
  capGroup,
} from '../lib/searchIndex';

/* ── THE INDEX SITS ON THE INK GROUND, AND GOLD IS A TOKEN PAIR BY SURFACE ──────────────
   Ikenna's ruling: the white surface read as the odd one out. It was — of the five tabs and
   the gateway, this was the ONLY light page. Home paints #0a0a0a, Square #0a0a0a, Book Store
   #070707, My Library a violet-black gradient closing on #080610, the gateway the same wash.
   Search now paints the house ink the other two #0a0a0a surfaces paint.

   ⚠ THE TRAP, AND IT IS ARITHMETIC, NOT TASTE. HOUSE_GOLD_ON_LIGHT (#7f6726) no longer
   appears in this file and must never come back to it. That tone was DERIVED for cream — it
   is the lightest step of house gold's hue that clears AA on #f0ead8, and it clears it at
   4.51:1 with one step lighter failing at 4.47 (app/lib/houseGold.js records the walk). On
   #0a0a0a the same swatch measures 3.65:1 — it FAILS AA outright and reads as a muddy brown
   where gold is meant to be. Display gold on this ground measures 8.66:1. Every gold on this
   page is therefore HOUSE_GOLD_ON_DARK: the kickers, the dot leaders, the hairline under the
   field, both ✦, the random line, the matched word in a result, the fallback disc's ring.

   ⚠ AND THE TEXT LADDER IS THE APP'S, NOT THE LIGHT-GROUND COLOURS DIMMED. Cream #f5f0e8 is
   the reading colour and the stops below it are the opacity ladder the app's own chrome uses
   (TabBar.js carries .55 as its dim and .85 as its hover). Each stop below was picked to land
   on the ratio the light ground already carried for that role, so the page's internal
   hierarchy is ported rather than re-invented — the numbers are in the table beside each. */
const INK = '#0a0a0a';
const CREAM = '#f5f0e8';                        // 17.45:1 on ink — the reading colour
const CREAM_72 = 'rgba(245,240,232,.72)';       //  9.15:1 — was #4a463f at 8.91 on cream
const CREAM_60 = 'rgba(245,240,232,.6)';        //  6.55:1 — was #5f5a52 at 6.50
const CREAM_55 = 'rgba(245,240,232,.55)';       //  5.67:1 — was #6f6a60 at 5.11
const CREAM_40 = 'rgba(245,240,232,.4)';        //  3.46:1 — was #8d887e at 3.35
const CREAM_30 = 'rgba(245,240,232,.3)';        //  2.43:1 — was #a9a49a at 2.36
const CREAM_28 = 'rgba(245,240,232,.28)';       //  2.24:1 — was #b0aca3 at 2.15
const RULE_13 = 'rgba(245,240,232,.13)';        //  1.35:1 — was #ded9cd at 1.34
const RULE_10 = 'rgba(245,240,232,.1)';         //  1.23:1 — was #e6e2d8 at 1.23
const RULE_07 = 'rgba(245,240,232,.07)';        //  1.14:1 — was #eeebe3 at 1.13
/* The two golds that are FURNITURE rather than text. Both are display gold's own channel at
   the alpha that reproduces, to two decimals, the weight the light ground gave them — so the
   leader still stretches without competing with the name it points at, and the fallback disc
   still sits BACK from a photograph rather than ringing itself in bright metal. */
const GOLD_LEADER = 'rgba(201,168,76,.3)';      //  1.74:1 — was #c3bfb5 at 1.74 exactly
const GOLD_RING = 'rgba(201,168,76,.22)';       //  1.45:1 — was #d6d1c6 at 1.45 exactly

const CATEGORY_HREF = {
  flash: '/flash',
  short: '/short',
  poetry: '/poetry',
  news: '/news',
  inspiring: '/inspiring',
  novel: '/book-reader',
};

// ── THE GLYPHS ARE SVG OR THEY ARE TYPOGRAPHIC MARKS. NO EMOJI. ─────────────────────────
// House rule since R39. The 🔍 and 📭 this screen used to carry are gone. ✦ and ❦ stay —
// they are letterforms set in Cormorant, not pictures, and they set in the reading colour.
const Glass = ({ size = 17 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1" strokeLinecap="round" aria-hidden="true">
    <circle cx="10.5" cy="10.5" r="6.5" />
    <line x1="15.4" y1="15.4" x2="20.5" y2="20.5" />
  </svg>
);

/**
 * ⚠ THE FALLBACK DISC IS DESIGNED, NOT DEFAULTED.
 *
 * Four of the ten voices have not uploaded a reader avatar. The old disc was a violet
 * circle on a violet wash, which in a row of photographs announces itself — three portraits
 * and one bright violet badge reads as an error, not a variation, and it singles out the
 * people who happen not to have uploaded a picture yet.
 *
 * So the disc gets QUIETER than the photograph, not louder: no violet, no fill, a hairline
 * ring and the initials in the reading colour. A missing portrait sits back.
 *
 * ⭑ NOBODY IS HIDDEN FROM THE INDEX FOR NOT HAVING A PHOTOGRAPH. The row renders all ten.
 */
function Portrait({ url, name, size = 40 }) {
  const initials = String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  if (url) {
    return <img className="ix-portrait" src={url} alt="" loading="lazy" decoding="async"
                width={size} height={size} />;
  }
  return <span className="ix-portrait ix-portrait-none" aria-hidden="true">{initials || '·'}</span>;
}

/**
 * A result's cover board. One component for stories and for books because the markup was
 * identical in both places — the same 46×62 board, the same lazy decode, the same wrapper the
 * quiz pill positions against.
 */
function Cover({ src, children }) {
  if (!src) return null;
  return (
    <span className="ix-cover-wrap">
      <img className="ix-cover" src={src} alt="" loading="lazy" decoding="async" />
      {children}
    </span>
  );
}

/**
 * The line a capped group ends on. The kicker above it already printed the TRUE total, so
 * this says what is not on screen rather than pretending the group is complete.
 */
function More({ n }) {
  if (!n) return null;
  return (
    <div className="ix-more">
      <span className="cs-onum">{n}</span> more — narrow the word
    </div>
  );
}

/**
 * A section head: the Cinzel kicker and, at the far edge, how many sit under it.
 *
 * ⚠ MODULE SCOPE, NOT INSIDE THE PAGE. Declared in the component body it is a NEW component
 * type on every render, so React unmounts and remounts every section head — and its whole
 * subtree — whenever a keystroke changes state. react-hooks/static-components catches it.
 */
function Kicker({ children, count }) {
  return (
    <div className="ix-kicker">
      <span>{children}</span>
      {count != null && <span className="ix-kicker-n cs-onum">{count}</span>}
    </div>
  );
}

/** The matched word picked out in gold — in the title and in the line. */
function Marked({ text, query }) {
  const parts = highlightParts(text, query);
  return (
    <>
      {parts.map((p, i) => (p.hit ? <b key={i} className="ix-hit">{p.text}</b> : <span key={i}>{p.text}</span>))}
    </>
  );
}

export default function SearchPage() {
  const userTiers = useUserStoryTiers();
  const [query, setQuery] = useState('');
  const [stories, setStories] = useState([]);
  const [voices, setVoices] = useState([]);
  const [readerHits, setReaderHits] = useState({ q: '', rows: [] });
  const [books, setBooks] = useState([]);
  const [identities, setIdentities] = useState({});
  const booksAsked = useRef(false);

  // ── AT REST: the catalogue and the roster. Nothing else. ───────────────────────────────
  //
  // cms_stories_index is the read the results need anyway, and the whole resting index is
  // computed from it — so BY FORM, BY SUBJECT and every count on the screen are free.
  // bookstore_titles (72 KB) is NOT fetched here: books only ever appear in results, so it
  // loads on the first query and is kept. That is the difference between an index that is
  // browsable and one that is expensive.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [sSnap, vSnap] = await Promise.all([
          get(ref(db, 'cms_stories_index')),
          get(ref(db, 'cms_voices')),
        ]);
        if (!live) return;

        const now = Date.now();
        const rows = sSnap.exists()
          ? Object.entries(sSnap.val() || {})
              .map(([id, s]) => ({ ...s, id }))
              .filter((s) => s.published !== false && (!s.publishAt || new Date(s.publishAt).getTime() <= now))
          : [];
        setStories(rows);

        const roster = vSnap.exists()
          ? Object.entries(vSnap.val() || {})
              .map(([slug, v]) => ({ ...v, slug }))
              .filter((v) => v.published === true)
              .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
          : [];
        setVoices(roster);

        // ⚠ ONE RESOLUTION PASS FOR THE WHOLE SCREEN, over the UNION of the uids the story
        // rows and the Voices block need. 9 of the 10 voices are also index authors, so the
        // union of 13 author uids and 10 voice uids is 14 reads, not 23 — and never one per
        // row, which would be 181.
        //
        // ⚠ THE VOICE'S UID FIELD IS `matchUid`, NOT `authorUid`. authorUid is absent on all
        // ten roster records; reading it yields ten unresolved rows and ten fallback discs,
        // which looks like "nobody has uploaded a photograph" rather than a bug.
        const uids = [
          ...rows.map((s) => s.authorUid),
          ...roster.map((v) => v.matchUid),
        ];
        const map = await resolveIdentities(uids);
        if (live) setIdentities(map);
      } catch (e) {
        /* a failed read leaves an empty index — the field still works, nothing throws */
      }
    })();
    return () => { live = false; };
  }, []);

  // Seed from ?q= so a link into a search lands on its results.
  // Seed from ?q= so a link into a search lands on its results.
  //
  // ⚠ THIS MUST BE AN EFFECT, AND THE LINT RULE IS WRONG ABOUT THIS PAGE. Reading the query
  // string in useState's lazy initialiser is the tidier-looking version and it was tried:
  // next.config.mjs sets output:'export', so this page is PRERENDERED AT BUILD TIME with an
  // empty query, and an initialiser that reads window.location makes the client's first render
  // disagree with that HTML. Measured, not assumed — /search?q=1967 threw React error #418
  // (hydration failed) on every load, and React recovered by throwing the server HTML away and
  // re-rendering the whole tree, which is strictly more work than the extra pass the rule is
  // trying to save. An effect runs after hydration, so the two agree.
  //
  // The two-pass paint this costs is real but small: the resting index is already the correct
  // thing to show while the catalogue is still loading, and the results cannot render before
  // it arrives anyway.
  useEffect(() => {
    const seed = new URLSearchParams(window.location.search).get('q');
    // eslint-disable-next-line react-hooks/set-state-in-effect -- prerendered page; see above
    if (seed) setQuery(seed);
  }, []);

  const q = normalizeQuery(query);
  const searching = q.length > 0;

  // ── READERS: MATCH ON THE INDEX, RENDER FROM THE RECORD ────────────────────────────────
  //
  // user_search is the only node that can be scanned for a name — the users root is
  // admin-only and always will be, because it holds email and date of birth. But
  // user_search is itself A STORED COPY, and stored copies on this platform go stale: the
  // Square audit measured 113 of 118 stale, and this very node currently calls Stanley
  // Princewill McDaniels "Stanley P. Balogun".
  //
  // ⭑ So the index is used to FIND, and users/{uid} to SHOW. Matching runs against the copy
  // (it is the only thing searchable); every rendered name and avatar is then resolved live
  // from the record the reader controls, once per distinct uid, for the handful of matched
  // rows only. A stale copy can therefore surface a stale name in a query, but can never
  // print one.
  //
  // ⚠ THE QUERY IS STORED BESIDE THE ROWS. Two reasons, and the second is the real one.
  // Clearing the list with a synchronous setState at the top of the effect costs an extra
  // render pass on every keystroke (react-hooks/set-state-in-effect); and holding the rows
  // without the query they answer means the previous query's readers stay on screen while the
  // next read is in flight. Comparing `readerHits.q === q` at render solves both — a result
  // set is only ever shown for the query it was fetched for.
  useEffect(() => {
    if (!searching) return;
    let live = true;
    (async () => {
      let matched = [];
      try {
        const snap = await get(ref(db, 'user_search'));
        if (snap.exists()) {
          matched = Object.entries(snap.val() || {})
            .map(([uid, v]) => ({ uid, ...v }))
            .filter((u) =>
              String(u.displayName || '').toLowerCase().includes(q) ||
              String(u.username || '').toLowerCase().includes(q)
            );
        }
      } catch (e) {
        /* a failed read shows no readers, never a stale set */
      }
      if (!live) return;
      setReaderHits({ q, rows: matched });
      if (matched.length) {
        const map = await resolveIdentities(matched.map((u) => u.uid));
        if (live) setIdentities((prev) => ({ ...prev, ...map }));
      }
    })();
    return () => { live = false; };
  }, [q, searching]);

  const readers = searching && readerHits.q === q ? readerHits.rows : [];

  // Books load once, on the first query, and are kept for the rest of the session.
  useEffect(() => {
    if (!searching || booksAsked.current) return;
    booksAsked.current = true;
    (async () => {
      try {
        const snap = await get(ref(db, 'bookstore_titles'));
        if (snap.exists()) {
          setBooks(
            Object.entries(snap.val() || {})
              .map(([slug, b]) => ({ ...b, slug }))
              .filter((b) => b.status !== 'draft' && b.published !== false)
          );
        }
      } catch (e) { /* books simply do not appear in results */ }
    })();
  }, [searching]);

  // ⚠ IDENTITY AT RENDER. Never the frozen copy when a uid resolves.
  const nameFor = useCallback(
    (uid, stored) => (uid && identities[uid]?.displayName) || stored || '',
    [identities]
  );
  const avatarFor = useCallback((uid) => (uid && identities[uid]?.avatarUrl) || '', [identities]);

  const forms = useMemo(() => formRows(stories), [stories]);
  const subjects = useMemo(() => markCollisions(subjectRuns(stories)), [stories]);

  // Story author names resolve live BEFORE matching, so searching an author's CURRENT name
  // finds their work and a name they have changed no longer does.
  const corpus = useMemo(
    () => stories.map((s) => ({ ...s, author: nameFor(s.authorUid, s.author) })),
    [stories, nameFor]
  );

  const storyHits = useMemo(() => matchStories(corpus, q), [corpus, q]);
  const voiceHits = useMemo(
    () => matchVoices(voices.map((v) => ({ ...v, displayName: nameFor(v.matchUid, v.displayName) })), q),
    [voices, q, nameFor]
  );
  const bookHits = useMemo(() => matchBooks(books, q), [books, q]);
  const total = storyHits.length + voiceHits.length + readers.length + bookHits.length;

  // ⚠ iOS Safari does not apply :active to arbitrary elements unless a touch listener exists
  // on the element or an ancestor. One passive no-op on document is the documented fix and
  // is cheaper than a handler per row. It is deliberately NOT a React state toggle: the app
  // repo's V1 round measured press-in → setState → re-render → effect → spring, and that
  // round trip is exactly what makes a press feel late. :active is the browser's own
  // down-handler and it releases on scroll, so a press that becomes a scroll does not stick.
  useEffect(() => {
    const noop = () => {};
    document.addEventListener('touchstart', noop, { passive: true });
    return () => document.removeEventListener('touchstart', noop);
  }, []);

  const goRandom = () => {
    if (!stories.length) return;
    const s = stories[Math.floor(Math.random() * stories.length)];
    window.location.href = s.url || `/stories/${s.id}`;
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&family=Cinzel:wght@400;500&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: ${INK}; font-family: 'Cormorant Garamond', Georgia, serif; }

        /* OLDSTYLE FIGURES. Lining numerals stand at cap height and shout beside lowercase
           text; oldstyle have ascenders and descenders and sit IN the line, which is how an
           index sets a number. One property, and most of the difference between typeset and
           merely styled. Both spellings are present because engines disagree on the token,
           and the low-level feature backs up the high-level property. */
        .cs-onum { font-variant-numeric: oldstyle-nums; -moz-font-feature-settings: 'onum' 1;
                   -webkit-font-feature-settings: 'onum' 1; font-feature-settings: 'onum' 1; }

        .ix { min-height: 100vh; background: ${INK}; color: ${CREAM}; }

        /* ── THE FIELD IS A RULE, NOT A PILL ───────────────────────────────────────────── */
        .ix-head { background: #1a1a2e; padding: 6.5rem 1.5rem 3rem; }
        .ix-head-in { max-width: 640px; margin: 0 auto; }
        .ix-eyebrow { font-family: 'Cinzel', serif; font-size: 0.56rem; letter-spacing: 0.3em;
                      text-transform: uppercase; color: ${HOUSE_GOLD_ON_DARK}; opacity: 0.75; }
        .ix-title { font-size: clamp(2.2rem, 8vw, 3.4rem); font-weight: 300; color: #fff;
                    line-height: 1.05; margin: 0.7rem 0 0.35rem; letter-spacing: -0.01em; }
        .ix-title em { font-style: italic; color: #c4b5fd; }
        .ix-sub { font-size: 1rem; color: rgba(255,255,255,0.42); font-style: italic; }

        /* A gold hairline, a hairline glyph, the query in Cormorant at reading size, and the
           house caret. No box, no radius, no fill — the rule IS the field. */
        .ix-rule { display: flex; align-items: center; gap: 0.7rem; margin-top: 2rem;
                   border-bottom: 1px solid ${HOUSE_GOLD_ON_DARK}; padding-bottom: 0.55rem;
                   transition: border-color ${MOTION.hair}ms ease; }
        .ix-rule:focus-within { border-bottom-color: #e8d49a; }
        .ix-rule-glyph { color: ${HOUSE_GOLD_ON_DARK}; opacity: 0.7; flex: 0 0 auto;
                         display: flex; align-items: center; }
        .ix-input { flex: 1 1 auto; min-width: 0; background: none; border: none; outline: none;
                    font-family: 'Cormorant Garamond', Georgia, serif; font-size: 1.25rem;
                    color: #fff; caret-color: ${HOUSE_GOLD_ON_DARK}; padding: 0.1rem 0; }
        .ix-input::placeholder { color: rgba(255,255,255,0.3); font-style: italic; }
        .ix-clear { flex: 0 0 auto; background: none; border: none; cursor: pointer;
                    font-family: 'Cormorant Garamond', Georgia, serif; font-size: 1.5rem;
                    line-height: 1; color: rgba(255,255,255,0.35); padding: 0 0.3rem;
                    min-width: 48px; min-height: 48px; }

        .ix-body { max-width: 640px; margin: 0 auto; padding: 2.6rem 1.5rem 6rem; }

        .ix-kicker { display: flex; align-items: baseline; justify-content: space-between;
                     gap: 1rem; font-family: 'Cinzel', serif; font-size: 0.6rem;
                     letter-spacing: 0.28em; text-transform: uppercase;
                     color: ${HOUSE_GOLD_ON_DARK}; margin: 2.6rem 0 1rem; }
        .ix-kicker:first-child { margin-top: 0; }
        .ix-kicker-n { color: ${CREAM_28}; letter-spacing: 0.1em; }

        /* ── BY FORM: DOT LEADERS ───────────────────────────────────────────────────────
           The leaders are what make this read as an index rather than a menu — they do most
           of the work on this block. A dotted bottom border on a flexible middle element is
           the whole technique: it stretches to whatever space the name and the count leave,
           so it stays honest at every width without a measurement. */
        .ix-form { display: block; text-decoration: none; color: inherit;
                   display: flex; align-items: baseline; gap: 0; padding: 0.62rem 0;
                   min-height: 48px; }
        .ix-form-name { flex: 0 0 auto; font-size: 1.16rem; color: ${CREAM}; }
        .ix-lead { flex: 1 1 auto; border-bottom: 1px dotted ${GOLD_LEADER}; margin: 0 0.55rem;
                   transform: translateY(-0.28em); min-width: 1.5rem; }
        .ix-form-n { flex: 0 0 auto; font-size: 1.05rem; color: ${CREAM_55}; }

        /* ── BY SUBJECT: THE RUN-ON LIST ────────────────────────────────────────────────
           ⚠ EACH SUBJECT IS ONE UNBREAKABLE FLEX ITEM AND THE BREAKS FALL BETWEEN THEM.
           This is the whole reason the block is a flex row with gaps rather than a joined
           string: a run built by concatenating names gives the browser no break opportunity
           except INSIDE a name, so a narrow column clips "Mystery" off the edge and splits
           "Slice of / Life". Five of the 28 live subjects are multi-word — Slice of Life,
           Personal Essay, Loss & Recovery, Spoken Word, Op-Ed — and every one of them is a
           trap for the joined version. white-space: nowrap on the item is the guarantee;
           the gap is the separator; there is no delimiter character to leak. */
        /* ── THE BOX AND THE EFFECTIVE TARGET ARE DIFFERENT NUMBERS HERE, ON PURPOSE ──
           A subject's visual box is 34.41px at the smallest weight step. Giving it a
           min-height of 48 would triple the leading of the smallest type and the run would
           stop reading as a paragraph of subjects — the density IS the design.
           So the box stays, and the TARGET is extended past it by a transparent ::after that
           takes no part in layout.

           ⚠ AND THE AXIS THAT FAILS IS THE ONE NOBODY LOOKS AT. A first version extended
           only the height, to a clean 48. Every row passed — and the browser suite caught
           'Love' at 37.8px WIDE against the same floor, with 'Grief' at 40.8 and 'Sport' at
           43.8 beside it. A short subject is a small target sideways however tall it is, and
           no screenshot shows that. The Open Pages round found the identical defect at
           47.91pt on the axis it was not measuring; both numbers are now reported and
           asserted separately.

           The extension is HALF THE GAP on every side, which is the largest it can be
           without overlapping a neighbour: adjacent targets meet exactly at the midpoint of
           the gap, so there is no dead strip between them and no strip belonging to two rows
           at once. With a 34.41px box, a 14px row gap and a 15.2px column gap that gives a
           48.41 × (box + 15.2) target — 53.0px wide at the narrowest subject on the shelf.
           ⚠ A finger landing in an overlap hits whichever element paints last, which is a
           mis-tap nobody can see in a screenshot; the suite asserts non-overlap directly. If
           the type sizes, the padding or the gaps change, both numbers move — re-measure. */
        .ix-subjects { display: flex; flex-wrap: wrap; align-items: baseline;
                       gap: 0.875rem 0.95rem; }
        .ix-subj { white-space: nowrap; text-decoration: none; color: ${CREAM};
                   display: inline-flex; align-items: baseline; gap: 0.3rem;
                   padding: 0.34rem 0; position: relative; }
        .ix-subj::after { content: ''; position: absolute; inset: -0.4375rem -0.475rem; }
        .ix-subj-1 { font-size: 1.62rem; font-weight: 500; }
        .ix-subj-2 { font-size: 1.22rem; font-weight: 400; }
        .ix-subj-3 { font-size: 0.98rem; font-weight: 400; color: ${CREAM_72}; }
        .ix-subj-n { font-size: 0.72em; color: ${CREAM_30}; }
        /* The lightest thing that separates two near-identical labels: the form, on the
           collided pair only. 'Political · poetry' beside 'Politics · news' reads as two
           subjects rather than one typo. */
        .ix-subj-cat { font-family: 'Cinzel', serif; font-size: 0.5em; letter-spacing: 0.14em;
                       text-transform: uppercase; color: ${CREAM_30}; }

        /* ── VOICES ─────────────────────────────────────────────────────────────────────── */
        .ix-voice { display: flex; align-items: center; gap: 0.85rem; padding: 0.6rem 0;
                    text-decoration: none; color: inherit; min-height: 48px; }
        .ix-portrait { width: 40px; height: 40px; border-radius: 50%; flex: 0 0 auto;
                       object-fit: cover; display: flex; align-items: center;
                       justify-content: center; }
        /* Quieter than a photograph, never louder: no violet, no fill, a hairline and the
           initials. A missing portrait sits back instead of announcing itself. */
        .ix-portrait-none { border: 1px solid ${GOLD_RING}; background: none; color: ${CREAM_40};
                            font-size: 0.78rem; letter-spacing: 0.06em; }
        /* ⚠ ALL THREE ARE BLOCKS, and the reason is worth keeping. These are <span>s — the row
           is an <a>, so it may not contain <div>s — and a span defaults to inline. While no
           voice had a register the block held one child and nothing looked wrong; the moment
           the ten approved lines landed, every row read "Tricia AjaxReal lives and invented
           ones…", the name and the line run together with no break between them. No source
           check could have caught it and no earlier render could either, because the defect
           needed real copy in the field to appear at all. */
        .ix-voice-b { min-width: 0; flex: 1 1 auto; display: block; }
        .ix-voice-n { font-size: 1.1rem; color: ${CREAM}; line-height: 1.25; display: block; }
        /* ⭑ A VOICE WITH NO REGISTER SHOWS THE NAME ALONE, and it must look deliberate.
           There is no fallback line: the bio's opening clause ("X is a writer and
           storyteller who…") is a paragraph's first words, not a line, and reads worse than
           nothing; genreTag is a form list and is empty on four of the ten anyway. So the
           name simply centres in the row and the row is shorter. */
        .ix-voice-r { font-size: 0.93rem; color: ${CREAM_55}; font-style: italic; line-height: 1.35;
                      margin-top: 0.1rem; display: block; }

        .ix-close { margin-top: 3rem; padding-top: 1.4rem; border-top: 1px solid ${RULE_10}; }
        .ix-random { background: none; border: none; cursor: pointer; padding: 0.6rem 0;
                     min-height: 48px; font-family: 'Cormorant Garamond', Georgia, serif;
                     font-size: 1.05rem; font-style: italic; color: ${HOUSE_GOLD_ON_DARK};
                     display: inline-flex; align-items: center; gap: 0.5rem; }
        .ix-mark { font-style: normal; }

        /* ── RESULTS ────────────────────────────────────────────────────────────────────── */
        .ix-res { display: flex; gap: 0.95rem; align-items: flex-start; padding: 0.85rem 0;
                  text-decoration: none; color: inherit; border-bottom: 1px solid ${RULE_07};
                  min-height: 48px; }
        .ix-cover-wrap { position: relative; flex: 0 0 auto; display: block;
                         width: 46px; height: 62px; }
        .ix-cover { width: 46px; min-width: 46px; height: 62px; object-fit: cover;
                    background: ${RULE_07}; flex: 0 0 auto; display: block; }
        .ix-res-b { min-width: 0; flex: 1 1 auto; }
        .ix-res-t { font-size: 1.12rem; font-weight: 500; color: ${CREAM}; line-height: 1.3; }
        /* ⭑ THE REAL OPENING LINE, in a fixed two-line box. When prose search lands, a
           matched SENTENCE takes this line's place — same field, same budget, same box — so
           the result layout does not change when the source of the line does. */
        .ix-res-o { font-size: 0.95rem; color: ${CREAM_60}; line-height: 1.4; margin-top: 0.22rem;
                    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
                    overflow: hidden; }
        .ix-res-m { font-family: 'Cinzel', serif; font-size: 0.52rem; letter-spacing: 0.16em;
                    text-transform: uppercase; color: ${CREAM_30}; margin-top: 0.35rem; }
        .ix-hit { color: ${HOUSE_GOLD_ON_DARK}; font-weight: 600; background: none; }

        .ix-more { font-size: 0.92rem; color: ${CREAM_40}; font-style: italic; padding: 0.9rem 0 0.2rem; }
        .ix-empty { padding: 3.4rem 0 1rem; }
        .ix-empty-mark { font-size: 1.5rem; color: ${HOUSE_GOLD_ON_DARK}; }
        .ix-empty-rule { border: 0; border-top: 1px solid ${RULE_13}; margin: 1rem 0 1.2rem;
                         max-width: 4rem; }
        .ix-empty-h { font-size: 1.35rem; color: ${CREAM}; font-weight: 400; }
        .ix-empty-p { font-size: 1rem; color: ${CREAM_55}; margin-top: 0.5rem; line-height: 1.5;
                      font-style: italic; }
        .ix-empty-p a { color: ${HOUSE_GOLD_ON_DARK}; text-underline-offset: 3px; }

        /* ── THE PRESS: ONE TOKEN, ON THE BROWSER'S OWN DOWN-HANDLER ──────────────────── */
        .ix-press { -webkit-tap-highlight-color: transparent; }
        .ix-press:active { transform: scale(${PRESS_SCALE});
                           transition: transform ${PRESS_MS}ms ease; }

        /* Results arrive on the ladder's base rung and nowhere else. */
        @keyframes ixIn { from { opacity: 0; transform: translateY(4px); }
                          to { opacity: 1; transform: none; } }
        .ix-anim { animation: ixIn ${MOTION.base}ms ease both; }

        /* ⚠ REDUCED MOTION IS A DIFFERENT PATH BORN AT THE FINAL VALUE — not the same path
           run fast. The rows do not travel at all; they are simply there.
           ⚠ AND THE PRESS SURVIVES IT. A control that stops answering the finger is broken,
           not calm, so .ix-press:active is deliberately absent from this block. */
        @media (prefers-reduced-motion: reduce) {
          .ix-anim { animation: none; opacity: 1; transform: none; }
          .ix-rule { transition: none; }
        }

        @media (min-width: 720px) {
          .ix-head { padding: 7rem 2rem 3.4rem; }
          .ix-body { padding: 3rem 2rem 6rem; }
        }
      `}</style>

      <Navbar />

      <div className="ix">
        <header className="ix-head">
          <div className="ix-head-in">
            <div className="ix-eyebrow">Calvary Scribblings</div>
            <h1 className="ix-title">The <em>Index</em></h1>
            <p className="ix-sub">Everything on the island, and a way in.</p>
            <div className="ix-rule">
              <span className="ix-rule-glyph"><Glass /></span>
              <input
                className="ix-input"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="a word, a name, a subject"
                autoComplete="off"
                spellCheck="false"
                aria-label="Search the island"
              />
              {query && (
                <button className="ix-clear ix-press" onClick={() => setQuery('')} aria-label="Clear">×</button>
              )}
            </div>
          </div>
        </header>

        <main className="ix-body">
          {!searching ? (
            <>
              <Kicker count={stories.length}>By form</Kicker>
              {forms.map((f) => (
                <a key={f.value} className="ix-form ix-press" href={CATEGORY_HREF[f.value] || '/public-library'}>
                  <span className="ix-form-name">{f.label}</span>
                  <span className="ix-lead" aria-hidden="true" />
                  <span className="ix-form-n cs-onum">{f.count}</span>
                </a>
              ))}

              <Kicker count={subjects.length}>By subject</Kicker>
              <div className="ix-subjects">
                {subjects.map((s) => (
                  <a
                    key={s.label}
                    className={`ix-subj ix-subj-${s.step} ix-press`}
                    href={`/search?q=${encodeURIComponent(s.label)}`}
                    onClick={(e) => { e.preventDefault(); setQuery(s.label); }}
                  >
                    <span>{s.label}</span>
                    {s.collides && s.categories.length === 1 && (
                      <span className="ix-subj-cat">{s.categories[0]}</span>
                    )}
                    <span className="ix-subj-n cs-onum">{s.count}</span>
                  </a>
                ))}
              </div>

              {voices.length > 0 && (
                <>
                  <Kicker count={voices.length}>Voices</Kicker>
                  {voices.map((v) => (
                    <a key={v.slug} className="ix-voice ix-press" href={`/voices/${v.slug}`}>
                      <Portrait url={avatarFor(v.matchUid)} name={nameFor(v.matchUid, v.displayName)} />
                      <span className="ix-voice-b">
                        <span className="ix-voice-n">{nameFor(v.matchUid, v.displayName)}</span>
                        {v.register ? <span className="ix-voice-r">{v.register}</span> : null}
                      </span>
                    </a>
                  ))}
                </>
              )}

              <div className="ix-close">
                <button className="ix-random ix-press" onClick={goRandom}>
                  <span className="ix-mark">✦</span> or read something at random
                </button>
              </div>
            </>
          ) : total === 0 ? (
            <div className="ix-empty">
              {/* ⭑ HONEST, NOT APOLOGETIC. No "try a different keyword" — the island's size
                  is the actual reason, and the last clause points at the one thing a failed
                  search can become. */}
              <div className="ix-empty-mark">✦</div>
              <hr className="ix-empty-rule" />
              <div className="ix-empty-h">Nothing under that word</div>
              <p className="ix-empty-p">
                The island is small enough that this happens. Try the index — or{' '}
                <Link href="/open-pages/new">write the thing you were looking for</Link>.
              </p>
            </div>
          ) : (
            <>
              {storyHits.length > 0 && (
                <>
                  <Kicker count={storyHits.length}>Stories</Kicker>
                  {capGroup(storyHits).shown.map((s) => (
                    <a key={s.id} className="ix-res ix-press ix-anim" href={s.url || `/stories/${s.id}`}>
                      <Cover src={s.coverSizes?.w360 || s.cover}>
                        <QuizPill
                          hasQuiz={advertisesQuiz(s)}
                          userTier={userTiers[s.id]?.tier ?? null}
                          scribblesReward={(s.quiz || s.quizMeta)?.scribblesReward || 50}
                          scorePct={userTiers[s.id]?.scorePct}
                        />
                      </Cover>
                      <span className="ix-res-b">
                        <span className="ix-res-t"><Marked text={s.title} query={query} /></span>
                        {s.opening && (
                          <span className="ix-res-o"><Marked text={s.opening} query={query} /></span>
                        )}
                        {/* ⭑ THE WHOLE META LINE IS MARKED, not just the author.
                            A query matches five fields, and three of them live here. When
                            "drama" matched 42 stories on their SUBCATEGORY, nothing on the
                            row was picked out — the gold looked broken when it was merely
                            pointing at a field that had not been marked, and the reader was
                            left to guess why a story had come back. Mark every field the
                            predicate can match, or the highlight tells only part of the
                            truth. */}
                        <span className="ix-res-m">
                          <Marked text={s.author} query={query} />
                          {' · '}<Marked text={s.categoryName} query={query} />
                          {s.subcategory ? <>{' · '}<Marked text={s.subcategory} query={query} /></> : null}
                          {s.date ? <>{' · '}<Marked text={s.date} query={query} /></> : null}
                        </span>
                      </span>
                    </a>
                  ))}
                  <More n={capGroup(storyHits).hidden} />
                </>
              )}

              {voiceHits.length > 0 && (
                <>
                  <Kicker count={voiceHits.length}>Voices</Kicker>
                  {capGroup(voiceHits).shown.map((v) => (
                    <a key={v.slug} className="ix-voice ix-press ix-anim" href={`/voices/${v.slug}`}>
                      <Portrait url={avatarFor(v.matchUid)} name={v.displayName} />
                      <span className="ix-voice-b">
                        <span className="ix-voice-n"><Marked text={v.displayName} query={query} /></span>
                        {v.register ? <span className="ix-voice-r">{v.register}</span> : null}
                      </span>
                    </a>
                  ))}
                </>
              )}

              {readers.length > 0 && (
                <>
                  <Kicker count={readers.length}>Readers</Kicker>
                  {capGroup(readers).shown.map((u) => (
                    <a key={u.uid} className="ix-voice ix-press ix-anim" href={`/user?id=${u.uid}`}>
                      <Portrait url={avatarFor(u.uid)} name={nameFor(u.uid, u.displayName)} />
                      <span className="ix-voice-b">
                        <span className="ix-voice-n">
                          <Marked text={nameFor(u.uid, u.displayName)} query={query} />
                        </span>
                        {u.username && <span className="ix-voice-r">@{u.username}</span>}
                      </span>
                    </a>
                  ))}
                  <More n={capGroup(readers).hidden} />
                </>
              )}

              {bookHits.length > 0 && (
                <>
                  <Kicker count={bookHits.length}>Books</Kicker>
                  {capGroup(bookHits).shown.map((b) => (
                    <a key={b.slug} className="ix-res ix-press ix-anim" href={`/bookstore/${b.slug}`}>
                      <Cover src={b.coverSizes?.w360 || b.coverUrl} />
                      <span className="ix-res-b">
                        <span className="ix-res-t"><Marked text={b.title} query={query} /></span>
                        {b.openingLine && (
                          <span className="ix-res-o"><Marked text={b.openingLine} query={query} /></span>
                        )}
                        <span className="ix-res-m">
                          <Marked text={b.authorName || b.author || ''} query={query} />
                        </span>
                      </span>
                    </a>
                  ))}
                </>
              )}
            </>
          )}
        </main>
      </div>
      <TabBar />
    </>
  );
}
