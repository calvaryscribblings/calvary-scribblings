'use client';
// THE LOCK — one component for the story archive (cream) and the Series (dark). W9.
// Every number, colour and word is in app/lib/archiveLock.js; this file only draws them.
//
//   <ArchiveLock theme="cream" fade eyebrow headline body cta={{ label, href | onClick }}
//                signIn={fn | null} />
//
// `fade` draws the gradient over the last lines of the preview above it (story pages). It spans
// the full width of its container — put the lock directly inside the text column, with no side
// padding of its own, and the fade covers exactly the measure.
//
// `data-archive-lock` marks the BLOCK (mark → CTA), which the founder-preview pill steps aside
// from (app/components/GatePreview.js) so the two never overlap.

import { useEffect, useRef, useState } from 'react';
import {
  LOCK_THEMES, LOCK_RHYTHM as R, LOCK_MAX_WIDTH, LOCK_REVEAL_MS, LOCK_GLYPH as G,
  fadeGradient, glowGradient,
} from '../lib/archiveLock';

const LABEL = "'Cinzel', 'Cormorant Garamond', Georgia, serif";
const SERIF = "'Cormorant Garamond', Georgia, serif";

export function LockGlyph({ color, size = R.glyph }) {
  return (
    <svg width={size} height={size} viewBox={G.viewBox} fill="none" aria-hidden="true" focusable="false"
      style={{ display: 'block' }}>
      <rect x={G.body.x} y={G.body.y} width={G.body.width} height={G.body.height} rx={G.body.rx}
        stroke={color} strokeWidth={R.stroke} />
      <path d={G.shackle} stroke={color} strokeWidth={R.stroke} strokeLinecap="round" />
      <circle cx={G.keyhole.cx} cy={G.keyhole.cy} r={G.keyhole.r} fill={color} />
    </svg>
  );
}

export default function ArchiveLock({
  theme = 'cream', fade = false, eyebrow, headline, body, cta, signIn = null, children,
}) {
  const t = LOCK_THEMES[theme] || LOCK_THEMES.cream;
  const ref = useRef(null);
  // Revealed when it scrolls into view. Starts shown if there is no observer to tell us, so a
  // browser that cannot observe never hides the lock.
  // (The lock only ever renders on the client — after the gate answers — so reading the global
  // in the initial state cannot disagree with a server render.)
  const [shown, setShown] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setShown(true); io.disconnect(); }
    }, { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const scope = `al-${theme}`;
  return (
    <div className={`archive-lock ${scope}`} style={{ position: 'relative', textAlign: 'center' }}>
      <style>{`
        .${scope} .al-cta { transition: background-color 200ms ease, color 200ms ease; }
        .${scope} .al-cta:hover, .${scope} .al-cta:focus-visible { background: ${t.ctaHoverWash}; }
        .${scope} .al-cta:focus-visible, .${scope} .al-link:focus-visible { outline: 1px solid ${t.cta}; outline-offset: 3px; }
        .${scope} .al-link:hover { text-decoration-thickness: 1px; color: ${t.headline}; }
        .archive-lock .al-block { opacity: 0; transform: translateY(8px); }
        .archive-lock .al-block.is-shown { animation: alFadeUp ${LOCK_REVEAL_MS}ms cubic-bezier(0.22, 1, 0.36, 1) both; }
        @keyframes alFadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) {
          .archive-lock .al-block, .archive-lock .al-block.is-shown { opacity: 1; transform: none; animation: none; }
        }
      `}</style>

      {fade && (
        <>
          {/* Over the last lines of the preview; the exact ground, full measure, no edges. */}
          <div aria-hidden="true" data-archive-fade="" style={{
            height: R.fadeHeight, marginTop: -R.fadeHeight, width: '100%',
            position: 'relative', pointerEvents: 'none', background: fadeGradient(t.ground),
          }} />
          <div aria-hidden="true" style={{ height: R.fadeToMark }} />
        </>
      )}

      <div ref={ref} data-archive-lock="" className={`al-block${shown ? ' is-shown' : ''}`}
        style={{ position: 'relative', maxWidth: LOCK_MAX_WIDTH, margin: '0 auto', padding: '0 16px 48px' }}>
        {/* The glow sits behind the block and fades out inside its own box. */}
        <div aria-hidden="true" style={{
          position: 'absolute', left: '50%', top: -40, width: 'min(640px, 100vw)', height: 'calc(100% + 80px)',
          transform: 'translateX(-50%)', background: glowGradient(t.glow), pointerEvents: 'none', zIndex: 0,
        }} />
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div data-lock-mark="" style={{
            width: R.mark, height: R.mark, margin: '0 auto', borderRadius: '50%',
            boxShadow: `inset 0 0 0 1px ${t.ring}`, background: t.wash,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <LockGlyph color={t.glyph} />
          </div>

          <p data-lock-eyebrow="" style={{
            margin: `${R.markToEyebrow}px 0 0`, fontFamily: LABEL, fontSize: 11, lineHeight: '16px',
            letterSpacing: '0.24em', textTransform: 'uppercase', color: t.eyebrow, fontWeight: 400,
          }}>{eyebrow}</p>

          <h2 data-lock-headline="" style={{
            margin: `${R.eyebrowToHeadline}px 0 0`, fontFamily: SERIF, fontWeight: 300,
            fontSize: 'clamp(30px, 1.2vw + 25px, 34px)', lineHeight: 1.18, color: t.headline, letterSpacing: '0.005em', textWrap: 'balance',
          }}>{headline}</h2>

          {body && (
            <p data-lock-body="" style={{
              margin: `${R.headlineToBody}px auto 0`, maxWidth: 440, fontFamily: SERIF, fontSize: 18,
              lineHeight: 1.55, color: t.body, textWrap: 'pretty',
            }}>{body}</p>
          )}

          {children}

          {cta && (
            <div style={{ marginTop: R.bodyToCta }}>
              {cta.href ? (
                <a href={cta.href} className="al-cta" data-lock-cta="" style={ctaStyle(t)}>{cta.label}</a>
              ) : (
                <button type="button" onClick={cta.onClick} className="al-cta" data-lock-cta="" style={ctaStyle(t)}>{cta.label}</button>
              )}
            </div>
          )}

          {signIn && (
            <p data-lock-signin="" style={{ margin: `${R.ctaToSignIn}px 0 0`, fontFamily: SERIF, fontSize: 16, lineHeight: '24px', color: t.body }}>
              {signIn.label[0]}{' '}
              <button type="button" onClick={signIn.onClick} className="al-link" style={{
                background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit',
                color: t.link, textDecoration: 'underline', textUnderlineOffset: 3, textDecorationThickness: '0.5px',
              }}>{signIn.label[1]}</button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function ctaStyle(t) {
  return {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box',
    height: R.ctaHeight, padding: '0 32px', minWidth: 216, borderRadius: 2,
    background: 'transparent', border: `1px solid ${t.ctaBorder}`, color: t.cta, cursor: 'pointer',
    fontFamily: LABEL, fontSize: 12, letterSpacing: '0.22em', textTransform: 'uppercase',
    textDecoration: 'none', lineHeight: 1,
  };
}
