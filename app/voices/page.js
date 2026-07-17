'use client';
// Voices of the Island — the card gallery, now read live from cms_voices.
// Metadata lives in ./layout.js, since this is a client component.
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { db } from '../lib/firebase';
import { publishedVoices } from '../lib/voices';

// The cards are 1080×1350 social assets. Both dimensions are passed to every <img> so
// the grid reserves the right aspect ratio before any image lands.
const CARD_W = 1080;
const CARD_H = 1350;

// Entrance, mirroring the story page: content enters on readiness, once, on the
// wrapper only. Deliberately not a scroll reveal — the grid is above the fold.
const GRID_ENTER_MS = 650;

export default function VoicesPage() {
  const [voices, setVoices] = useState(null); // null = still resolving
  const [entrance, setEntrance] = useState('hidden');
  const started = useRef(false);
  const timers = useRef([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { ref, get } = await import('firebase/database');
        const snap = await get(ref(db, 'cms_voices'));
        if (!cancelled) setVoices(publishedVoices(snap.exists() ? snap.val() : {}));
      } catch (e) {
        // A failed read shows the empty state rather than a broken grid.
        if (!cancelled) setVoices([]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Fires once, when the roster has resolved. The ref guard means no later state
  // change can replay it, and the class lands on the wrapper — never on anything
  // keyed to data, so the empty→cards swap inside cannot retrigger it.
  useEffect(() => {
    if (voices === null || started.current) return;
    started.current = true;

    let reduced = false;
    try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch {}
    if (reduced) { setEntrance('settled'); return; }

    setEntrance('entering');
    timers.current.push(setTimeout(() => setEntrance('settled'), GRID_ENTER_MS));
  }, [voices]);

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
          transition:transform .45s cubic-bezier(0.22,1,0.36,1), box-shadow .45s cubic-bezier(0.22,1,0.36,1);
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

        /* Entrance: readiness-keyed, wrapper-only. 'settled' drops the transform so the
           grid is not left composited for the whole visit. */
        .cs-vo-body { opacity:0; }
        .cs-vo-body.cs-vo-entering { animation:csVoEnter ${GRID_ENTER_MS}ms cubic-bezier(0.22,1,0.36,1) both; }
        .cs-vo-body.cs-vo-settled { opacity:1; }
        @keyframes csVoEnter { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
        @media (prefers-reduced-motion: reduce) {
          .cs-vo-body { opacity:1; }
          .cs-vo-body.cs-vo-entering { animation:none; }
          .cs-vo-cardlink { transition:none; }
          .cs-vo-cardlink:hover { transform:none; }
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

        {/* Nothing renders until the roster resolves, so the empty state never flashes
            in front of a reader who is about to get cards. */}
        <div className={`cs-vo-body${wrapClass}`}>
          {voices && voices.length > 0 ? (
            <div className="cs-vo-grid">
              {voices.map((v) => (
                <Link key={v.slug} className="cs-vo-cardlink" href={`/voices/${v.slug}`}>
                  <img
                    className="cs-vo-card"
                    src={v.cardImage}
                    alt={`${v.displayName} — Voices of the Island`}
                    width={CARD_W}
                    height={CARD_H}
                    loading="lazy"
                  />
                  <div className="cs-vo-name">{v.displayName}</div>
                </Link>
              ))}
            </div>
          ) : voices ? (
            <p className="cs-vo-empty">The voices are being gathered. Come back soon.</p>
          ) : null}
        </div>

        <Link className="cs-vo-back" href="/">Return to the Island</Link>
      </div>
    </div>
  );
}
