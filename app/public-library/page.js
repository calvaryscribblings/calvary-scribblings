'use client';
import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useAuth } from '../lib/AuthContext';
import AuthModal from '../components/AuthModal';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import TabBar from '../components/TabBar';
import QuizPill from '../components/QuizPill';
import { advertisesQuiz } from '../lib/readerCollection';
import { useUserStoryTiers } from '../lib/useUserStoryTiers';
import { db } from '../lib/firebaseCore';
import CoverImage from '../components/CoverImage';
// R42 — the row shares the feed's opening rule. Two copies of "what is the opening" is
// how the two surfaces start disagreeing; a character substring is measurably wrong.
import { openingOf, readingTime } from '../lib/openPagesOpening';
import { ref, get, onValue } from 'firebase/database';
import { resolveAuthorNames, withCurrentAuthorNames } from '../lib/resolveAuthorNames';
import { normalizeGenre } from '../lib/openPages';
// The Series row's chrome follows the tier flag, so the homepage and the endpoint cannot
// disagree about whether the section is behind a wall. The loader itself is imported lazily
// inside SeriesRow — it pulls in the Firebase database SDK, and the six category rows above
// must not wait on a chunk they never use.
import { SERIES_TIER_GATE_ENABLED } from '../lib/series/access';
import { shelfLine } from '../lib/series/format';
import { useArrivalReady } from '../components/ArrivalVeil';
import {
  SUMMER_2026, prizePool, programStatusLabel, programBoardCta,
  PROGRAM_DETAILS_HREF, SHOW_SUMMER_2026_BUTTON,
} from '../lib/leaderboards';
import { useContestPhase } from '../lib/useContestPhase';
// R32 — the reader's line on the trailer card. Everything about it that is not pixels
// (which comments may be promoted, how one is abridged, which one a rotation shows, how the
// identity resolves) lives in the lib; this file draws it.
import {
  promotableVoices,
  shouldTrailer,
  pickVoice,
  abridgeToFit,
  resolveVoiceIdentity,
  SCREENING_NODE,
} from '../lib/trailerVoices';
import { getBadge, BadgeIcon } from '../components/conversation/ConversationKit';
import { measureQuotePin } from '../lib/pinQuoteStage';

// ── Typography system ───────────────────────────────────────────────────────
// DISPLAY for headings/titles, LABEL for kickers/badges/controls, BODY for meta.
const DISPLAY = "'Cormorant Garamond', Georgia, serif";
const LABEL = "'Cinzel', 'Cormorant Garamond', Georgia, serif";
const BODY = "Cormorant Garamond, Georgia, serif";

// ── Unified section-header styles (used by every content row) ────────────────
const kickerStyle = { fontFamily: LABEL, fontSize: '0.6rem', letterSpacing: '0.3em', textTransform: 'uppercase', color: '#c9a84c', marginBottom: 6, display: 'block' };
const sectionTitleStyle = { fontFamily: DISPLAY, fontSize: '1.6rem', fontWeight: 600, color: '#f5f0e8', lineHeight: 1, margin: '4px 0 0' };
const seeAllStyle = { fontFamily: LABEL, fontSize: '0.7rem', letterSpacing: '0.05em', textTransform: 'uppercase', color: '#c9a84c', textDecoration: 'none', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' };

// Shared card accents — app visual language: gold NEW badge, purple-tinted cover frame.
const newBadgeStyle = { position: 'absolute', background: '#c9a84c', color: '#080610', fontFamily: LABEL, fontSize: '0.5rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '2px 6px', borderRadius: 4 };
const cardAuthorStyle = { fontFamily: BODY, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(245,240,232,0.7)' };

// Right-pointing chevron used on every "See all" / "View all" link.
const seeAllChevron = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle', marginLeft: 4 }}><polyline points="9 18 15 12 9 6"/></svg>
);

// Stories source of truth: cms_stories/ in Firebase RTDB. This list reads the
// SLIM cms_stories_index/ read-model (Phase A) — the ~85 KB projection of the
// published set — not the 1.2 MB full node; the reader page fetches the full
// single record. This component fetches on mount via the useEffect below.
// The hardcoded `stories` array below is intentionally empty —
// it was migrated to CMS as of 2026-05-18. Do not reintroduce.

const stories = [
  // Hardcoded stories array has been migrated to cms_stories/ in RTDB.
  // The CMS fetch useEffect below populates allStories on mount.
  // Intentionally empty: do NOT reintroduce hardcoded entries here.
];

function parseDate(str) {
  const d = new Date(str);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

function getStorySortTime(story) {
  if (story.publishAt) {
    const t = new Date(story.publishAt).getTime();
    if (!isNaN(t)) return t;
  }
  return parseDate(story.date);
}
function isNew(s) { return (Date.now() - parseDate(s.date)) / 86400000 <= 7; }

function getLondonHour() {
  const now = new Date();
  return parseInt(now.toLocaleString('en-GB', { timeZone: 'Europe/London', hour: 'numeric', hour12: false }), 10);
}

function isSquareOpen() {
  const h = getLondonHour();
  return h >= 20 && h < 24;
}

function getCountdown() {
  const now = new Date();
  const londonStr = now.toLocaleString('en-GB', { timeZone: 'Europe/London', hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false });
  const parts = londonStr.split(':');
  const h = parseInt(parts[0], 10), m = parseInt(parts[1], 10), s = parseInt(parts[2], 10);
  if (isNaN(h) || isNaN(m) || isNaN(s)) return '--:--:--';
  let secs;
  if (h >= 20) {
    secs = (24 - h - 1) * 3600 + (59 - m) * 60 + (60 - s);
  } else {
    secs = (20 - h - 1) * 3600 + (59 - m) * 60 + (60 - s);
  }
  const hh = Math.floor(secs / 3600), mm = Math.floor((secs % 3600) / 60), ss = secs % 60;
  return String(hh).padStart(2,'0') + ':' + String(mm).padStart(2,'0') + ':' + String(ss).padStart(2,'0');
}

const badgeStyle = {
  news: { background: 'rgba(220,38,38,0.2)', color: '#f87171', border: '1px solid rgba(220,38,38,0.4)' },
  flash: { background: 'rgba(124,58,237,0.25)', color: '#c4b5fd', border: '1px solid rgba(124,58,237,0.5)' },
  short: { background: 'rgba(124,58,237,0.25)', color: '#c4b5fd', border: '1px solid rgba(124,58,237,0.5)' },
  poetry: { background: 'rgba(124,58,237,0.25)', color: '#c4b5fd', border: '1px solid rgba(124,58,237,0.5)' },
  inspiring: { background: 'rgba(217,119,6,0.2)', color: '#fcd34d', border: '1px solid rgba(217,119,6,0.4)' },
};

// One rotation window (30 min): the shuffle seed and the re-roll timer both
// derive from this so the roll boundary and the seed flip together.
const ROTATION_MS = 1800000;

// Deterministic per-rotation score: seeded hash over the full slug, so every
// character contributes and no first-letter class can pin itself to the front.
function rotationScore(slug, seed) {
  let h = (seed >>> 0) || 1;
  for (let i = 0; i < slug.length; i++) {
    h = Math.imul(h ^ slug.charCodeAt(i), 2654435761) >>> 0;
  }
  return h;
}

// Pinned stories (featuredPin in the CMS) always lead the pick — the 3 newest
// pins win if more are flagged — and the remaining slots fill from the
// deterministic per-rotation shuffle over everything else.
function getRotationCarousel(stories) {
  if (!stories || stories.length === 0) return [];
  const seed = Math.floor(Date.now() / ROTATION_MS);
  const pinned = stories
    .filter(st => st.featuredPin === true)
    .sort((a, b) => getStorySortTime(b) - getStorySortTime(a))
    .slice(0, 3);
  const pinnedIds = new Set(pinned.map(st => st.id));
  const rest = stories.filter(st => !pinnedIds.has(st.id));
  const sorted = [...rest].sort((a, b) => parseDate(b.date) - parseDate(a.date));
  return [
    ...pinned,
    ...[...sorted]
      .sort((a, b) =>
        (rotationScore(a.id, seed) - rotationScore(b.id, seed)) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      )
      .slice(0, 10 - pinned.length),
  ];
}

// ── Featured-story trailer ──────────────────────────────────────────────────
// Every second story's card is preceded by a trailer: its trailerQuote animates
// word by word over its blurred cover, then dissolves into that story's card.
// The rotation is a sequence of steps over the carousel — cards keep their
// duration, trailers get a computed one. Trailer steps share the story's dot.

const HERO_CARD_MS = 5000;
// ⭑ R32.2 — THE CAP MOVED WITH THE DWELL, 8000 → 11000. Ikenna's ruling on his first walk:
// a trailer card now carries TWO quotes, the house's and a reader's, and passed too quickly
// to read. Three seconds go onto the hold below. Raising the cap is not decoration: NINE of
// the 157 live quotes already computed to exactly 8000 and would have gained nothing at all
// from a longer hold under the old ceiling.
// ⚠ CARDS ARE UNTOUCHED at HERO_CARD_MS. A plain card gained nothing to read in R32, and
// slowing all ten would make the carousel drag. The two durations were already separate
// constants, so this is not a fragmentation — it is the split doing its job.
const TRAILER_CAP_MS = 11000;
const TRAILER_DISSOLVE_MS = 900;
// Longest any single step can legitimately run; the watchdog force-advances
// past this plus a grace window if the step's own timer never fired.
const MAX_STEP_MS = Math.max(HERO_CARD_MS, TRAILER_CAP_MS);
const WATCHDOG_GRACE_MS = 1500;

// R32.2 — the reader's line lands last, so the extra dwell goes on the HOLD and nowhere else.
// Adding it to the lead-in or the word cadence would slow the house quote's animation; the
// three seconds are meant to be time to READ what is already fully on screen.
const TRAILER_READER_HOLD_MS = 3000;

function getTrailerDuration(quote) {
  const wordCount = quote.trim().split(/\s+/).filter(Boolean).length;
  const hold = Math.max(1600, Math.min(3200, wordCount * 120)) + TRAILER_READER_HOLD_MS;
  // leadIn 350 + words×150 + rule 450 + attribution 300 + hold, capped.
  return Math.min(350 + wordCount * 150 + 750 + hold, TRAILER_CAP_MS);
}

// Steps: { type: 'card'|'trailer', storyIndex, duration }. EVERY story but the
// first gets a trailer step before its card, provided it has a non-empty
// trailerQuote and a promotable voice. Stories without either show plain and do
// NOT steal a trailer from a neighbour. Under reduced motion the sequence is
// cards only — rotation behaves exactly as before.
//
// ⭑ R32.2: this was "every 2nd story" until Ikenna's first walk found two
// trailers in ten. The modulo capped the ten at five before a voice was
// consulted, and it was pacing a card that carried ONE quote. See shouldTrailer
// in app/lib/trailerVoices.js for the full reasoning, the measurements, and the
// alternative fix that was refused.
//
// ── R32: TWO MORE CONDITIONS, AND WHAT THEY MEAN WHEN THEY FAIL ─────────────
//
// A trailer step is now emitted only when the story ALSO has a promotable
// reader's voice, and only once the quote stage's pin has been measured.
//
// ⭑ A STORY WITH NO PROMOTABLE VOICE LOSES ITS TRAILER, NOT ITS PLACE. Its card
// stays in the ten exactly as before. Ikenna's reasoning, 2 Sept 2026: dropping
// the card would let comment activity decide which stories get promoted, and
// that is backwards — the house chooses what is featured, not the commenters.
//
// ⚠ AND THIS IS THE ANSWER TO "WHAT IF A COMMENT FAILS BETWEEN THE POOL BEING
// BUILT AND THE CARD BEING DRAWN": THE CARD IS NOT BUILT. The voice is an INPUT
// to whether the step exists, not something fetched after it does, so there is
// no code path anywhere that draws a trailer with an empty corner. A voice that
// stops being promotable disappears from voicesBySlug on the next data load and
// the step it fed simply stops being emitted.
function buildHeroSequence(carousel, reducedMotion, voicesBySlug, pinReady) {
  const seq = [];
  carousel.forEach((s, storyIndex) => {
    const quote = typeof s.trailerQuote === 'string' ? s.trailerQuote.trim() : '';
    if (shouldTrailer({ storyIndex, reducedMotion, quote, voices: voicesBySlug?.get(s.id), pinReady })) {
      seq.push({ type: 'trailer', storyIndex, duration: getTrailerDuration(quote) });
    }
    seq.push({ type: 'card', storyIndex, duration: HERO_CARD_MS });
  });
  return seq;
}

// ── THE PIN, MEASURED OVER THE WHOLE POOL ───────────────────────────────────
//
// ⚠ NOTHING PINS UNTIL EVERY CANDIDATE HAS REPORTED. The stage height cannot be
// a constant in this file: the quote size is a clamp() so it depends on the
// viewport, the metrics depend on Cormorant Garamond having actually loaded,
// and the pool changes the moment a trailer quote is edited in the CMS. So it
// is measured — every eligible quote on the site, offscreen, in the real type
// at the real width, and the tallest wins.
//
// The measurement itself is app/lib/pinQuoteStage.js — its own module so the
// height suite can run THE REAL FUNCTION against the live pool rather than a
// second copy of it. Measured 2 Sept 2026 over the 157 live quotes: 209px at
// 390 and 430, 156 at 768, 260 at 1024, 335 at 1440 — a 279px swing on desktop
// between the shortest quote and the tallest, which is how far the STORY
// TRAILER kicker was jumping as the carousel turned before this pin existed.
/**
 * The pin, remeasured whenever anything it depends on moves: the pool, the
 * viewport, or the fonts arriving. Returns 0 until it is known, and a 0 pin
 * emits no trailer steps at all — the carousel shows plain cards rather than a
 * stage of the wrong height.
 */
function useQuoteStagePin(quotes) {
  const [pin, setPin] = useState(0);
  const key = quotes.join('\u0000');
  useEffect(() => {
    if (quotes.length === 0) { setPin(0); return; }
    let cancelled = false;
    const measure = () => { if (!cancelled) setPin(measureQuotePin(quotes)); };
    // Fallback metrics are not the real metrics; measuring before the face has
    // landed would pin the stage to Georgia and be wrong by tens of pixels.
    if (document.fonts?.ready) document.fonts.ready.then(measure).catch(measure);
    else measure();
    let t;
    const onResize = () => { clearTimeout(t); t = setTimeout(measure, 150); };
    window.addEventListener('resize', onResize);
    return () => { cancelled = true; clearTimeout(t); window.removeEventListener('resize', onResize); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return pin;
}

// ── THE VOICES ──────────────────────────────────────────────────────────────
//
// One bounded read per carousel story of comment_screening/{slug} — a measured
// mean of 888 bytes, against 3.6 KB for that story's raw comment thread. The
// node contains ONLY screened comments, so the carousel cannot accidentally
// promote something unscreened: the unpromotable ones are not in the node it
// reads.
//
// ⚠ NO LIVE LISTENER, DELIBERATELY. Subscribing to comments is the whole-node
// pattern the Fortress Audit removed (peak database load 15.1% with 338
// readers, of which `get` was 0.1505 of 0.1509) and it is not coming back for
// this. The consequence, stated rather than hidden: a comment a founder revokes
// mid-session can finish that session on the cards of a reader already on the
// page. The dangerous direction is safe in every case — unchecked is never
// promotable, not for a moment.
function useTrailerVoices(carousel) {
  const [voices, setVoices] = useState(() => new Map());
  const slugs = carousel
    .filter((s) => typeof s.trailerQuote === 'string' && s.trailerQuote.trim())
    .map((s) => s.id);
  const key = slugs.join(',');
  useEffect(() => {
    if (slugs.length === 0) { setVoices(new Map()); return; }
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        slugs.map(async (slug) => {
          try {
            const snap = await get(ref(db, `${SCREENING_NODE}/${slug}`));
            return [slug, promotableVoices(snap.exists() ? snap.val() : null)];
          } catch {
            // An unreadable node is no voices, which is no trailer — never a
            // trailer with a hole in it.
            return [slug, []];
          }
        })
      );
      if (!cancelled) setVoices(new Map(entries));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return voices;
}

/**
 * ⚠⚠ THE IDENTITY RESOLVES AT RENDER. R33's Square audit found identity
 * photographed at write time and never refreshed — the island badge wrong on
 * 112 of 115 posts, 23 stale names, 15 readers showing initials who by then had
 * pictures. Measured on the comments 2 Sept 2026, 447 of 1,830 stored
 * authorName copies (24.4%) already disagree with the reader's live record.
 * This surface reads users/{uid}; the stored copy is only the last rung of the
 * ladder in resolveVoiceIdentity, for the 29 commenters whose user record holds
 * no name at all.
 *
 * One read per distinct reader on the carousel — at most ten, cached for the
 * life of the page, and exactly what Avatar variant="comment" and UserBadge
 * self already do on the story pages.
 */
function useVoiceIdentities(uids) {
  const [people, setPeople] = useState(() => new Map());
  const key = [...new Set(uids)].sort().join(',');
  useEffect(() => {
    const wanted = [...new Set(uids)].filter(Boolean);
    if (wanted.length === 0) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        wanted.map(async (uid) => {
          try {
            const snap = await get(ref(db, `users/${uid}`));
            return [uid, snap.exists() ? snap.val() : null];
          } catch {
            return [uid, null];
          }
        })
      );
      if (!cancelled) setPeople(new Map(entries));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return people;
}

/**
 * THE READER'S ZONE — the second voice on the card.
 *
 * Fitted here rather than estimated: the comment is abridged against a probe of
 * this zone's own width in this zone's own type, in a layout effect, so the
 * decision is made from the real box before anything paints. `abridgeToFit`
 * takes `fits` as an argument for exactly this reason — the suite passes a
 * counting stub, the card passes the DOM.
 */
function TrailerVoice({ voice, person, delay }) {
  const zoneRef = useRef(null);
  const probeRef = useRef(null);
  const lineRef = useRef(null);

  // The fit is written straight into the node rather than through state. Not a
  // micro-optimisation: a layout effect that sets state renders twice, and the
  // second render is the one the reader would see the line appear on. This way
  // the measurement and the text land in the same commit, before paint.
  useLayoutEffect(() => {
    const probe = probeRef.current;
    const out = lineRef.current;
    const zone = zoneRef.current;
    if (!probe || !out || !zone || !voice) return;
    // Two lines of this face at this size — read off the probe rather than
    // computed, so a font that has not landed yet cannot produce a wrong cap.
    probe.textContent = 'x';
    const oneLine = probe.getBoundingClientRect().height;
    const cap = oneLine * 2 + 1;
    const fits = (t) => {
      probe.textContent = t;
      return probe.getBoundingClientRect().height <= cap;
    };
    const { text } = abridgeToFit(voice.text, oneLine ? fits : () => false);
    probe.textContent = '';
    out.textContent = text || '';
    // A width so narrow that not one word fits is not a card we would draw.
    zone.hidden = !text;
  }, [voice]);

  // A voice we cannot name is not drawn at all. resolveVoiceIdentity's last rung
  // is the comment's stored copy and this surface deliberately does not carry
  // one — "Reader" beside a real photograph would be worse than no zone.
  if (!voice || !person) return null;

  const badge = person.isAuthor ? { color: '#581c87' } : getBadge(person.readCount);

  return (
    <div className="tv-zone" ref={zoneRef} style={{ animationDelay: `${delay}ms` }}>
      <div className="tv-kicker">A Reader Said</div>
      <p className="tv-line"><q ref={lineRef} /></p>
      <div className="tv-id">
        <span style={{
          width: 22, height: 22, borderRadius: '50%', flexShrink: 0, overflow: 'hidden',
          background: 'rgba(107,47,173,0.22)', border: '1px solid rgba(107,47,173,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: BODY, fontSize: 9, color: '#c9a84c',
        }}>
          {person.photo
            ? <img src={person.photo} alt="" width={22} height={22} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : person.initials}
        </span>
        <span style={{
          fontFamily: BODY, fontSize: '0.78rem', color: 'rgba(245,240,232,0.9)', whiteSpace: 'nowrap',
        }}>{person.name}</span>
        {/* ⭑ Icon only, no label. "Immortal of the Island" out-measures the name
            beside it, and 67 of 99 commenters carry no badge at all — a
            labelled badge would make this row's width lurch from card to card,
            which is a moving stage in a different direction. */}
        {badge && <BadgeIcon color={badge.color} size={12} />}
      </div>
      <p className="tv-line tv-probe" ref={probeRef} aria-hidden="true" />
    </div>
  );
}

// The trailer layer: blurred slow-zooming cover (or aurora fallback), staggered
// word reveal, gold rule, attribution — and, since R32, a reader's line in the
// lower right. Stays mounted through the dissolve into the card (same story, so
// `story` doesn't change across that boundary).
function HeroTrailer({ story, dissolving, voice, person, pin }) {
  const quote = (story.trailerQuote || '').trim();
  const words = quote.split(/\s+/).filter(Boolean);
  const duration = getTrailerDuration(quote);
  const ruleDelay = 350 + words.length * 150 + 450;
  const attrDelay = ruleDelay + 300;
  return (
    <div
      className={`hero-trailer${dissolving ? ' is-dissolving' : ''}`}
      style={{ position: 'absolute', inset: 0, zIndex: 3, overflow: 'hidden', background: '#0c0918' }}
    >
      {story.cover ? (
        <img
          src={story.coverSizes?.w720 || story.cover}
          alt=""
          aria-hidden="true"
          style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            objectFit: 'cover', objectPosition: 'center top',
            filter: 'blur(22px) brightness(0.45) saturate(1.1)',
            animation: `trailer-zoom ${duration}ms linear forwards`,
          }}
        />
      ) : (
        <div className="trailer-aurora" />
      )}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(8,6,16,0.35)' }} />
      {/* Raised from bottom 22% to 34% — Ikenna's ruling. The quote and its
          attribution sat low with dead space beneath, and that space is where
          the reader's line now goes. */}
      <div style={{ position: 'absolute', left: '4%', right: '4%', bottom: '34%', maxWidth: 640, zIndex: 1 }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 10, marginBottom: 26,
        }}>
          <span aria-hidden="true" style={{ width: 34, height: 1, background: 'rgba(201,168,76,0.55)' }} />
          <span style={{
            fontFamily: LABEL, fontSize: '0.7rem', letterSpacing: '0.32em',
            color: '#c9a84c', whiteSpace: 'nowrap',
          }}>STORY TRAILER</span>
          <span aria-hidden="true" style={{ width: 34, height: 1, background: 'rgba(201,168,76,0.55)' }} />
        </div>
        {/* The pinned stage. Height comes from the measured pool maximum and the
            quote sits on its FLOOR, so the kicker above never moves between
            rotations and nothing below it moves either. */}
        <div className="trailer-stage" style={{ height: pin || undefined }}>
          <p className="trailer-quote">
            {words.map((w, i) => (
              <span key={i} className="trailer-word" style={{ animationDelay: `${350 + i * 150}ms` }}>
                {w}{i < words.length - 1 ? ' ' : ''}
              </span>
            ))}
          </p>
        </div>
        <div className="trailer-rule" style={{ animationDelay: `${ruleDelay}ms` }} />
        <div className="trailer-attr" style={{ animationDelay: `${attrDelay}ms` }}>
          from {story.title} · {story.author}
        </div>
      </div>
      <TrailerVoice voice={voice} person={person} delay={attrDelay} />
    </div>
  );
}

function StoryCard({ story, userTier = null, scorePct, ...rest }) {
  const [hovered, setHovered] = useState(false);
  return (
    <a {...rest} href={story.url}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        textDecoration: 'none', flexShrink: 0, width: 120, minWidth: 120, height: 160,
        borderRadius: 12, overflow: 'hidden', display: 'block',
        position: 'relative', cursor: 'pointer',
        border: `1px solid ${hovered ? 'rgba(107,47,173,0.6)' : 'rgba(107,47,173,0.25)'}`,
        transition: 'border-color 0.2s',
        boxShadow: '0 4px 20px rgba(107,47,173,0.15)',
      }}>
      <CoverImage fill cover={story.cover} coverSizes={story.coverSizes} coverHash={story.coverHash} alt={story.title} sizes="120px" />
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 80, background: 'linear-gradient(to top, rgba(8,6,16,0.95), transparent)' }} />
      {isNew(story) && (
        <span style={{ ...newBadgeStyle, top: 8, left: 8 }}>New</span>
      )}
      <QuizPill hasQuiz={advertisesQuiz(story)} userTier={userTier} scribblesReward={(story.quiz || story.quizMeta)?.scribblesReward || 50} scorePct={scorePct} />
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '0 8px 8px' }}>
        <div style={{ fontFamily: DISPLAY, fontSize: '0.75rem', fontWeight: 600, color: '#f5f0e8', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{story.title}</div>
        <div style={{ ...cardAuthorStyle, fontSize: '0.6rem', marginTop: 2 }}>{story.author}</div>
      </div>
    </a>
  );
}

function JustAddedCard({ story, userTier = null, scorePct, ...rest }) {
  const [hovered, setHovered] = useState(false);
  return (
    <a {...rest} href={story.url}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ textDecoration: 'none', display: 'block', flexShrink: 0, width: 160, minWidth: 160 }}>
      <div style={{
        position: 'relative', width: 160, height: 220, borderRadius: 12, overflow: 'hidden',
        border: `1px solid ${hovered ? 'rgba(107,47,173,0.6)' : 'rgba(107,47,173,0.25)'}`,
        boxShadow: '0 4px 20px rgba(107,47,173,0.2)', transition: 'border-color 0.2s',
      }}>
        <CoverImage fill cover={story.cover} coverSizes={story.coverSizes} coverHash={story.coverHash} alt={story.title} sizes="160px" />
        {isNew(story) && (
          <span style={{ ...newBadgeStyle, top: 10, left: 10 }}>New</span>
        )}
        <QuizPill hasQuiz={advertisesQuiz(story)} userTier={userTier} scribblesReward={(story.quiz || story.quizMeta)?.scribblesReward || 50} scorePct={scorePct} />
      </div>
      <div style={{ marginTop: 10, padding: '0 2px' }}>
        <div style={{ fontFamily: DISPLAY, fontSize: '0.88rem', fontWeight: 600, lineHeight: 1.3, color: '#f5f0e8', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{story.title}</div>
        <div style={{ ...cardAuthorStyle, fontSize: '0.65rem', marginTop: 4 }}>{story.author}</div>
      </div>
    </a>
  );
}

/**
 * THE SERIES ROW — the homepage's window onto /series.
 *
 * Deliberately shaped like <Row> on the outside (same kicker, same title scale, same See-all,
 * same horizontally-scrolling strip) and nothing like it on the inside, because the record is
 * different: a series has a poster and a derived released-count, not a cover, an author, a
 * quiz pill and a reader's quiz tier. Matching the chrome is what makes it read as a sibling
 * of the five category rows; matching the internals would have meant faking a story.
 *
 * ── IT FETCHES ITS OWN DATA, AND ON PURPOSE ──────────────────────────────────────────────
 *
 * The category rows all slice `allStories`, which is one read of cms_stories_index. Series
 * live in two other nodes entirely, so this row pays for its own two reads. They are NOT
 * folded into the page's main load: this component renders nothing until they land, and if
 * they never land it renders nothing forever. A slow or failed series read must not delay or
 * blank the six rows above it — the homepage's job is the library, and the Series is a guest
 * on it.
 *
 * ── IT HIDES ITSELF WHEN EMPTY, LIKE THE ROW IT REPLACED ────────────────────────────────
 *
 * The Book Reader row was `{... .length > 0 && <Row .../>}` — a bare conditional with no
 * skeleton, unlike its five neighbours. That is kept: an empty Series section on the homepage
 * would advertise a shelf with nothing on it, which is precisely what /serial did for months
 * before it was retired.
 */
function SeriesRow() {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { getPublishedSeries, getInstalments } = await import('../lib/series/loader');
        const list = await getPublishedSeries();
        if (!list.length) { if (!cancelled) setRows([]); return; }
        const withRows = await Promise.all(
          list.map(async (s) => ({ ...s, rows: await getInstalments(s.id) })),
        );
        if (!cancelled) setRows(withRows);
      } catch {
        // Silent, and it stays silent: the loader already logs, and this row failing is a
        // missing section rather than a broken page.
        if (!cancelled) setRows([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!rows || rows.length === 0) return null;

  return (
    <section style={{ padding: '0.75rem 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '1rem', padding: '0 4%' }}>
        <div data-reveal="up">
          <span style={kickerStyle}>{SERIES_TIER_GATE_ENABLED ? 'PLATINUM' : 'FREE TO READ'}</span>
          <h3 style={sectionTitleStyle}>The Series</h3>
        </div>
        <Link href="/series" style={seeAllStyle}>
          See all{seeAllChevron}
        </Link>
      </div>
      <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingLeft: '4%', paddingRight: '4%', paddingBottom: '0.5rem', scrollbarWidth: 'none' }}>
        {rows.slice(0, 12).map((s, i) => (
          <Link
            key={s.id}
            href={`/series/${s.slug}`}
            data-reveal="up"
            data-reveal-delay={(i % 6) + 1}
            style={{ flex: '0 0 auto', width: 140, textDecoration: 'none', display: 'block' }}
          >
            <div
              role="presentation"
              style={{
                width: 140, aspectRatio: '2 / 3', borderRadius: 8, overflow: 'hidden',
                border: '1px solid rgba(255,255,255,0.08)',
                background: s.coverUrl
                  ? `center / cover no-repeat url(${s.coverUrl})`
                  : 'linear-gradient(160deg, #1a0f2e, #0d0a18)',
              }}
            />
            <div style={{ marginTop: 10, padding: '0 2px' }}>
              <div style={{ fontFamily: DISPLAY, fontSize: '0.88rem', fontWeight: 600, lineHeight: 1.3, color: '#f5f0e8', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {s.title}
              </div>
              <div style={{ ...cardAuthorStyle, fontSize: '0.65rem', marginTop: 4 }}>{shelfLine(s.rows || [])}</div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function Row({ title, kicker, stories, seeAll, userTiersMap = {} }) {
  return (
    <section style={{ padding: '0.75rem 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '1rem', padding: '0 4%' }}>
        <div data-reveal="up">
          {kicker && <span style={kickerStyle}>{kicker}</span>}
          <h3 style={sectionTitleStyle}>{title}</h3>
        </div>
        <a href={seeAll} style={seeAllStyle}>
          See all{seeAllChevron}
        </a>
      </div>
      <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingLeft: '4%', paddingRight: '4%', paddingBottom: '0.5rem', scrollbarWidth: 'none' }}>
        {stories.slice(0, 12).map((s, i) => <StoryCard key={s.id} story={s} userTier={userTiersMap[s.id]?.tier ?? null} scorePct={userTiersMap[s.id]?.scorePct} data-reveal="up" data-reveal-delay={(i % 6) + 1} />)}
      </div>
    </section>
  );
}

function Top10Card({ s, i, userTier = null, scorePct, ...rest }) {
  const [active, setActive] = useState(false);
  const CARD_WIDTH = 120;
  const CARD_HEIGHT = 180;
  const NUM_W = 60;
  const VB_H = 300;
  const strokeColor = active ? 'rgba(107,47,173,0.4)' : 'rgba(255,255,255,0.18)';
  return (
    <a {...rest} href={s.url}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      style={{
        textDecoration: 'none', flexShrink: 0,
        width: CARD_WIDTH + NUM_W,
        display: 'block',
        marginRight: '0.25rem',
      }}>
      <div style={{
        position: 'relative', height: CARD_HEIGHT,
        transform: active ? 'scale(1.04)' : 'scale(1)',
        transition: 'transform 0.3s cubic-bezier(0.4,0,0.2,1)',
        overflow: 'visible',
      }}>
        <svg width={NUM_W} height={CARD_HEIGHT} viewBox={`0 0 ${NUM_W} ${VB_H}`}
          preserveAspectRatio="xMaxYMax meet" overflow="visible"
          style={{ position: 'absolute', left: 0, top: 0, zIndex: 1, overflow: 'visible' }}>
          <text x={NUM_W - 2} y={VB_H} textAnchor="end" dominantBaseline="text-after-edge"
            fontFamily="Cormorant Garamond, Georgia, serif" fontSize="120" fontWeight="900"
            fill="none" stroke={strokeColor} strokeWidth="1.5" paintOrder="stroke">
            {i + 1}
          </text>
        </svg>
        <div style={{
          position: 'absolute', top: 0, right: 0,
          width: CARD_WIDTH, height: CARD_HEIGHT,
          borderRadius: 8, overflow: 'hidden', background: '#111',
          boxShadow: active ? '0 20px 50px rgba(0,0,0,0.9), 0 0 0 1px rgba(107,47,173,0.3)' : '0 4px 20px rgba(0,0,0,0.6)',
          transition: 'box-shadow 0.3s',
        }}>
          <CoverImage fill cover={s.cover} coverSizes={s.coverSizes} coverHash={s.coverHash} alt={s.title} sizes="120px"
            imgStyle={{ filter: active ? 'brightness(0.85)' : 'brightness(1)', transition: 'filter 0.3s' }} />
        </div>
        <QuizPill hasQuiz={advertisesQuiz(s)} userTier={userTier} scribblesReward={(s.quiz || s.quizMeta)?.scribblesReward || 50} scorePct={scorePct} />
      </div>
      <div style={{ marginTop: 10, marginLeft: NUM_W, width: CARD_WIDTH }}>
        <div style={{ fontFamily: DISPLAY, fontSize: '0.8rem', fontWeight: 600, lineHeight: 1.3, color: '#f5f0e8', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{s.title}</div>
        <div style={{ ...cardAuthorStyle, fontSize: '0.65rem', marginTop: 3 }}>{s.author}</div>
      </div>
    </a>
  );
}

function SquareBanner({ squareOpen, countdown }) {
  const [hovered, setHovered] = useState(false);
  return (
    <section style={{ padding: '0 4%', margin: '1.5rem 0' }}>
      <a href="/square"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem',
          padding: '14px 20px', borderRadius: 14, textDecoration: 'none',
          background: squareOpen
            ? hovered ? 'rgba(107,47,173,0.15)' : 'rgba(107,47,173,0.08)'
            : 'rgba(255,255,255,0.02)',
          border: squareOpen
            ? `1px solid rgba(107,47,173,${hovered ? '0.45' : '0.28'})`
            : '1px solid rgba(255,255,255,0.06)',
          transition: 'all 0.2s',
        }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10, flexShrink: 0,
            background: squareOpen ? 'transparent' : 'rgba(107,47,173,0.15)',
            border: squareOpen ? 'none' : '1px solid rgba(107,47,173,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: squareOpen ? 'none' : 'sq-lockglow 1.8s ease-in-out infinite',
            overflow: 'hidden',
          }}>
            {squareOpen ? (
              <img src="/cs-logo-mark.png" alt="Calvary Scribblings" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 10 }} />
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9b6dff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            )}
          </div>
          <div>
            <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 15, color: squareOpen ? '#f5f0e8' : 'rgba(255,255,255,0.35)', marginBottom: 3 }}>
              The Scribblings Square
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
              {squareOpen ? (
                <>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#1d9e75', display: 'inline-block', animation: 'sq-pulse 2s infinite' }} />
                  <span style={{ color: '#1d9e75', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Open now</span>
                  <span style={{ color: 'rgba(255,255,255,0.2)' }}>·</span>
                  <span style={{ color: 'rgba(255,255,255,0.35)' }}>Join the conversation</span>
                </>
              ) : (
                <span style={{ color: 'rgba(255,255,255,0.22)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Opens tonight at 8pm London time</span>
              )}
            </div>
          </div>
        </div>
        {squareOpen ? (
          <div style={{
            background: '#6b2fad', borderRadius: 8, padding: '7px 18px',
            fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase',
            color: '#fff', flexShrink: 0, whiteSpace: 'nowrap',
          }}>
            Enter the Square
          </div>
        ) : (
          <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 15, color: 'rgba(155,109,255,0.55)', flexShrink: 0, whiteSpace: 'nowrap' }}>
            {countdown}
          </div>
        )}
      </a>
    </section>
  );
}

function SquareFAB({ squareOpen, countdown }) {
  return (
    <a href="/square" style={{
      position: 'fixed', bottom: 24, right: 20, zIndex: 900,
      display: 'flex', alignItems: 'center', gap: 8,
      background: squareOpen ? '#6b2fad' : 'rgba(10,10,10,0.95)',
      border: squareOpen ? 'none' : '1px solid rgba(107,47,173,0.4)',
      borderRadius: 40,
      padding: '11px 18px 11px 14px',
      textDecoration: 'none',
      boxShadow: squareOpen
        ? '0 4px 24px rgba(107,47,173,0.5)'
        : '0 4px 24px rgba(0,0,0,0.6)',
    }}>
      {squareOpen ? (
        <div style={{
          width: 18, height: 18, borderRadius: 5,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden',
        }}>
          <img src="/cs-logo-mark.png" alt="Calvary Scribblings" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 5 }} />
        </div>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9b6dff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'sq-lockglow-icon 1.8s ease-in-out infinite', flexShrink: 0 }}>
          <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
      )}
      <span style={{
        fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase',
        color: squareOpen ? '#fff' : 'rgba(155,109,255,0.8)',
      }}>
        {squareOpen ? 'The Square' : countdown}
      </span>
      {squareOpen && (
        <span style={{
          width: 7, height: 7, borderRadius: '50%',
          background: '#1d9e75',
          border: '1.5px solid #6b2fad',
          animation: 'sq-pulse 2s infinite',
          display: 'inline-block',
        }} />
      )}
    </a>
  );
}

// Contest banner for the seasonal board. Renders from a week before the window
// opens until a fortnight after it closes, then disappears on its own — no
// deploy needed to take it down. Pure config read, no network.
//
// R34a — THE THIRD BANNER. R34 replaced `open ? 'Now on' : 'Starts 1 August'`
// with a phase word from one place, and rewired the two banners its guard knew
// about. This one it never saw: the guard censused a typed list of two paths and
// the defect was in the third, so it reported clean for a fortnight while the
// site's landing surface said STARTS 1 AUGUST over a closed and certified board.
// Nothing here spells a phase word or a date any more — the chip, the call to
// action and the window line all come from app/lib/leaderboards.js.
//
// R34b — AND IT IS AN ENTRY POINT, the shape the other two banners and the app
// already ship. The whole card used to be one anchor to the board, so the home
// feed — the landing surface, and for most readers the only page they see —
// offered no route at all to what the programme IS. Now the card body goes to
// /reading-program and a separate pill goes to the board.
//
// TWO ANCHORS, NOT ONE, and that is forced: an <a> inside an <a> is invalid HTML,
// so the gold rectangle is a container and the two destinations are siblings
// inside it. The phase-aware verb rides the PILL rather than the card, because it
// describes the board — "See the results" pointing at an explainer would be the
// same class of lie as "See the prizes" pointing at a closed one.
//
// WHAT HAPPENS WHEN SHOW_SUMMER_2026_BUTTON IS FLIPPED OFF: the pill goes and the
// home feed keeps its route to the certified board, two taps instead of one —
// card to /reading-program, then the Summer 2026 link under Editions. That page
// reads neither the switch nor the phase, so nothing about flipping the switch
// can reach it; tests/leaderboard/program.test.mjs asserts that second tap.
function SummerProgramBanner() {
  const board = SUMMER_2026;
  const { visible, phase } = useContestPhase(board);
  if (!visible) return null;
  const status = programStatusLabel(phase);
  const pool = prizePool(board);

  return (
    <section style={{ padding: '0.75rem 0' }}>
      <div data-program-banner data-reveal="up" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 14, flexWrap: 'wrap',
        margin: '0 4%', padding: '1.05rem 1.25rem', borderRadius: 14,
        border: '1px solid rgba(201,168,76,0.3)',
        background: 'linear-gradient(135deg, rgba(201,164,76,0.10), rgba(107,47,173,0.07))',
      }}>
        {/* The card — what the programme IS. Survives the switch. */}
        <a data-program-about href={PROGRAM_DETAILS_HREF} style={{
          display: 'block', textDecoration: 'none', minWidth: 0, flex: '1 1 260px',
        }}>
          {status && (
            <span data-program-status style={{ ...kickerStyle, marginBottom: 4 }}>
              {status}
            </span>
          )}
          <h3 style={{ ...sectionTitleStyle, fontSize: '1.35rem' }}>{board.title}</h3>
          <p style={{ fontFamily: BODY, fontSize: '0.92rem', color: 'rgba(245,240,232,0.55)', margin: '6px 0 0', lineHeight: 1.5 }}>
            {board.prizes.length} prize places · £{pool} total · {board.windowLabel}
          </p>
          <span style={{ fontFamily: BODY, fontSize: '0.82rem', color: '#a78bfa', fontWeight: 600, display: 'inline-block', marginTop: 8 }}>
            How it works →
          </span>
        </a>

        {/* The pill — this edition's standings. Temporary by design: one edit
            removes it (SHOW_SUMMER_2026_BUTTON in app/lib/leaderboards.js), and
            the card above keeps the reader's route to the board via Editions. */}
        {SHOW_SUMMER_2026_BUTTON && (
          <a data-edition-button href={`/leaderboard/${board.boardId}`} style={{ ...seeAllStyle, flexShrink: 0 }}>
            {programBoardCta(phase)}{seeAllChevron}
          </a>
        )}
      </div>
    </section>
  );
}

function TopReadersStrip() {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const { ref, get } = await import('firebase/database');
        const snap = await get(ref(db, 'leaderboard'));
        if (!snap.exists()) { setRows([]); return; }
        const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
        const top = Object.entries(snap.val())
          .filter(([, u]) => u.leaderboardVisible !== false && (u.readerScore ?? 0) > 0 && (u.scoreUpdatedAt ?? 0) > weekAgo)
          .map(([uid, u]) => ({
            uid,
            displayName: u.displayName || 'Reader',
            username:    u.username || null,
            avatarUrl:   u.avatarUrl || null,
            readerScore: u.readerScore ?? 0,
            joinDate:    u.joinDate ?? Infinity,
          }))
          .sort((a, b) => (b.readerScore - a.readerScore) || (a.joinDate - b.joinDate))
          .slice(0, 5);
        setRows(top);
      } catch {
        setRows([]);
      }
    })();
  }, []);

  if (!rows || rows.length < 3) return null;

  const rankColor = r =>
    r === 1 ? '#c9a84c' : r === 2 ? 'rgba(201,168,76,0.6)' : r === 3 ? 'rgba(201,168,76,0.4)' : 'rgba(255,255,255,0.35)';

  return (
    <section style={{ padding: '0.75rem 0' }}>
      <a href="/leaderboard" style={{ display: 'block', textDecoration: 'none' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '0.75rem', padding: '0 4%' }}>
          <div data-reveal="up">
            <span style={kickerStyle}>THIS WEEK</span>
            <h3 style={sectionTitleStyle}>Top Readers</h3>
          </div>
          <span style={seeAllStyle}>View all{seeAllChevron}</span>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', overflowX: 'auto', paddingLeft: '4%', paddingRight: '4%', paddingBottom: '0.5rem', scrollbarWidth: 'none' }}>
          {rows.map((row, i) => {
            const rank = i + 1;
            const initials = row.displayName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
            return (
              <div key={row.uid} style={{
                display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12,
                padding: '0.75rem', borderRadius: 12,
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.06)',
                width: 200, minWidth: 200, flexShrink: 0,
              }}>
                <div style={{ fontFamily: DISPLAY, fontSize: '1.1rem', color: rankColor(rank), fontWeight: 600, width: 20, textAlign: 'center', flexShrink: 0 }}>
                  {rank}
                </div>
                <div style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: 'rgba(107,47,173,0.2)', border: '1px solid rgba(167,139,250,0.22)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, color: '#c4b5fd', overflow: 'hidden', flexShrink: 0,
                  fontFamily: 'Cormorant Garamond, Georgia, serif',
                }}>
                  {row.avatarUrl
                    ? <img src={row.avatarUrl} alt={initials} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : initials}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: DISPLAY, fontSize: '0.82rem', fontWeight: 600, color: '#f5f0e8', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.displayName}
                  </div>
                  {row.username && (
                    <div style={{ fontFamily: LABEL, fontSize: '0.62rem', letterSpacing: '0.05em', color: 'rgba(245,240,232,0.45)' }}>@{row.username}</div>
                  )}
                </div>
                <div style={{
                  fontFamily: BODY, fontSize: '0.95rem',
                  color: '#6b2fad', marginLeft: 'auto', flexShrink: 0,
                }}>
                  {row.readerScore.toLocaleString()}
                </div>
              </div>
            );
          })}
        </div>
      </a>
    </section>
  );
}

function StoryCardSkeleton() {
  return (
    <div style={{
      width: 120,
      minWidth: 120,
      height: 160,
      borderRadius: 12,
      border: '1px solid rgba(107,47,173,0.15)',
      background: 'rgba(255,255,255,0.04)',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        padding: '0 8px 8px',
        background: 'linear-gradient(to top, rgba(8,6,16,0.6) 0%, transparent 100%)',
      }}>
        <div style={{ height: 9, width: '85%', background: 'rgba(255,255,255,0.06)', borderRadius: 3, marginBottom: 5 }} />
        <div style={{ height: 7, width: '55%', background: 'rgba(255,255,255,0.05)', borderRadius: 2 }} />
      </div>
    </div>
  );
}

function JustAddedCardSkeleton() {
  return (
    <div style={{ width: 160, minWidth: 160, flexShrink: 0 }}>
      <div style={{
        width: 160,
        height: 220,
        borderRadius: 12,
        border: '1px solid rgba(107,47,173,0.15)',
        background: 'rgba(255,255,255,0.04)',
      }} />
      <div style={{ marginTop: 10, padding: '0 2px' }}>
        <div style={{ height: 10, width: '85%', background: 'rgba(255,255,255,0.06)', borderRadius: 3, marginBottom: 6 }} />
        <div style={{ height: 8, width: '55%', background: 'rgba(255,255,255,0.05)', borderRadius: 2 }} />
      </div>
    </div>
  );
}

function Top10CardSkeleton() {
  return (
    <div style={{
      width: 180,
      minWidth: 180,
      marginRight: '0.25rem',
    }}>
      <div style={{ position: 'relative', height: 180 }}>
        <div style={{
          position: 'absolute',
          left: 60,
          top: 0,
          width: 120,
          height: 180,
          borderRadius: 8,
          background: 'rgba(255,255,255,0.04)',
        }} />
      </div>
      <div style={{ marginTop: 10, marginLeft: 60, width: 120 }}>
        <div style={{ height: 9, width: '85%', background: 'rgba(255,255,255,0.06)', borderRadius: 3, marginBottom: 5 }} />
        <div style={{ height: 7, width: '55%', background: 'rgba(255,255,255,0.05)', borderRadius: 2 }} />
      </div>
    </div>
  );
}

function JustAddedSkeleton() {
  return (
    <section style={{ padding: '0.75rem 0' }}>
      <div style={{ padding: '0 4%', marginBottom: '0.75rem' }}>
        <span style={kickerStyle}>FRESH OFF THE PRESS</span>
        <h3 style={sectionTitleStyle}>Just Added</h3>
      </div>
      <div style={{
        display: 'flex',
        gap: 14,
        overflowX: 'auto',
        padding: '0 4% 0.5rem',
        scrollbarWidth: 'none',
      }}>
        {[0,1,2,3,4,5,6,7].map(i => <JustAddedCardSkeleton key={i} />)}
      </div>
    </section>
  );
}

function Top10Skeleton() {
  return (
    <section style={{ padding: '1rem 0' }}>
      <div style={{ padding: '0 4%', marginBottom: '1rem' }}>
        <span style={kickerStyle}>TOP ON THE SHELF</span>
        <h3 style={sectionTitleStyle}>Top 10 Stories</h3>
      </div>
      <div style={{
        display: 'flex',
        gap: '0',
        overflowX: 'auto',
        padding: '0 4% 0.5rem',
        scrollbarWidth: 'none',
      }}>
        {[0,1,2,3,4,5,6,7,8,9].map(i => <Top10CardSkeleton key={i} />)}
      </div>
    </section>
  );
}

function RowSkeleton({ title, kicker }) {
  return (
    <section style={{ padding: '0.75rem 0' }}>
      <div style={{
        padding: '0 4%',
        marginBottom: '1rem',
      }}>
        {kicker && <span style={kickerStyle}>{kicker}</span>}
        <h3 style={sectionTitleStyle}>{title}</h3>
      </div>
      <div style={{
        display: 'flex',
        gap: 14,
        overflowX: 'auto',
        padding: '0 4% 0.5rem',
        scrollbarWidth: 'none',
      }}>
        {[0,1,2,3,4,5,6].map(i => <StoryCardSkeleton key={i} />)}
      </div>
    </section>
  );
}

// ── Open Pages row (Stage 6) ───────────────────────────────────────────────
// Community-written posts. Self-contained: fetches the 6 most recent live posts
// from open_pages on mount and renders the homepage's horizontal-scroll row
// pattern. Renders nothing until there are posts, so it never leaves an empty
// rail at the bottom of the page. Carries the Open Pages gold/Cormorant identity
// on the homepage's dark canvas.
const OP_GOLD = '#c9a84c';
const OP_SERIF = "Cormorant Garamond, Georgia, serif";
const OP_CINZEL = "'Cinzel', 'Cormorant Garamond', Georgia, serif";

// Footer avatar fallback + count row — mirror the feed's avatarDot / countRow.
const opAvatarDot = {
  width: 28,
  height: 28,
  borderRadius: '50%',
  background: 'linear-gradient(135deg, #6b2fad, #3a1a63)',
  color: '#f5f0e8',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '0.8rem',
  fontWeight: 700,
  flexShrink: 0,
  fontFamily: OP_SERIF,
};

const opCountRow = {
  marginLeft: 'auto',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 12,
  fontFamily: OP_CINZEL,
  fontSize: 12,
  color: 'rgba(245,240,232,0.45)',
  flexShrink: 0,
};

function opTimeAgo(ts) {
  if (!ts || typeof ts !== 'number') return '';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  const weeks = Math.floor(days / 7);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
// ═══════════════════════════════════════════════════════════════════════════════════
// ⭑ THE HOME ROW IS TEXT ONLY — AND THAT IS A DIFFERENT RULING FROM THE FEED'S.
// ═══════════════════════════════════════════════════════════════════════════════════
// R40 rebuilt /open-pages as a contents page and gave a cover its own treatment there:
// a PLATE, a wide short band above the entry, because a plate is furniture with room
// to breathe and it rewards a writer who made art. R38 only MOVED this row; nothing
// restyled it, so it kept the pre-R40 card — a 210px bordered box with a 118px cover,
// a feather-in-a-gradient where there was none, no opening lines at all, and the read
// count Ikenna ruled out in R40.
//
// ⚠ THE ROW GETS THE OPPOSITE ANSWER ON COVERS, AND THE REASON IS THE NEIGHBOURS. On
// the feed an entry has the page to itself. HERE it sits between the house's own
// cover-led rows — Flash, Short Stories, Poetry, The Series — where every sibling is a
// wall of commissioned artwork. A community thumbnail in that company makes community
// writing compete with the catalogue ON THE CATALOGUE'S TERMS, and lose: the same
// 118px box, next to a professionally art-directed one, reads as the weaker version of
// the same thing.
//
// Text is not a lesser treatment here. It is the row saying it is a DIFFERENT KIND OF
// THING — the one place on the page where the words themselves are the offer. Between
// six rows of covers, a column of sentences is the thing that stops a scroll.
//
// ⚠ SO: NO IMAGES AT ALL. Not the cover, and not the 28px author avatar either. At that
// size an avatar identifies nobody; it is a decoration, and the ruling's word is TEXT
// ONLY. The writer's name is set in type instead, which reads better at row scale and
// leaves the row with no <img> in it — which is the assertion.
//
// ⚠ AND IT IS STILL A ROW. It scrolls horizontally beside its siblings and must not
// become a second feed: SIX entries, the same number it carried before, and the same
// number the sibling rows show before a See-all. The feed is where all of them live.

// 330px, and the width is a MEASURED decision rather than a taste — it is the width at
// which both live poems set their opening stanza without turning a line. See the note on
// verse below for the numbers and for what 300px did. Entries are a fixed size because a row of ragged heights reads as
// broken; without a cover to set the height, the clamps do it.
const OP_ROW_W = 330;
const OP_ROW_H = 190;

function OpenPagesEntry({ post, author }) {
  const [hover, setHover] = useState(false);
  // ⚠ THE SAME MODULE THE FEED USES. Two copies of "what is the opening" is how the two
  // surfaces start disagreeing — and a character substring is measurably wrong: R40
  // proved it shows a reader the section marker `**I. UNREAD**` and nothing else. The
  // row passes a smaller budget through the module's own options rather than cutting
  // the result itself.
  const opening = openingOf(post.body, { maxLines: 3, maxChars: 150 });
  const mins = readingTime(post.body);
  // Identity resolves at render; the stored snapshot is the fallback. R38 measured
  // 24.4% of stored identity copies already stale.
  const name = author?.displayName || post.authorName || 'Reader';

  return (
    <a
      href={`/open-pages/${post.id}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      data-op-row-entry
      data-op-row-kind={opening.kind}
      style={{
        textDecoration: 'none', flexShrink: 0,
        width: OP_ROW_W, minWidth: OP_ROW_W, height: OP_ROW_H,
        display: 'flex', flexDirection: 'column',
        // A hairline on the left, not a box. The feed separates entries with a rule;
        // laid on its side for a row, that rule becomes this.
        borderLeft: `1px solid ${hover ? 'rgba(201,168,76,0.5)' : 'rgba(245,240,232,0.12)'}`,
        padding: '2px 20px 2px 18px',
        transition: 'border-color 0.25s ease',
        background: 'transparent',
      }}
    >
      <span style={{ fontFamily: OP_CINZEL, fontSize: '0.58rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: OP_GOLD, marginBottom: 8 }}>
        {normalizeGenre(post.genre)}
      </span>

      <div style={{
        fontFamily: OP_SERIF, fontSize: '1.18rem', fontWeight: 600, color: '#f5f0e8', lineHeight: 1.2,
        marginBottom: 8, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
      }}>
        {post.title}
      </div>

      {/* ⚠ VERSE AT ROW WIDTH, AND THE WIDTH IS WHAT THE MEASUREMENT DECIDED.
          A verse line that WRAPS reads as two lines and the stanza's shape becomes a
          lie, so the question "is the row wide enough to set a stanza honestly?" had to
          be answered by counting rendered line boxes, not by estimating characters.

          At 300px it was NOT. Measured with a Range over the text: "THE SHAPE I BECAME"
          set 2 written lines as 2, but "The Outliers' Mind" set 3 as 4 — the opening
          line, "Somewhere between belonging and becoming," turned. And the cause was
          this block's own hanging indent, which costs 12px of measure: verse had 249px
          of content where prose had 261.

          At 330px both set honestly — 2→2 and 3→3 — with the longest verse line
          rendering at 267px in a 279px box. That is 12px of headroom, which is thin;
          a poet who writes a longer opening line will turn one, and that is what the
          hanging indent below is for.

          THE HANGING INDENT is what print does with a turned line: it keeps the breaks
          the writer typed while showing that the overflow is a turn and not a new line.
          The alternative was running verse as prose at row width, and that is the one
          that silently rewrites a poem. */}
      <div
        data-op-row-opening
        style={{
          fontFamily: OP_SERIF, fontSize: '0.92rem', lineHeight: 1.6, color: 'rgba(245,240,232,0.62)',
          flex: 1, overflow: 'hidden',
          display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
        }}
      >
        {opening.kind === 'verse'
          /* ⚠ EACH VERSE LINE IS ITS OWN BLOCK, and that is the whole of the hanging
             indent working correctly. The first attempt set the stanza as one block with
             `white-space: pre-line` and a text-indent — and text-indent applies to the
             FIRST line of a block, while the padding applies to all of them, so lines 2
             and 3 of every stanza came out indented and line 1 did not. That is not a
             hanging indent; it is a misprint of the poem, and it was visible the moment
             the row was screenshotted rather than reasoned about.
             Per line, the pair does what print does: the line sets flush, and only a
             TURN — a line too long for the measure — is indented under it. */
          ? opening.lines.map((line, i) => (
              <span key={i} style={{ display: 'block', paddingLeft: 12, textIndent: -12 }}>{line}</span>
            ))
          : opening.lines[0] || ''}
      </div>

      <div style={{ marginTop: 8, display: 'flex', alignItems: 'baseline', gap: 7, fontSize: '0.72rem', color: 'rgba(245,240,232,0.42)', minWidth: 0 }}>
        <span style={{ fontFamily: DISPLAY, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
        <span style={{ opacity: 0.5 }}>·</span>
        {/* ⚠ READ COUNT STAYS OUT, per R40's ruling: a low number on a young platform
            discourages the tap it exists to encourage. Reading time changes it. */}
        <span style={{ fontFamily: OP_CINZEL, fontSize: '0.56rem', letterSpacing: '0.14em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
          {mins} min read
        </span>
      </div>
    </a>
  );
}

function OpenPagesRow() {
  const [posts, setPosts] = useState(null);
  // Per-post engagement counts (postId -> { commentCount, reactionCount }) and
  // author photos (authorUid -> url|null) — fetched in a second pass, exactly as
  // the feed (app/open-pages/page.jsx) does it.
  const [authorPhotos, setAuthorPhotos] = useState({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await get(ref(db, 'open_pages'));
        if (cancelled) return;
        if (!snap.exists()) { setPosts([]); return; }
        const list = Object.entries(snap.val())
          .map(([id, p]) => ({ id, ...p }))
          .filter(p => p && p.status === 'live' && p.title)
          .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
          .slice(0, 6);
        setPosts(list);

        // ⭑ THE COUNTS FETCH WENT WITH THE COUNTS — two extra reads PER POST, for a
        // read count, a like count and a comment count that R40 ruled off the entry and
        // this row no longer draws. Twelve requests a homepage load for nothing.

        // Author avatars: one read per unique author at users/{uid} for the real
        // ⚠ THE READ STAYS, THE PHOTO GOES. The row is text only, so nothing renders an
        // avatar — but the live displayName still has to win over the stored snapshot,
        // which R38 measured as 24.4% stale. Same read, whole record kept.
        const uids = [...new Set(list.map((p) => p.authorUid).filter(Boolean))];
        const photoEntries = await Promise.all(uids.map(async (uid) => {
          try {
            const s = await get(ref(db, `users/${uid}`));
            return [uid, s.exists() ? s.val() : null];
          } catch {
            return [uid, null];
          }
        }));
        if (cancelled) return;
        setAuthorPhotos(Object.fromEntries(photoEntries));
      } catch (e) {
        console.error('Open Pages row error:', e);
        if (!cancelled) setPosts([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!posts || posts.length === 0) return null;

  return (
    <section style={{ padding: '1.5rem 0 2rem', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: '1.25rem', padding: '0 4%' }}>
        <div>
          <div style={{ fontFamily: OP_CINZEL, fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.22em', textTransform: 'uppercase', color: OP_GOLD, marginBottom: 7 }}>
            The Forum
          </div>
          <h3 style={{ fontFamily: OP_SERIF, fontSize: '1.85rem', fontWeight: 600, color: '#fff', margin: 0, lineHeight: 1.05 }}>
            Open Pages
          </h3>
          <p style={{ fontFamily: OP_SERIF, fontStyle: 'italic', fontSize: '1.05rem', color: 'rgba(255,255,255,0.5)', margin: '5px 0 0' }}>
            Stories written by the community.
          </p>
        </div>
        <a
          href="/open-pages"
          style={{ fontSize: '0.8rem', color: '#a78bfa', textDecoration: 'none', fontWeight: 600, whiteSpace: 'nowrap' }}
          onMouseEnter={e => e.target.style.color = '#c4b5fd'}
          onMouseLeave={e => e.target.style.color = '#a78bfa'}
        >
          See all →
        </a>
      </div>
      <div style={{ display: 'flex', gap: '0.6rem', overflowX: 'auto', paddingLeft: '4%', paddingRight: '4%', paddingBottom: '0.5rem', scrollbarWidth: 'none' }}>
        {posts.map(p => <OpenPagesEntry key={p.id} post={p} author={authorPhotos[p.authorUid]} />)}
      </div>
    </section>
  );
}

export default function Home() {
  const { user, logout } = useAuth();
  const userTiersMap = useUserStoryTiers();
  const [seqIdx, setSeqIdx] = useState(0);
  const [heroTransition, setHeroTransition] = useState(true);
  // Trailer layer lingering over the entering card during the 900ms dissolve.
  const [trailerDissolving, setTrailerDissolving] = useState(false);
  // Card content staggering in out of a trailer dissolve.
  const [cardEntering, setCardEntering] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [top10, setTop10] = useState([]);
  const [email, setEmail] = useState('');
  const [subscribeStatus, setSubscribeStatus] = useState('');
  const [squareOpen, setSquareOpen] = useState(false);
  const [countdown, setCountdown] = useState('');
  const [allStories, setAllStories] = useState([]);
  const [carousel, setCarousel] = useState([]);

  // When arriving from the gateway, its veil holds at black until this flips — the same
  // first-data condition the skeletons below key off, so the reveal lands on real content
  // rather than on a skeleton. Inert on a direct visit: there's no veil to lift.
  useArrivalReady(allStories.length > 0);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReducedMotion(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Pause the hero rotation while the tab is hidden so trailers don't play to
  // nobody and desync; the current step restarts fresh on return.
  useEffect(() => {
    const onVis = () => setPageVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 1024);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Square open/closed + countdown
  useEffect(() => {
    const tick = () => {
      setSquareOpen(isSquareOpen());
      setCountdown(getCountdown());
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const storiesRef = ref(db, 'cms_stories_index');
    const unsubscribe = onValue(storiesRef, async (snap) => {
      try {
        if (snap.exists()) {
          const data = snap.val();
          const now = new Date();
          const cmsStories = Object.entries(data)
            .map(([id, s]) => ({ ...s, id }))
            .filter(s => s.published !== false && (!s.publishAt || new Date(s.publishAt) <= now));
          // Resolve author display names live (batched, deduped) before render.
          const nameMap = await resolveAuthorNames(cmsStories);
          const resolved = withCurrentAuthorNames(cmsStories, nameMap);
          // Category rows render allStories in array order — keep newest-first.
          resolved.sort((a, b) => getStorySortTime(b) - getStorySortTime(a));
          setAllStories(resolved);
        }
      } catch (e) {
        console.error('CMS merge error:', e);
      }
    });
    return () => unsubscribe();
  }, []);

  // Live CMS updates re-pick with the current seed; the ref lets the re-roll
  // timer read fresh stories without being torn down on every onValue fire.
  const allStoriesRef = useRef([]);
  useEffect(() => {
    allStoriesRef.current = allStories;
    setCarousel(getRotationCarousel(allStories));
  }, [allStories]);

  // Re-roll just past each ROTATION_MS boundary — chained timeout, aligned to
  // the clock so the Date.now()-derived seed has flipped when it fires. A
  // timer starved by sleep/throttling fires late with the then-current seed
  // and re-arms to the next boundary, so picks recover instead of going stale.
  useEffect(() => {
    let t;
    const arm = () => {
      t = setTimeout(() => {
        setSeqIdx(0);
        setCarousel(getRotationCarousel(allStoriesRef.current));
        arm();
      }, ROTATION_MS - (Date.now() % ROTATION_MS) + 250);
    };
    arm();
    return () => clearTimeout(t);
  }, []);

  // ── R32 · the reader's line ────────────────────────────────────────────────
  // The pin is measured over EVERY eligible quote on the site, not over the ten
  // on screen: a pin that changed as the carousel re-rolled would be furniture
  // moving between rotations, which is the defect it exists to prevent.
  const allQuotes = useMemo(
    () => allStories.map(s => (typeof s.trailerQuote === 'string' ? s.trailerQuote.trim() : '')).filter(Boolean),
    [allStories]
  );
  const quotePin = useQuoteStagePin(allQuotes);
  const voicesBySlug = useTrailerVoices(carousel);

  // `loop` counts full passes of the carousel and advances each story's place in
  // its shuffle — Ikenna's ruling that a story shows several different comments
  // across a session rather than one fixed per session or per launch. It is
  // incremented only when the sequence wraps back to step 0, which is always a
  // CARD step — story 0 never trailers, and THAT IS WHY, not a leftover of the
  // every-2nd rule R32.2 removed. If step 0 were a trailer the pass counter
  // would advance into the very step whose voice it changes. shouldTrailer
  // holds this invariant explicitly and names it.
  const [loop, setLoop] = useState(0);

  // Rotation sequence: cards + trailer interstitials over the rotation carousel.
  const sequence = useMemo(
    () => buildHeroSequence(carousel, reducedMotion, voicesBySlug, quotePin > 0),
    [carousel, reducedMotion, voicesBySlug, quotePin]
  );

  // The rotation seed is the 30-minute window the carousel already re-rolls on,
  // so a story's shuffle order is stable within a rotation and different across
  // them. Recomputed with the carousel, never per render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rotationSeed = useMemo(() => Math.floor(Date.now() / ROTATION_MS), [carousel]);

  // One voice per story per pass. Computed for the whole carousel rather than
  // just the story on screen, so the reader's photograph is already resolved by
  // the time their card comes round.
  const picksBySlug = useMemo(() => {
    const m = new Map();
    for (const st of carousel) {
      const v = pickVoice(voicesBySlug.get(st.id) || [], { slug: st.id, seed: rotationSeed, loop });
      if (v) m.set(st.id, v);
    }
    return m;
  }, [carousel, voicesBySlug, rotationSeed, loop]);

  const voiceUids = useMemo(() => [...picksBySlug.values()].map(v => v.uid).filter(Boolean), [picksBySlug]);
  const voicePeople = useVoiceIdentities(voiceUids);

  // Any sequence rebuild (re-roll, CMS update, motion-pref change) clamps the
  // step index back into range and resets in-flight presentation state so a
  // trailer from the old sequence can't keep playing over a new card.
  useEffect(() => {
    setTrailerDissolving(false);
    setCardEntering(false);
    setHeroTransition(true);
    setSeqIdx(i => (sequence.length > 0 && i >= sequence.length ? 0 : i));
  }, [sequence]);

  useEffect(() => {
  if (allStories.length === 0) return;
  async function fetchTop10() {
    try {
      const weeklySnap = await get(ref(db, 'top_stories/weekly'));
      const weekly = weeklySnap.exists() ? weeklySnap.val() : null;
      if (weekly && Array.isArray(weekly.items) && weekly.items.length > 0) {
        const byId = new Map(allStories.map(s => [s.id, s]));
        const precomputed = weekly.items
          .map(item => {
            const story = byId.get(item.slug);
            return story ? { ...story, hits: item.count || 0 } : null;
          })
          .filter(Boolean)
          .slice(0, 10);
        setTop10(precomputed);
        return;
      }
      const snapshot = await get(ref(db, 'stories'));
      if (snapshot.exists()) {
        const data = snapshot.val();
        const withCounts = allStories.map(s => ({ ...s, hits: (data[s.id] && data[s.id].hits) || 0 }));
        setTop10(withCounts.sort((a, b) => b.hits - a.hits).slice(0, 10));
      }
    } catch (e) {
      console.error('Firebase Top 10 error:', e);
    }
  }
  fetchTop10();
}, [allStories]);

  const handleSubscribe = async () => {
    if (!email || !email.includes('@')) { setSubscribeStatus('Please enter a valid email address.'); return; }
    try {
      const res = await fetch('https://calvary-newsletter.calvarymediauk.workers.dev/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (res.ok) {
        setSubscribeStatus("Thank you! You're now subscribed.");
        setEmail('');
      } else if (res.status === 409) {
        setSubscribeStatus('You are already subscribed.');
      } else {
        setSubscribeStatus('Something went wrong. Please try again.');
      }
    } catch (e) {
      setSubscribeStatus('Something went wrong. Please try again.');
    }
  };

  // Manual navigation always lands on a story's CARD step — an active trailer
  // is skipped straight to its card, never replayed. Only one hand-off can be
  // pending: a rapid second click cancels the first so a stale timeout can't
  // land on an index computed from a superseded sequence.
  const goToTimeoutRef = useRef(null);
  const goTo = useCallback((storyIdx) => {
    setTrailerDissolving(false);
    setCardEntering(false);
    setHeroTransition(false);
    clearTimeout(goToTimeoutRef.current);
    goToTimeoutRef.current = setTimeout(() => {
      const idx = sequence.findIndex(st => st.type === 'card' && st.storyIndex === storyIdx);
      setSeqIdx(idx >= 0 ? idx : 0);
      setHeroTransition(true);
    }, 300);
  }, [sequence]);
  useEffect(() => () => clearTimeout(goToTimeoutRef.current), []);

  // Auto-advance: each step schedules its own timeout (cards 5s, trailers their
  // computed duration). A finished trailer dissolves into its card; a card
  // hands off with the existing 300ms cross-fade. Each run also arms the
  // watchdog deadline below; Infinity disarms it while paused/empty.
  const sequenceLenRef = useRef(0);
  const stepDeadlineRef = useRef(Infinity);
  useEffect(() => {
    sequenceLenRef.current = sequence.length;
    if (sequence.length === 0 || !pageVisible) {
      stepDeadlineRef.current = Infinity;
      return;
    }
    const cur = seqIdx < sequence.length ? seqIdx : 0;
    const step = sequence[cur];
    stepDeadlineRef.current = Date.now() + MAX_STEP_MS + WATCHDOG_GRACE_MS;
    let inner;
    const timer = setTimeout(() => {
      const next = (cur + 1) % sequence.length;
      // Wrapped — one full pass of the carousel, so each story advances to the
      // next voice in its shuffle. See `loop` above.
      if (next === 0) setLoop(n => n + 1);
      if (step.type === 'trailer') {
        // Next step is this story's card: dissolve overlaps into the card entrance.
        setSeqIdx(next);
        setTrailerDissolving(true);
        setCardEntering(true);
      } else {
        setHeroTransition(false);
        inner = setTimeout(() => {
          setSeqIdx(next);
          setHeroTransition(true);
        }, 300);
      }
    }, step.duration);
    return () => { clearTimeout(timer); clearTimeout(inner); };
  }, [seqIdx, sequence, pageVisible]);

  // Watchdog: a wall-clock heartbeat that force-advances if the step's own
  // timeout never fired (dropped by sleep/throttling, or a future logic bug).
  // Checks a Date.now() deadline rather than racing a sibling setTimeout, so
  // it recovers even when the browser sheds pending one-shot timers. The
  // carousel must never be able to freeze, whatever bug arrives.
  useEffect(() => {
    const wd = setInterval(() => {
      if (Date.now() < stepDeadlineRef.current) return;
      stepDeadlineRef.current = Date.now() + MAX_STEP_MS + WATCHDOG_GRACE_MS;
      setTrailerDissolving(false);
      setCardEntering(false);
      setHeroTransition(true);
      setSeqIdx(i => {
        if (sequenceLenRef.current === 0) return 0;
        const n = (i + 1) % sequenceLenRef.current;
        if (n === 0) setLoop(l => l + 1);
        return n;
      });
    }, 1000);
    return () => clearInterval(wd);
  }, []);

  // Dissolve/entrance flags time out in their own effects so advancing seqIdx
  // (which re-runs the timer effect above) can't cancel them mid-flight.
  useEffect(() => {
    if (!trailerDissolving) return;
    const t = setTimeout(() => setTrailerDissolving(false), TRAILER_DISSOLVE_MS + 50);
    return () => clearTimeout(t);
  }, [trailerDissolving]);

  useEffect(() => {
    if (!cardEntering) return;
    // Covers the 900ms container animation plus the last child's 390ms stagger.
    const t = setTimeout(() => setCardEntering(false), 1800);
    return () => clearTimeout(t);
  }, [cardEntering]);

  const step = sequence[seqIdx < sequence.length ? seqIdx : 0];
  const heroIndex = step ? step.storyIndex : 0;
  const isTrailerStep = step?.type === 'trailer';
  const featured = carousel[heroIndex];
  const badge = featured ? (badgeStyle[featured.category] || badgeStyle.news) : badgeStyle.news;
  const featuredVoice = featured ? picksBySlug.get(featured.id) || null : null;
  // ⚠ `stored` is deliberately null here. resolveVoiceIdentity's last rung is the
  // comment's own authorName copy, and this surface does not have one and must
  // not acquire one: a name copied into comment_screening at screening time and
  // never refreshed would be exactly the disease R33 found in the Square, only
  // staler. So a reader whose users/{uid} holds no name at all simply does not
  // appear on a card — measured, that is 44 of 1,830 comments — and the story
  // shows the next voice in its shuffle instead.
  const featuredPerson = featuredVoice
    ? resolveVoiceIdentity(voicePeople.get(featuredVoice.uid), null)
    : null;

  return (
    <div style={{ background: '#0a0a0a', minHeight: '100vh', color: '#fff', fontFamily: "Cormorant Garamond, Georgia, serif" }}>
      <style>{`
        @media (max-width: 1024px) { .nav-desktop { display: none !important; } .nav-hamburger { display: flex !important; } }
        @media (min-width: 1025px) { .nav-desktop { display: flex !important; } .nav-hamburger { display: none !important; } }
        .top10-scroll { scrollbar-width: none; } .top10-scroll::-webkit-scrollbar { display: none; }
        .just-added-scroll { scrollbar-width: none; } .just-added-scroll::-webkit-scrollbar { display: none; }
        .sq-banner-desktop { display: block; }
        .sq-fab-mobile { display: none; }
        @media (max-width: 1024px) {
          .sq-banner-desktop { display: none !important; }
          .sq-fab-mobile { display: flex !important; }
        }
        /* Retired below the tab-bar breakpoint — see the FAB comment at the render site. */
        @media (max-width: 767px) { .sq-fab-mobile { display: none !important; } }
        @keyframes sq-pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes sq-lockglow { 0%,100%{background:rgba(107,47,173,0.1)} 50%{background:rgba(107,47,173,0.22)} }
        @keyframes sq-lockglow-icon { 0%,100%{opacity:0.6} 50%{opacity:1} }
      `}</style>

      <Navbar />

      {/* Hero Carousel — renders only when CMS data lands. Hero CMS wiring tracked for a later phase. */}
      {carousel.length > 0 && featured && (
      <section style={{ position: 'relative', height: '88vh', minHeight: 600, overflow: 'hidden' }}>
        {carousel.map((s, i) => (
          <img key={s.id} src={s.cover} alt={s.title}
            fetchPriority={i === heroIndex ? 'high' : 'low'} decoding="async"
            style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%',
              objectFit: 'cover', objectPosition: 'center top',
              filter: 'brightness(0.55)',
              opacity: i === heroIndex ? (heroTransition ? 1 : 0) : 0,
              transition: 'opacity 0.7s ease',
              zIndex: 0,
            }} />
        ))}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(105deg, rgba(10,10,10,0.85) 0%, rgba(10,10,10,0.5) 60%, transparent 100%)', zIndex: 1 }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, #0a0a0a 0%, transparent 45%)', zIndex: 1 }} />

        <div className={cardEntering ? 'hero-card-enter' : undefined} style={{
          position: 'absolute', bottom: '12%', left: '4%', maxWidth: 560, zIndex: 2,
          // Hidden while a trailer plays so it can't bleed through the layer's
          // fade-in; the hero-card-enter animation drives opacity on dissolve.
          opacity: heroTransition && !isTrailerStep ? 1 : 0,
          transform: heroTransition ? 'translateY(0)' : 'translateY(12px)',
          transition: 'opacity 0.5s ease, transform 0.5s ease',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
            <span style={{ width: 3, height: 18, background: 'linear-gradient(to bottom, #c9a84c, #9a7b2e)', borderRadius: 2, display: 'inline-block' }} />
            <span style={{ fontFamily: LABEL, fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.3em', color: '#c9a84c' }}>Featured Story</span>
          </div>
          <h1 style={{ fontFamily: DISPLAY, fontSize: 'clamp(2rem, 4.5vw, 3.4rem)', fontWeight: 600, lineHeight: 1.1, marginBottom: '0.75rem', color: '#ffffff', textShadow: '0 2px 30px rgba(0,0,0,0.6)' }}>
            {featured.title}
          </h1>
          <p style={{ fontFamily: BODY, color: 'rgba(255,255,255,0.8)', fontSize: '0.95rem', marginBottom: '1.75rem' }}>
            By {featured.author} · {featured.date}
          </p>
          <a href={featured.url} style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.6rem',
            background: '#fff', color: '#0a0a0a',
            padding: '0.8rem 2rem', borderRadius: 4,
            fontFamily: LABEL, fontSize: '0.72rem', letterSpacing: '0.16em', textTransform: 'uppercase',
            textDecoration: 'none', transition: 'all 0.2s',
            boxShadow: '0 4px 20px rgba(255,255,255,0.15)',
          }}
            onMouseEnter={e => { e.currentTarget.style.background = '#f5ecd2'; e.currentTarget.style.transform = 'scale(1.03)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.transform = 'scale(1)'; }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" style={{ display: 'inline-block', verticalAlign: 'middle' }}><polygon points="5 3 19 12 5 21 5 3"/></svg>
            Read Now
          </a>
        </div>

        {/* Trailer interstitial — covers the hero card while playing, then
            dissolves out over the same story's entering card. Dots/arrows
            (rendered after, same z-index) stay on top throughout. */}
        {(isTrailerStep || trailerDissolving) && featured && !reducedMotion && (
          <HeroTrailer
            key={`${featured.id}-${pageVisible}`}
            story={featured}
            dissolving={trailerDissolving}
            voice={featuredVoice}
            person={featuredPerson}
            pin={quotePin}
          />
        )}

        <div style={{ position: 'absolute', bottom: '5%', left: '4%', zIndex: 3, display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          {/* 10 dots now — slightly smaller/tighter than the 5-dot sizing so the
              row stays comfortable next to the arrows on a 390px viewport. */}
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            {carousel.map((_, i) => (
              <button key={i} onClick={() => goTo(i)} style={{
                width: i === heroIndex ? 20 : 6, height: 4, borderRadius: 2,
                border: 'none', cursor: 'pointer',
                background: i === heroIndex ? '#a855f7' : 'rgba(255,255,255,0.3)',
                transition: 'all 0.3s ease', padding: 0,
              }} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={() => goTo(isTrailerStep ? heroIndex : (heroIndex - 1 + carousel.length) % carousel.length)}
              style={{ width: 36, height: 36, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.4)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(8px)', transition: 'all 0.2s' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(124,58,237,0.4)'; e.currentTarget.style.borderColor = 'rgba(124,58,237,0.6)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.4)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <button onClick={() => goTo(isTrailerStep ? heroIndex : (heroIndex + 1) % carousel.length)}
              style={{ width: 36, height: 36, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.4)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(8px)', transition: 'all 0.2s' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(124,58,237,0.4)'; e.currentTarget.style.borderColor = 'rgba(124,58,237,0.6)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.4)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
        </div>
      </section>
      )}

      {/* Square Banner — desktop only */}
      <div className="sq-banner-desktop">
        <SquareBanner squareOpen={squareOpen} countdown={countdown} />
      </div>

      {/* Just Added */}
      {allStories.length === 0 ? (
        <JustAddedSkeleton />
      ) : (
      <section style={{ padding: '0.75rem 0' }}>
        <div data-reveal="up" style={{ paddingLeft: '4%', marginBottom: '0.75rem' }}>
          <span style={kickerStyle}>FRESH OFF THE PRESS</span>
          <h3 style={sectionTitleStyle}>Just Added</h3>
        </div>
        <div className="just-added-scroll" style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingLeft: '4%', paddingRight: '4%', paddingBottom: '0.5rem', scrollbarWidth: 'none' }}>
          {[...allStories].sort((a,b) => getStorySortTime(b)-getStorySortTime(a)).slice(0,8).map((s, i) => <JustAddedCard key={s.id} story={s} userTier={userTiersMap[s.id]?.tier ?? null} scorePct={userTiersMap[s.id]?.scorePct} data-reveal="up" data-reveal-delay={(i % 4) + 1} />)}
        </div>
      </section>
      )}

      {/* Summer Reading Program — sits above Top Readers because it is the
          reason to care about the strip below it during August. Self-hides
          outside the contest window. */}
      <SummerProgramBanner />

      {/* Top Readers */}
      <TopReadersStrip />

      {/* Top 10 */}
      {allStories.length === 0 ? (
        <Top10Skeleton />
      ) : (
      <section style={{ padding: '1rem 0' }}>
        <div data-reveal="up" style={{ padding: '0 4%', marginBottom: '1rem' }}>
          <span style={kickerStyle}>TOP ON THE SHELF</span>
          <h3 style={sectionTitleStyle}>Top 10 Stories</h3>
        </div>
        <div className="top10-scroll" style={{ display: 'flex', gap: '0', overflowX: 'auto', paddingLeft: '4%', paddingRight: '4%', paddingBottom: '0.5rem' }}>
          {top10.map((s, i) => <Top10Card key={s.id} s={s} i={i} userTier={userTiersMap[s.id]?.tier ?? null} scorePct={userTiersMap[s.id]?.scorePct} data-reveal="up" data-reveal-delay={(i % 6) + 1} />)}
        </div>
      </section>
      )}


      {allStories.length === 0 ? (
        <RowSkeleton title="Flash Fiction" kicker="THE FLASH" />
      ) : (
        <Row title="Flash Fiction" kicker="THE FLASH" stories={allStories.filter(s => s.category === 'flash')} seeAll="/flash" userTiersMap={userTiersMap} />
      )}
      {allStories.length === 0 ? (
        <RowSkeleton title="Short Stories" kicker="THE SHELF" />
      ) : (
        <Row title="Short Stories" kicker="THE SHELF" stories={allStories.filter(s => s.category === 'short')} seeAll="/short" userTiersMap={userTiersMap} />
      )}
      {allStories.length === 0 ? (
        <RowSkeleton title="Poetry" kicker="THE VERSE" />
      ) : (
        <Row title="Poetry" kicker="THE VERSE" stories={allStories.filter(s => s.category === 'poetry')} seeAll="/poetry" userTiersMap={userTiersMap} />
      )}
      {allStories.length === 0 ? (
        <RowSkeleton title="News & Updates" kicker="THE BRIEF" />
      ) : (
        <Row title="News & Updates" kicker="THE BRIEF" stories={allStories.filter(s => s.category === 'news')} seeAll="/news" userTiersMap={userTiersMap} />
      )}
      {allStories.length === 0 ? (
        <RowSkeleton title="Inspiring Stories" kicker="THE LIGHT" />
      ) : (
        <Row title="Inspiring Stories" kicker="THE LIGHT" stories={allStories.filter(s => s.category === 'inspiring')} seeAll="/inspiring" userTiersMap={userTiersMap} />
      )}
      {/* THE SERIES — in the slot the Book Reader Collection held, which was the last content
          row, after Inspiring Stories and before Subscribe. That row was
          `allStories.filter(s => s.readerMode === true)` with a "THE COLLECTION" kicker and a
          See-all to /book-reader; it self-hid at zero, and the pull took it to zero, so this
          replaces an empty slot rather than displacing anything.

          It is NOT a <Row>. That component maps its `stories` through <StoryCard>, which reads
          a cms_stories shape — s.url, s.id, the quiz pill, the reader's quiz tier. A series is
          a different record in a different node: slug, poster, and a released count derived at
          read time. Feeding one to the other would have needed a fake story object per series,
          and the first field StoryCard gained would have broken it silently. */}
      <SeriesRow />

      {allStories.filter(s => s.readerMode === true).length > 0 && (
        <Row title="Book Reader" kicker="THE COLLECTION" stories={allStories.filter(s => s.readerMode === true)} seeAll="/book-reader" userTiersMap={userTiersMap} />
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          OPEN PAGES — BELOW EVERYTHING THE HOUSE PUBLISHED, ABOVE THE FURNITURE.
          ═══════════════════════════════════════════════════════════════════════
          THE DEFECT THIS FIXES, measured on the live page: the heading sat at
          4,295px of a 5,106px document — 84.1% down, twelve headings above it and
          none below, BELOW THE SUBSCRIBE BLOCK. A row a reader only reaches after
          passing the newsletter signup is not a row, and three months produced seven
          pieces.

          ⚠ THE 2026 RULING, AS IKENNA HAS NOW SETTLED IT — READ THIS BEFORE MOVING
          THE ROW AGAIN. It protects THE HOUSE'S PUBLISHED WORK, ALL OF IT, and not
          merely the editorial front.

          R38 first placed this row directly under Top 10 and above the genre rows, on
          the reading that Flash Fiction, Short Stories and Poetry are FILTERS over the
          catalogue rather than a further act of curation. That reading is defensible
          and it is wrong: those rows ARE the house's catalogue — the work it
          commissioned, edited and published. Open Pages above them tells a reader the
          island values community writing more than its own published work, which is
          neither true nor what the ruling was protecting. That placement was reverted
          the same day.

          ⚠ AND WHY HERE RATHER THAN AT THE FOOT, which is the other thing not to
          re-argue: not because Open Pages is lesser, but because it is THE ROAD INTO
          THE HOUSE. That is the whole reasoning behind R38's copy — "when a piece
          belongs in the house, we come and ask". A road into the house belongs at the
          end of the house's own shelves and before the furniture, where a reader who
          has just finished looking at what the island publishes meets the invitation
          to write for it. Below the signup it is furniture; above the catalogue it is
          a claim the house does not make.

          So: below every genre row, below The Series and the Book Reader collection,
          ABOVE the subscribe block. ⚠ ASSERTED IN BOTH DIRECTIONS in
          tests/openpages/distribution.test.mjs — a later round cannot quietly raise it
          above the catalogue or drop it back beneath the furniture. */}
      <OpenPagesRow />

      {/* Subscribe */}
      <section id="subscribe" style={{
        padding: '3rem 4%',
        borderTop: '1px solid rgba(107,47,173,0.2)',
      }}>
        <div style={{
          maxWidth: 480,
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '0.75rem',
        }}>
          <span style={{
            fontFamily: LABEL,
            fontSize: '0.55rem',
            letterSpacing: '0.3em',
            textTransform: 'uppercase',
            color: '#c9a84c',
          }}>The Dispatch</span>
          <h2 data-reveal="fade" style={{
            fontFamily: DISPLAY,
            fontSize: '1.6rem',
            fontWeight: 600,
            color: '#f5f0e8',
            lineHeight: 1.1,
            textAlign: 'center',
            margin: 0,
          }}>Never miss a story.</h2>
          <p style={{
            fontFamily: BODY,
            fontSize: '0.8rem',
            color: 'rgba(245,240,232,0.5)',
            textAlign: 'center',
            margin: '0 0 0.5rem',
            lineHeight: 1.6,
          }}>New stories, straight to your inbox.</p>
          <div data-reveal="fade" style={{
            display: 'flex',
            gap: '0.5rem',
            width: '100%',
            maxWidth: 400,
          }}>
            <input
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubscribe()}
              style={{
                flex: 1,
                padding: '0.65rem 1rem',
                borderRadius: 8,
                border: '1px solid rgba(107,47,173,0.3)',
                background: 'rgba(107,47,173,0.08)',
                color: '#f5f0e8',
                fontSize: '0.8rem',
                outline: 'none',
                fontFamily: BODY,
              }}
            />
            <button
              onClick={handleSubscribe}
              style={{
                background: '#6b2fad',
                color: '#f5f0e8',
                padding: '0.65rem 1.25rem',
                borderRadius: 8,
                border: 'none',
                fontFamily: LABEL,
                fontSize: '0.55rem',
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Subscribe
            </button>
          </div>
          {subscribeStatus && (
            <p style={{
              fontSize: '0.75rem',
              color: subscribeStatus.includes('Thank') ? '#a3e635' : '#f87171',
              margin: 0,
            }}>
              {subscribeStatus}
            </p>
          )}
        </div>
      </section>

      {/* Footer */}
      <Footer />

      {/* FAB — the tablet band only. Below 768px the SQUARE tab in the bottom bar carries
          this, and the FAB would sit on top of it (same corner, same z-index). */}
      <div className="sq-fab-mobile">
        <SquareFAB squareOpen={squareOpen} countdown={countdown} />
      </div>

      <TabBar />
    </div>
  );
}