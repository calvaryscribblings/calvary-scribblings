'use client';
// Voices of the Island — the card gallery, and the departure half of the island morph.
//
// Seeded with the roster as it stood at build (initialNode), then re-read live on mount
// so the CMS stays live truth. The seed is what gives the morph its geometry at first
// paint; it is not the source of record.
import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { db } from '../lib/firebase';
import { publishedVoices, voiceTransitionName, prefersReducedMotion } from '../lib/voices';

// The cards are 1080×1350 social assets. Both dimensions are passed to every <img> so
// the grid reserves the right aspect ratio before any image lands.
const CARD_W = 1080;
const CARD_H = 1350;

// Entrance, mirroring the story page: content enters on readiness, once, on the
// wrapper only. Deliberately not a scroll reveal — the grid is above the fold.
const GRID_ENTER_MS = 650;

// ── THE DEPARTURE ────────────────────────────────────────────────────────────────
//
// CANONICAL GRAMMAR — the press and the recede are founded here, not borrowed. Nothing
// else in the app presses or recedes on this pattern today; the gateway doors have no
// tap acknowledgment at all, and their exit drops the room to opacity 0 with no scale.
// These two are the source of truth, and other surfaces (the gateway included) are meant
// to adopt them in a later pass. Change them here and the island changes with them.
//
//   PRESS  — the chosen card yields under the finger (0.985) before it takes command
//            (1.02). An acknowledgment: the island felt that.
//   RECEDE — every other card steps back (0.35 / 0.97). The chosen thing comes forward,
//            the room withdraws around it. Not a fade-out; a deference.
//
// The choreography runs BEFORE the navigation on purpose. A cross-document transition
// snapshots the outgoing document at navigation start, so by the time the morph captures
// the grid, the room has already stepped back — the snapshot carries the deference into
// the transition rather than fighting it.
const PRESS_SCALE = 0.985;
const PRESS_MS = 90;
const CHOSEN_SCALE = 1.02;
const RECEDE_OPACITY = 0.35;
const RECEDE_SCALE = 0.97;
const RECEDE_MS = 300;
const HOUSE_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

export default function VoicesClient({ initialNode }) {
  // Seeded, so this is never null and the grid never renders an empty first frame.
  const [voices, setVoices] = useState(() => publishedVoices(initialNode));
  const [entrance, setEntrance] = useState('hidden');
  const [pressed, setPressed] = useState(null);
  const [departing, setDeparting] = useState(null);
  const started = useRef(false);
  const timers = useRef([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // The live re-read. Overwrites the seed with whatever the CMS says now; a failed read
  // leaves the seeded roster standing rather than blanking a good grid.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { ref, get } = await import('firebase/database');
        const snap = await get(ref(db, 'cms_voices'));
        if (!cancelled) setVoices(publishedVoices(snap.exists() ? snap.val() : {}));
      } catch (e) {
        console.warn('voices: live cms_voices read failed, keeping the build-time roster', e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Fires once, on mount, since the roster is seeded. The ref guard means no later state
  // change can replay it, and the class lands on the wrapper — never on anything keyed to
  // data, so the live re-read swapping the roster underneath cannot retrigger it.
  useEffect(() => {
    if (started.current) return;
    started.current = true;

    if (prefersReducedMotion()) { setEntrance('settled'); return; }

    setEntrance('entering');
    timers.current.push(setTimeout(() => setEntrance('settled'), GRID_ENTER_MS));
  }, []);

  // Reduced motion returns before preventDefault, exactly as the gateway's walkThrough
  // does: no choreography, no held navigation, the <a> just goes.
  const depart = useCallback((e, slug, href) => {
    if (prefersReducedMotion()) return;
    e.preventDefault();
    if (departing) return;

    setPressed(slug);
    timers.current.push(setTimeout(() => {
      setPressed(null);
      setDeparting(slug);
      // location.assign, not router.push: a client-side navigation never swaps the
      // document, and a cross-document view transition needs a document swap to fire at
      // all. This is the one place on the island that leaves via a full navigation, and
      // the morph is why. On a static export the far side is already built HTML.
      timers.current.push(setTimeout(() => { window.location.assign(href); }, RECEDE_MS));
    }, PRESS_MS));
  }, [departing]);

  const wrapClass = entrance === 'entering' ? ' cs-vo-entering' : entrance === 'settled' ? ' cs-vo-settled' : '';

  return (
    <div className="cs-vo">
      <style>{`
        .cs-vo {
          --vo-gold:#c9a84c; --vo-cream:#f5f0e8;
          --vo-serif:'Cormorant Garamond',Georgia,serif;
          --vo-display:'Cinzel',Georgia,serif;
          background:radial-gradient(120% 40% at 50% -5%, #1c0f38 0%, #0b0716 55%, #080610 100%);
          min-height:100vh; font-family:var(--vo-serif); padding:64px 22px 72px;
        }
        .cs-vo-inner { max-width:440px; margin:0 auto; }
        .cs-vo-eyebrow {
          font-family:var(--vo-display); font-size:11.5px; letter-spacing:.28em;
          color:var(--vo-gold); text-align:center;
        }
        .cs-vo-rule { width:44px; height:1px; background:var(--vo-gold); margin:14px auto 16px; }
        .cs-vo-intro {
          font-style:italic; font-size:18px; color:rgba(245,240,232,.75);
          text-align:center; margin:0 0 38px;
        }
        .cs-vo-grid { display:grid; grid-template-columns:1fr; gap:26px; }
        .cs-vo-cardlink {
          display:block; border-radius:14px; text-decoration:none;
          transition:transform .45s ${HOUSE_EASE}, box-shadow .45s ${HOUSE_EASE};
        }
        .cs-vo-card {
          width:100%; height:auto; display:block; border-radius:14px;
          border:1px solid rgba(201,168,76,.28);
          box-shadow:0 10px 34px rgba(0,0,0,.5);
          background:rgba(8,6,16,.5);
        }
        @media (hover:hover) {
          .cs-vo-cardlink:hover { transform:translateY(-3px); }
          .cs-vo-cardlink:hover .cs-vo-card {
            border-color:rgba(201,168,76,.6); box-shadow:0 16px 44px rgba(0,0,0,.6);
          }
        }
        .cs-vo-name {
          font-family:var(--vo-display); font-size:12px; letter-spacing:.14em;
          color:rgba(245,240,232,.72); text-align:center; margin-top:12px;
        }
        .cs-vo-cardlink:hover .cs-vo-name { color:var(--vo-cream); }
        .cs-vo-empty {
          text-align:center; font-style:italic; font-size:16px;
          color:rgba(245,240,232,.45); padding:36px 0;
        }
        .cs-vo-back {
          display:block; width:fit-content; margin:44px auto 0; text-align:center;
          font-style:italic; font-size:15px; color:rgba(245,240,232,.6);
          text-decoration:none; border-bottom:1px solid rgba(201,168,76,.4);
        }
        .cs-vo-back:hover { color:var(--vo-cream); border-color:var(--vo-gold); }
        .cs-vo a:focus-visible { outline:2px solid #e2c876; outline-offset:3px; }

        /* ── THE DEPARTURE ─────────────────────────────────────────────────────
           The press beats the recede, so the two never share a transition: the
           pressed card overrides the duration for its 90ms, then inherits the
           longer one back for the lift. */
        .cs-vo-cardlink.is-pressed {
          transform:scale(${PRESS_SCALE});
          transition:transform ${PRESS_MS}ms ${HOUSE_EASE};
        }
        .cs-vo-grid.is-departing .cs-vo-cardlink {
          opacity:${RECEDE_OPACITY}; transform:scale(${RECEDE_SCALE});
          transition:opacity ${RECEDE_MS}ms ${HOUSE_EASE}, transform ${RECEDE_MS}ms ${HOUSE_EASE};
        }
        .cs-vo-grid.is-departing .cs-vo-cardlink.is-chosen {
          opacity:1; transform:scale(${CHOSEN_SCALE});
        }
        /* The room stops answering the pointer once it has stepped back. */
        .cs-vo-grid.is-departing .cs-vo-cardlink:hover { transform:scale(${RECEDE_SCALE}); }
        .cs-vo-grid.is-departing .cs-vo-cardlink.is-chosen:hover { transform:scale(${CHOSEN_SCALE}); }

        /* Entrance: readiness-keyed, wrapper-only. 'settled' drops the transform so the
           grid is not left composited for the whole visit. */
        .cs-vo-body { opacity:0; }
        .cs-vo-body.cs-vo-entering { animation:csVoEnter ${GRID_ENTER_MS}ms ${HOUSE_EASE} both; }
        .cs-vo-body.cs-vo-settled { opacity:1; }
        @keyframes csVoEnter { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
        @media (prefers-reduced-motion: reduce) {
          .cs-vo-body { opacity:1; }
          .cs-vo-body.cs-vo-entering { animation:none; }
          .cs-vo-cardlink { transition:none; }
          .cs-vo-cardlink:hover { transform:none; }
          /* The departure never runs under reduced motion — depart() returns before it
             can start — but the room must not be left mid-recede if it somehow does. */
          .cs-vo-grid.is-departing .cs-vo-cardlink { opacity:1; transform:none; transition:none; }
        }

        @media (min-width:768px) {
          .cs-vo-inner { max-width:920px; }
          .cs-vo-grid { grid-template-columns:1fr 1fr; gap:32px; }
        }
      `}</style>
      <div className="cs-vo-inner">
        <div className="cs-vo-eyebrow">VOICES OF THE ISLAND</div>
        <div className="cs-vo-rule" />
        <p className="cs-vo-intro">The writers and voices of Calvary Scribblings.</p>

        <div className={`cs-vo-body${wrapClass}`}>
          {voices.length > 0 ? (
            <div className={`cs-vo-grid${departing ? ' is-departing' : ''}`}>
              {voices.map((v) => {
                const href = `/voices/${v.slug}`;
                const chosen = departing === v.slug;
                return (
                  // A plain <a>, not <Link>: see depart() above. This is one half of the
                  // one link pair on the island that navigates the document.
                  <a
                    key={v.slug}
                    className={`cs-vo-cardlink${pressed === v.slug ? ' is-pressed' : ''}${chosen ? ' is-chosen' : ''}`}
                    href={href}
                    onClick={(e) => depart(e, v.slug, href)}
                  >
                    <img
                      className="cs-vo-card"
                      src={v.cardImage}
                      alt={`${v.displayName} — Voices of the Island`}
                      width={CARD_W}
                      height={CARD_H}
                      loading="lazy"
                      // The morph pair. Named on every card, per record: the outgoing
                      // snapshot only ever matches the one name the author page also
                      // carries, and the rest are captured as their own groups — already
                      // receded, so they simply see themselves out.
                      style={{ viewTransitionName: voiceTransitionName(v.slug) }}
                    />
                    <div className="cs-vo-name">{v.displayName}</div>
                  </a>
                );
              })}
            </div>
          ) : (
            <p className="cs-vo-empty">The voices are being gathered. Come back soon.</p>
          )}
        </div>

        {/* Stays a <Link>: the fence is /voices ↔ /voices/{slug}, and / never opts in. */}
        <Link className="cs-vo-back" href="/">Return to the Island</Link>
      </div>
    </div>
  );
}
