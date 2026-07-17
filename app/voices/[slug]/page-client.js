'use client';
// A voice's author page. Reads cms_voices/{slug} live, then queries that author's
// published works server-filtered by uid. House style: dark ground, Cinzel/Cormorant,
// gold.
import { use, useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { db } from '../../lib/firebase';
import { loadWorks, firstNameOf } from '../../lib/voices';

const PORTRAIT_W = 1080;
const PORTRAIT_H = 1350;

// Entrance, mirroring the story page: content enters on readiness, once, wrapper-only.
const ENTER_MS = 650;

export default function VoicePageClient({ params }) {
  const { slug } = use(params);

  const [state, setState] = useState('loading'); // 'loading' | 'ready' | 'missing'
  const [voice, setVoice] = useState(null);
  const [works, setWorks] = useState([]);

  const [entrance, setEntrance] = useState('hidden');
  const started = useRef(false);
  const timers = useRef([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { ref, get } = await import('firebase/database');
        const snap = await get(ref(db, `cms_voices/${slug}`));
        const v = snap.exists() ? snap.val() : null;

        // An unpublished voice is treated exactly like a missing one: the build
        // enumerates every slug, so a draft's page exists and must not leak.
        if (!v || v.published !== true) {
          if (!cancelled) setState('missing');
          return;
        }
        if (cancelled) return;
        setVoice({ ...v, slug });
        setState('ready');

        // Works load after the voice, so the page paints without waiting on the query.
        const rows = await loadWorks(db, v);
        if (!cancelled) setWorks(rows);
      } catch (e) {
        if (!cancelled) setState('missing');
      }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  // Fires once, when the voice resolves. Ref guard, wrapper-only class — the works
  // list arriving later cannot retrigger it.
  useEffect(() => {
    if (state === 'loading' || started.current) return;
    started.current = true;

    let reduced = false;
    try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch {}
    if (reduced) { setEntrance('settled'); return; }

    setEntrance('entering');
    timers.current.push(setTimeout(() => setEntrance('settled'), ENTER_MS));
  }, [state]);

  const wrapClass = entrance === 'entering' ? ' cs-vp-entering' : entrance === 'settled' ? ' cs-vp-settled' : '';
  const hero = voice ? (voice.portrait || voice.cardImage) : '';
  const firstName = firstNameOf(voice?.displayName);

  return (
    <div className="cs-vp">
      <style>{`
        .cs-vp {
          --vp-gold:#c9a84c; --vp-cream:#f5f0e8;
          --vp-serif:'Cormorant Garamond',Georgia,serif;
          --vp-display:'Cinzel',Georgia,serif;
          background:radial-gradient(120% 40% at 50% -5%, #1c0f38 0%, #0b0716 55%, #080610 100%);
          min-height:100vh; font-family:var(--vp-serif); padding:64px 22px 72px;
        }
        .cs-vp-inner { max-width:640px; margin:0 auto; }
        .cs-vp-eyebrow {
          font-family:var(--vp-display); font-size:11.5px; letter-spacing:.28em;
          color:var(--vp-gold); text-align:center; text-decoration:none; display:block;
        }
        .cs-vp-rule { width:44px; height:1px; background:var(--vp-gold); margin:14px auto 0; }
        .cs-vp-portrait {
          width:100%; height:auto; display:block; border-radius:14px; margin:34px 0 30px;
          border:1px solid rgba(201,168,76,.28);
          box-shadow:0 10px 34px rgba(0,0,0,.5);
          background:rgba(8,6,16,.5);
        }
        .cs-vp-name {
          font-family:var(--vp-display); font-size:31px; line-height:1.2;
          color:var(--vp-cream); text-align:center; margin:0;
        }
        .cs-vp-genre {
          font-family:var(--vp-display); font-size:11px; letter-spacing:.2em;
          color:var(--vp-gold); text-align:center; margin:12px 0 0;
        }
        .cs-vp-message {
          font-style:italic; font-size:19px; line-height:1.6;
          color:rgba(245,240,232,.8); text-align:center; margin:26px 0 0;
        }
        .cs-vp-bio {
          font-size:17px; line-height:1.75; color:rgba(245,240,232,.66);
          margin:26px 0 0; white-space:pre-wrap;
        }
        .cs-vp-divider { width:100%; height:1px; background:rgba(201,168,76,.32); margin:40px 0 34px; }
        .cs-vp-pen {
          font-family:var(--vp-display); font-size:11.5px; letter-spacing:.22em;
          color:var(--vp-gold); text-align:center; margin:0 0 24px;
        }
        .cs-vp-work {
          display:block; text-decoration:none; padding:16px 0;
          border-bottom:1px solid rgba(245,240,232,.09);
        }
        .cs-vp-work:first-of-type { border-top:1px solid rgba(245,240,232,.09); }
        .cs-vp-work-title {
          font-size:21px; line-height:1.35; color:var(--vp-cream);
          transition:color .3s ease;
        }
        @media (hover:hover) { .cs-vp-work:hover .cs-vp-work-title { color:var(--vp-gold); } }
        .cs-vp-work-meta {
          font-size:12.5px; letter-spacing:.06em; color:rgba(245,240,232,.42); margin-top:5px;
        }
        .cs-vp-works-empty {
          font-style:italic; font-size:15px; color:rgba(245,240,232,.4); text-align:center; padding:8px 0 0;
        }
        .cs-vp-back {
          display:block; width:fit-content; margin:44px auto 0; text-align:center;
          font-style:italic; font-size:15px; color:rgba(245,240,232,.6);
          text-decoration:none; border-bottom:1px solid rgba(201,168,76,.4);
        }
        .cs-vp-back:hover { color:var(--vp-cream); border-color:var(--vp-gold); }
        .cs-vp a:focus-visible { outline:2px solid #e2c876; outline-offset:3px; }
        .cs-vp-missing {
          text-align:center; font-style:italic; font-size:16px;
          color:rgba(245,240,232,.45); padding:56px 0 0;
        }

        /* Readiness-keyed, wrapper-only. 'settled' drops the transform rather than
           leaving the whole page composited for the visit. */
        .cs-vp-body { opacity:0; }
        .cs-vp-body.cs-vp-entering { animation:csVpEnter ${ENTER_MS}ms cubic-bezier(0.22,1,0.36,1) both; }
        .cs-vp-body.cs-vp-settled { opacity:1; }
        @keyframes csVpEnter { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
        @media (prefers-reduced-motion: reduce) {
          .cs-vp-body { opacity:1; }
          .cs-vp-body.cs-vp-entering { animation:none; }
          .cs-vp-work-title { transition:none; }
        }

        @media (min-width:768px) {
          .cs-vp-name { font-size:40px; }
          .cs-vp-message { font-size:21px; }
        }
      `}</style>

      <div className="cs-vp-inner">
        <Link className="cs-vp-eyebrow" href="/voices">VOICES OF THE ISLAND</Link>
        <div className="cs-vp-rule" />

        <div className={`cs-vp-body${wrapClass}`}>
          {state === 'missing' ? (
            <>
              <p className="cs-vp-missing">This voice has not been gathered yet.</p>
              <Link className="cs-vp-back" href="/voices">All the voices</Link>
            </>
          ) : state === 'ready' && voice ? (
            <>
              {hero && (
                <img
                  className="cs-vp-portrait"
                  src={hero}
                  alt={`${voice.displayName} — Voices of the Island`}
                  width={PORTRAIT_W}
                  height={PORTRAIT_H}
                  loading="lazy"
                />
              )}
              <h1 className="cs-vp-name">{voice.displayName}</h1>
              {voice.genreTag && <p className="cs-vp-genre">{voice.genreTag}</p>}
              {voice.message && <p className="cs-vp-message">{voice.message}</p>}
              {voice.bio && <p className="cs-vp-bio">{voice.bio}</p>}

              <div className="cs-vp-divider" />

              <p className="cs-vp-pen">FROM THE PEN OF {firstName.toUpperCase()}</p>
              {works.length > 0 ? (
                works.map((w) => (
                  <Link key={w.slug} className="cs-vp-work" href={`/stories/${w.slug}`}>
                    <div className="cs-vp-work-title">{w.title}</div>
                    <div className="cs-vp-work-meta">
                      {[w.categoryName, w.date].filter(Boolean).join(' · ')}
                    </div>
                  </Link>
                ))
              ) : (
                <p className="cs-vp-works-empty">No published work yet.</p>
              )}

              <Link className="cs-vp-back" href="/voices">All the voices</Link>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
