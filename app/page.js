'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from './lib/AuthContext';
import AuthModal from './components/AuthModal';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import QuizPill from './components/QuizPill';
import { useUserStoryTiers } from './lib/useUserStoryTiers';
import { db } from './lib/firebase';
import { ref, get, onValue } from 'firebase/database';
import { resolveAuthorNames, withCurrentAuthorNames } from './lib/resolveAuthorNames';
import { normalizeGenre } from './lib/openPages';

// ── Typography system ───────────────────────────────────────────────────────
// DISPLAY for headings/titles, LABEL for kickers/badges/controls, BODY for meta.
const DISPLAY = "'Cormorant Garamond', Georgia, serif";
const LABEL = "'Cinzel', 'Cormorant Garamond', Georgia, serif";
const BODY = "'Cochin', Georgia, serif";

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

// Stories source of truth: cms_stories/ in Firebase RTDB.
// This component fetches on mount via the useEffect below.
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

function getHourlyCarousel(stories) {
  if (!stories || stories.length === 0) return [];
  const h = Math.floor(Date.now() / 3600000);
  const sorted = [...stories].sort((a, b) => parseDate(b.date) - parseDate(a.date));
  return [...sorted]
    .sort((a, b) => ((a.id.charCodeAt(0) * h) % 13) - ((b.id.charCodeAt(0) * h) % 13))
    .slice(0, 5);
}

// ── Featured-story trailer ──────────────────────────────────────────────────
// Every third hero slot is a trailer: the next story's trailerQuote animates
// word by word over its blurred cover, then dissolves into that story's card.
// The rotation is a sequence of steps over the carousel — cards keep their
// duration, trailers get a computed one. Trailer steps share the story's dot.

const HERO_CARD_MS = 5000;
const TRAILER_CAP_MS = 8000;
const TRAILER_DISSOLVE_MS = 900;

function getTrailerDuration(quote) {
  const wordCount = quote.trim().split(/\s+/).filter(Boolean).length;
  const hold = Math.max(1600, Math.min(3200, wordCount * 120));
  // leadIn 350 + words×150 + rule 450 + attribution 300 + hold, capped.
  return Math.min(350 + wordCount * 150 + 750 + hold, TRAILER_CAP_MS);
}

// Steps: { type: 'card'|'trailer', storyIndex, duration }. After every 2 cards,
// if the next story has a non-empty trailerQuote, its card is preceded by a
// trailer step. Stories without a quote never get one. Under reduced motion
// the sequence is cards only — rotation behaves exactly as before.
function buildHeroSequence(carousel, reducedMotion) {
  const seq = [];
  let cardsSinceTrailer = 0;
  carousel.forEach((s, storyIndex) => {
    const quote = typeof s.trailerQuote === 'string' ? s.trailerQuote.trim() : '';
    if (!reducedMotion && cardsSinceTrailer >= 2 && quote) {
      seq.push({ type: 'trailer', storyIndex, duration: getTrailerDuration(quote) });
      cardsSinceTrailer = 0;
    }
    seq.push({ type: 'card', storyIndex, duration: HERO_CARD_MS });
    cardsSinceTrailer++;
  });
  return seq;
}

// The trailer layer: blurred slow-zooming cover (or aurora fallback), staggered
// word reveal, gold rule, attribution. Stays mounted through the dissolve into
// the card (same story, so `story` doesn't change across that boundary).
function HeroTrailer({ story, dissolving }) {
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
          src={story.cover}
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
      <div style={{ position: 'absolute', left: '4%', right: '4%', bottom: '16%', maxWidth: 640, zIndex: 1 }}>
        <p style={{
          fontFamily: DISPLAY, fontWeight: 500,
          fontSize: 'clamp(1.5rem, 3.5vw, 2.4rem)',
          color: '#f5f0e8', lineHeight: 1.45, margin: 0,
          textShadow: '0 2px 24px rgba(107,47,173,0.5)',
        }}>
          {words.map((w, i) => (
            <span key={i} className="trailer-word" style={{ animationDelay: `${350 + i * 150}ms` }}>
              {w}{i < words.length - 1 ? ' ' : ''}
            </span>
          ))}
        </p>
        <div className="trailer-rule" style={{ animationDelay: `${ruleDelay}ms` }} />
        <div className="trailer-attr" style={{ animationDelay: `${attrDelay}ms` }}>
          from {story.title} · {story.author}
        </div>
      </div>
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
      <img src={story.cover} alt={story.title}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 80, background: 'linear-gradient(to top, rgba(8,6,16,0.95), transparent)' }} />
      {isNew(story) && (
        <span style={{ ...newBadgeStyle, top: 8, left: 8 }}>New</span>
      )}
      <QuizPill hasQuiz={story.quizMeta?.hasQuiz || false} userTier={userTier} scribblesReward={story.quizMeta?.scribblesReward || 50} scorePct={scorePct} />
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
        <img src={story.cover} alt={story.title}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        {isNew(story) && (
          <span style={{ ...newBadgeStyle, top: 10, left: 10 }}>New</span>
        )}
        <QuizPill hasQuiz={story.quizMeta?.hasQuiz || false} userTier={userTier} scribblesReward={story.quizMeta?.scribblesReward || 50} scorePct={scorePct} />
      </div>
      <div style={{ marginTop: 10, padding: '0 2px' }}>
        <div style={{ fontFamily: DISPLAY, fontSize: '0.88rem', fontWeight: 600, lineHeight: 1.3, color: '#f5f0e8', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{story.title}</div>
        <div style={{ ...cardAuthorStyle, fontSize: '0.65rem', marginTop: 4 }}>{story.author}</div>
      </div>
    </a>
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
        {stories.map((s, i) => <StoryCard key={s.id} story={s} userTier={userTiersMap[s.id]?.tier ?? null} scorePct={userTiersMap[s.id]?.scorePct} data-reveal="up" data-reveal-delay={(i % 6) + 1} />)}
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
            fontFamily="Georgia, serif" fontSize="120" fontWeight="900"
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
          <img src={s.cover} alt={s.title} style={{
            width: '100%', height: '100%', objectFit: 'cover', display: 'block',
            filter: active ? 'brightness(0.85)' : 'brightness(1)',
            transition: 'filter 0.3s',
          }} />
        </div>
        <QuizPill hasQuiz={s.quizMeta?.hasQuiz || false} userTier={userTier} scribblesReward={s.quizMeta?.scribblesReward || 50} scorePct={scorePct} />
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
            <div style={{ fontFamily: 'Georgia, serif', fontSize: 15, color: squareOpen ? '#f5f0e8' : 'rgba(255,255,255,0.35)', marginBottom: 3 }}>
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
          <div style={{ fontFamily: 'Georgia, serif', fontSize: 15, color: 'rgba(155,109,255,0.55)', flexShrink: 0, whiteSpace: 'nowrap' }}>
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
                  fontFamily: 'Cochin, Georgia, serif',
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
const OP_SERIF = "'Cormorant Garamond', 'Cochin', Georgia, serif";
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

function OpenPagesCard({ post, counts, photo }) {
  const [hover, setHover] = useState(false);
  const likeCount = counts?.reactionCount ?? 0;
  const commentCount = counts?.commentCount ?? 0;
  const initial = (post.authorName || '?').trim().charAt(0).toUpperCase();

  // Real profile photo (28px circle) when present, else the gradient initial.
  const avatarEl = photo ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={photo} alt="" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, display: 'block', border: '1px solid rgba(245,240,232,0.1)' }} />
  ) : (
    <span style={opAvatarDot}>{initial}</span>
  );

  return (
    <a
      href={`/open-pages/${post.id}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        textDecoration: 'none', flexShrink: 0, width: 210, minWidth: 210,
        display: 'flex', flexDirection: 'column',
        background: hover ? 'rgba(201,168,76,0.06)' : 'rgba(255,255,255,0.03)',
        border: `1px solid ${hover ? 'rgba(201,168,76,0.3)' : 'rgba(255,255,255,0.06)'}`,
        borderRadius: 10, overflow: 'hidden', transition: 'all 0.25s ease',
      }}
    >
      {post.coverImage ? (
        <img src={post.coverImage} alt="" style={{ width: '100%', height: 118, objectFit: 'cover', display: 'block', background: '#1a1326' }} />
      ) : (
        <div style={{ width: '100%', height: 118, background: 'linear-gradient(135deg, #1a1326, #0d0916)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="rgba(201,168,76,0.3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12.67 19a2 2 0 0 0 1.416-.588l6.154-6.172a6 6 0 0 0-8.49-8.49L5.586 9.914A2 2 0 0 0 5 11.328V18a1 1 0 0 0 1 1z" />
            <path d="M16 8 2 22" />
            <path d="M17.5 15H9" />
          </svg>
        </div>
      )}
      <div style={{ padding: '0.7rem 0.8rem 0.85rem', display: 'flex', flexDirection: 'column', gap: 7, flex: 1 }}>
        <span style={{
          alignSelf: 'flex-start', fontFamily: OP_CINZEL, fontSize: '0.56rem', letterSpacing: '0.1em',
          textTransform: 'uppercase', color: OP_GOLD, background: 'rgba(201,168,76,0.1)',
          border: '1px solid rgba(201,168,76,0.3)', borderRadius: 999, padding: '0.18rem 0.55rem',
        }}>
          {normalizeGenre(post.genre)}
        </span>
        <div style={{
          fontFamily: OP_SERIF, fontSize: '1.05rem', fontWeight: 600, color: '#fff', lineHeight: 1.2,
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {post.title}
        </div>
        <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 7 }}>
          {avatarEl}
          <span style={{ fontFamily: DISPLAY, flex: 1, minWidth: 0, fontSize: '0.72rem', color: 'rgba(255,255,255,0.5)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {post.authorName || 'Reader'} · {opTimeAgo(post.createdAt)}
          </span>
          <span style={opCountRow}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle' }}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              {post.readCount || 0}
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle' }}><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
              {likeCount}
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle' }}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              {commentCount}
            </span>
          </span>
        </div>
      </div>
    </a>
  );
}

function OpenPagesRow() {
  const [posts, setPosts] = useState(null);
  // Per-post engagement counts (postId -> { commentCount, reactionCount }) and
  // author photos (authorUid -> url|null) — fetched in a second pass, exactly as
  // the feed (app/open-pages/page.jsx) does it.
  const [counts, setCounts] = useState({});
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

        // Comment + like counts: one read each per post, count the keys.
        const entries = await Promise.all(list.map(async (p) => {
          try {
            const [cSnap, rSnap] = await Promise.all([
              get(ref(db, `comments/${p.id}`)),
              get(ref(db, `open_pages_reactions/${p.id}`)),
            ]);
            const commentCount = cSnap.exists() ? Object.keys(cSnap.val()).length : 0;
            const reactionCount = rSnap.exists() ? Object.keys(rSnap.val()).length : 0;
            return [p.id, { commentCount, reactionCount }];
          } catch {
            return [p.id, { commentCount: 0, reactionCount: 0 }];
          }
        }));
        if (cancelled) return;
        setCounts(Object.fromEntries(entries));

        // Author avatars: one read per unique author at users/{uid} for the real
        // profile photo (avatarUrl/photoURL), same source as the feed.
        const uids = [...new Set(list.map((p) => p.authorUid).filter(Boolean))];
        const photoEntries = await Promise.all(uids.map(async (uid) => {
          try {
            const s = await get(ref(db, `users/${uid}`));
            const v = s.exists() ? s.val() : null;
            return [uid, v ? v.avatarUrl || v.photoURL || null : null];
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
        {posts.map(p => <OpenPagesCard key={p.id} post={p} counts={counts[p.id]} photo={authorPhotos[p.authorUid]} />)}
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
    const storiesRef = ref(db, 'cms_stories');
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

  useEffect(() => {
    setCarousel(getHourlyCarousel(allStories));
    const hourTimer = setInterval(() => {
      setSeqIdx(0);
      setCarousel(getHourlyCarousel(allStories));
    }, 3600000);
    return () => clearInterval(hourTimer);
  }, [allStories]);

  // Rotation sequence: cards + trailer interstitials over the hourly carousel.
  const sequence = useMemo(() => buildHeroSequence(carousel, reducedMotion), [carousel, reducedMotion]);

  // Keep seqIdx in range when the sequence shrinks (hourly reshuffle, CMS update).
  useEffect(() => {
    if (sequence.length > 0 && seqIdx >= sequence.length) setSeqIdx(0);
  }, [sequence, seqIdx]);

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
  // is skipped straight to its card, never replayed.
  const goTo = useCallback((storyIdx) => {
    setTrailerDissolving(false);
    setCardEntering(false);
    setHeroTransition(false);
    setTimeout(() => {
      const idx = sequence.findIndex(st => st.type === 'card' && st.storyIndex === storyIdx);
      setSeqIdx(idx >= 0 ? idx : 0);
      setHeroTransition(true);
    }, 300);
  }, [sequence]);

  // Auto-advance: each step schedules its own timeout (cards 5s, trailers their
  // computed duration). A finished trailer dissolves into its card; a card
  // hands off with the existing 300ms cross-fade.
  useEffect(() => {
    if (sequence.length === 0 || !pageVisible) return;
    const cur = seqIdx < sequence.length ? seqIdx : 0;
    const step = sequence[cur];
    let inner;
    const timer = setTimeout(() => {
      const next = (cur + 1) % sequence.length;
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

  return (
    <div style={{ background: '#0a0a0a', minHeight: '100vh', color: '#fff', fontFamily: "'Cochin', Georgia, serif" }}>
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
          <HeroTrailer key={`${featured.id}-${pageVisible}`} story={featured} dissolving={trailerDissolving} />
        )}

        <div style={{ position: 'absolute', bottom: '5%', left: '4%', zIndex: 3, display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            {carousel.map((_, i) => (
              <button key={i} onClick={() => goTo(i)} style={{
                width: i === heroIndex ? 24 : 8, height: 4, borderRadius: 2,
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

        <div style={{
          position: 'absolute', right: '3%', top: '50%', transform: 'translateY(-50%)',
          zIndex: 3, display: 'flex', flexDirection: 'column', gap: '0.6rem',
        }}>
          {carousel.map((s, i) => (
            <button key={s.id} onClick={() => goTo(i)} style={{
              width: 56, height: 72, borderRadius: 6, overflow: 'hidden', border: 'none',
              cursor: 'pointer', padding: 0,
              opacity: i === heroIndex ? 1 : 0.45,
              transform: i === heroIndex ? 'scale(1.08)' : 'scale(1)',
              transition: 'all 0.3s ease',
              boxShadow: i === heroIndex ? '0 0 0 2px #a855f7, 0 8px 24px rgba(0,0,0,0.6)' : '0 4px 12px rgba(0,0,0,0.4)',
            }}>
              <img src={s.cover} alt={s.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </button>
          ))}
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
      {allStories.filter(s => s.readerMode === true).length > 0 && (
        <Row title="Book Reader" kicker="THE COLLECTION" stories={allStories.filter(s => s.readerMode === true)} seeAll="/book-reader" userTiersMap={userTiersMap} />
      )}

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

      {/* Open Pages — community stories, the last content section before the footer */}
      <OpenPagesRow />

      {/* Footer */}
      <Footer />

      {/* FAB — mobile only */}
      <div className="sq-fab-mobile">
        <SquareFAB squareOpen={squareOpen} countdown={countdown} />
      </div>
    </div>
  );
}