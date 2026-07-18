'use client';
// A voice's author page — the arrival half of the island morph.
//
// Seeded with the record as it stood at build, so the portrait is painted at the first
// frame: that is what the card morphs into, and it is why there is no layout shift on the
// hero. The live cms_voices read layers on top for freshness. House style: dark ground,
// Cinzel/Cormorant, gold.
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { db } from '../../lib/firebaseCore';
import { loadWorks, firstNameOf, voiceTransitionName, prefersReducedMotion, VT_RETURN_KEY } from '../../lib/voices';

const PORTRAIT_W = 1080;
const PORTRAIT_H = 1350;

// ── THE ARRIVAL ──────────────────────────────────────────────────────────────────
//
// The island's punctuation sequence. Readiness-gated per the entrance law: the class
// lands on the wrapper and nothing else, every beat below is a CSS delay off that one
// class, and a ref guard means it can never replay. Each beat is measured from the moment
// the composition begins — which is after the morph has landed, not after the document
// loaded. The portrait is deliberately OUTSIDE the staged set: it is the morph's target
// and must be visible throughout.
//
// THE TWO MODES. A voice with a distinct portrait gets the signature — the name, the rule,
// the seal, laid over a photograph that carries no writing of its own. A voice falling back
// to its card image does not: the card is self-labelled artwork with the name already baked
// into it, and printing the name again on top both doubles it and covers the message the
// card was made to say. So the whole overlay is suppressed and the card speaks for itself.
//
//   NAMED (distinct portrait)        BARE (card image as hero)
//   t=0     eyebrow + name rise      t=0     eyebrow rises
//   t=250   the 88px gold rule draws   —     no rule
//   t=950   the ✦ seal lands           —     no seal
//   t=1050  chip frosts in, message   t=250   chip frosts in, message
//   t=1200  bio, works cascade        t=400   bio, works cascade
//
// The bare column is not the named column with holes in it. Its beats close up, because a
// stagger that idles through a signature nobody is watching for reads as a page that has
// stalled, not a page composing itself.
//
// THE SIGNATURE BEAT — the rule is the story's own closing mark, lifted verbatim from the
// last-page ceremony (app/stories/[slug]/page-client.js): 88px, 1px, #c9a84c, scaleX(0)→
// scaleX(1) from transform-origin:center, 700ms ease. It draws outward from the middle
// rather than left-to-right. The kinship is the point — a story closes with this rule, and
// its author is introduced by it. The island signs its name the same way twice.
const RISE_MS = 650;
const RULE_AT = 250;
const RULE_MS = 700;
const SEAL_AT = RULE_AT + RULE_MS; // the seal waits for the rule to finish drawing
const SEAL_MS = 300;
const WORKS_STAGGER = 40;
// Rows past the eighth arrive with the eighth. A cascade is a flourish, not a queue.
const WORKS_CAP = 8;
const HOUSE_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

// The hero is the portrait when there is one, and the card image otherwise — but ONLY a
// portrait that is genuinely its own image earns the overlay. A record whose portrait field
// merely repeats cardImage is a fallback wearing a portrait's name, and is treated as one.
// All seven voices on the roster today are bare.
function hasDistinctPortrait(v) {
  return !!(v && v.portrait && v.portrait !== v.cardImage);
}

// The two columns above, resolved. chip/bio are handed to CSS as custom properties on the
// wrapper, so the stylesheet stays one constant string and only the delays vary.
function beatsFor(named) {
  return named ? { chip: 1050, bio: 1200 } : { chip: 250, bio: 400 };
}

// The works cascade starts with the bio and runs the stagger out from there. Everything is
// composed by the end of it, at which point the animations come off so the page is not left
// composited for the rest of the visit.
function settleFor(beats) {
  return beats.bio + (WORKS_CAP - 1) * WORKS_STAGGER + RISE_MS;
}
// The body waits for the webfonts before it moves — a Cormorant swap landing mid-ceremony
// is what makes a reveal read as dumped — but a slow font CDN never holds it hostage.
const FONT_CAP_MS = 800;

export default function VoicePageClient({ slug, initialVoice }) {
  const seeded = initialVoice && initialVoice.published === true ? { ...initialVoice, slug } : null;

  // An unpublished voice is treated exactly like a missing one: the build enumerates every
  // slug, so a draft's page exists and must not leak. A seeded draft starts as 'loading'
  // and the live read settles it to 'missing'.
  const [state, setState] = useState(seeded ? 'ready' : 'loading');
  const [voice, setVoice] = useState(seeded);
  const [works, setWorks] = useState([]);
  const [worksDelay, setWorksDelay] = useState(() => beatsFor(hasDistinctPortrait(seeded)).bio);

  const [entrance, setEntrance] = useState('hidden');
  const started = useRef(false);
  const worksStarted = useRef(false);
  const arriveAt = useRef(null);
  const timers = useRef([]);
  const unmounted = useRef(false);

  useEffect(() => () => {
    unmounted.current = true;
    timers.current.forEach(clearTimeout);
  }, []);

  // The live read. Confirms or corrects the seed.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { ref, get } = await import('firebase/database');
        const snap = await get(ref(db, `cms_voices/${slug}`));
        const v = snap.exists() ? snap.val() : null;
        if (cancelled) return;
        if (!v || v.published !== true) { setVoice(null); setState('missing'); return; }
        setVoice({ ...v, slug });
        setState('ready');
      } catch (e) {
        // A failed read leaves a seeded page standing; only an unseeded one goes missing.
        if (!cancelled && !seeded) setState('missing');
      }
    })();
    return () => { cancelled = true; };
    // seeded is derived from props and stable for the life of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  // The works query fires the moment a voice record exists — seeded or live — and never
  // waits on the morph or the ceremony. Cinema never delays data.
  //
  // Cancellation is scoped to UNMOUNT, deliberately not to `voice` changing. The live read
  // replaces the seeded record with an equal-but-new object a moment after mount, which
  // re-runs this effect; a cleanup keyed to [voice] would cancel the very query it had
  // just started, while the ref guard blocked a replacement from firing. The rows then
  // never arrive and the page claims the author has never published. The story page
  // records the same lesson about its settle timer — the trap is the deps, not the guard.
  useEffect(() => {
    if (!voice || worksStarted.current) return;
    worksStarted.current = true;
    (async () => {
      const rows = await loadWorks(db, voice);
      if (unmounted.current) return;
      // If the rows lost the race with the ceremony, they cascade from wherever it has
      // got to rather than waiting out a delay that has already elapsed.
      const worksAt = beatsFor(hasDistinctPortrait(voice)).bio;
      const t0 = arriveAt.current;
      setWorksDelay(t0 == null ? worksAt : Math.max(0, worksAt - (performance.now() - t0)));
      setWorks(rows);
    })();
  }, [voice]);

  // Fires once, when the voice has resolved. Ref guard, wrapper-only class.
  useEffect(() => {
    if (state === 'loading' || started.current) return;
    started.current = true;

    if (prefersReducedMotion()) { setEntrance('settled'); return; }

    let fired = false;
    const begin = () => {
      if (fired) return;
      fired = true;
      arriveAt.current = performance.now();
      setEntrance('entering');
      // The bare mode composes sooner, so it settles sooner — the timer follows the beats
      // rather than holding the page composited through a signature that never ran.
      timers.current.push(setTimeout(() => setEntrance('settled'), settleFor(beatsFor(hasDistinctPortrait(voice)))));
    };

    // Whichever comes first: the fonts landing, or the cap giving up on them.
    const onReady = () => {
      timers.current.push(setTimeout(begin, FONT_CAP_MS));
      if (typeof document !== 'undefined' && document.fonts?.ready) {
        document.fonts.ready.then(begin).catch(begin);
      } else {
        begin();
      }
    };

    // The composition waits for the morph to land — the arrival is what happens after the
    // portrait arrives, not underneath it. Absent a morph (no support, a direct load, a
    // reload) this is null and the ceremony simply starts on its own readiness.
    const morph = typeof window !== 'undefined' ? window.__csVoiceMorph : null;
    if (morph) morph.then(onReady, onReady); else onReady();

    // Deliberately not cleaning up here: the timers are cleared on unmount above. A
    // cleanup keyed to these deps would cancel the settle timer the moment it began.
  }, [state, voice]);

  // Any return to the grid runs at the short duration, not just a history traverse: the
  // motion reads the same either way, so it should not have two speeds depending on
  // whether the reader used the back button or the link. pagereveal on the far side reads
  // and clears this. See app/voices/layout.js.
  const markReturn = () => {
    try { sessionStorage.setItem(VT_RETURN_KEY, '1'); } catch {}
  };

  const wrapClass = entrance === 'entering' ? ' cs-vp-arrive' : entrance === 'settled' ? ' cs-vp-arrive-settled' : '';
  const hero = voice ? (voice.portrait || voice.cardImage) : '';
  const firstName = firstNameOf(voice?.displayName);
  // Which of the two modes this record is in — see hasDistinctPortrait() and the beat table.
  const named = hasDistinctPortrait(voice);
  const beats = beatsFor(named);

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
        .cs-vp-masthead-rule { width:44px; height:1px; background:var(--vp-gold); margin:14px auto 0; }

        /* ── The hero ─────────────────────────────────────────────────────────
           The portrait carries the morph, so it is never staged and never hidden.
           The scrim is what lets the name own the bottom of the frame. */
        .cs-vp-hero { position:relative; margin:34px 0 30px; border-radius:14px; overflow:hidden;
          border:1px solid rgba(201,168,76,.28); box-shadow:0 10px 34px rgba(0,0,0,.5);
          background:rgba(8,6,16,.5); }
        .cs-vp-portrait { width:100%; height:auto; aspect-ratio:${PORTRAIT_W} / ${PORTRAIT_H}; object-fit:cover; display:block; }
        .cs-vp-sr {
          position:absolute; width:1px; height:1px; margin:-1px; padding:0;
          overflow:hidden; clip:rect(0 0 0 0); clip-path:inset(50%); white-space:nowrap; border:0;
        }
        .cs-vp-scrim {
          position:absolute; left:0; right:0; bottom:0; height:58%; pointer-events:none;
          background:linear-gradient(to bottom, rgba(11,7,22,0) 0%, rgba(11,7,22,.85) 100%);
        }
        .cs-vp-herotext { position:absolute; left:0; right:0; bottom:26px; padding:0 20px; }
        .cs-vp-name {
          font-family:var(--vp-display); font-size:31px; line-height:1.2;
          color:var(--vp-cream); text-align:center; margin:0;
          text-shadow:0 2px 18px rgba(0,0,0,.45);
        }

        /* The signature. The rule is centred and the seal sits at its end; neither uses a
           transform for placement, so 'settled' can clear transforms wholesale. */
        .cs-vp-sig { position:relative; width:88px; height:14px; margin:16px auto 0; }
        .cs-vp-rule {
          position:absolute; left:0; top:6px; width:88px; height:1px; background:var(--vp-gold);
          transform:scaleX(0); transform-origin:center;
        }
        .cs-vp-seal {
          position:absolute; left:97px; top:0; line-height:14px; font-size:.9rem;
          color:var(--vp-gold); opacity:0;
        }

        /* ── The glass chip ───────────────────────────────────────────────────
           CANONICAL GRAMMAR — founded here. There is no glass anywhere else in the app
           today; the gateway's only backdrop-filter is a flat 3px modal scrim. This is
           the source of truth for the island's glass, and other surfaces (the gateway
           included) are meant to adopt it in a later pass. */
        .cs-vp-chip {
          display:block; width:fit-content; margin:30px auto 0;
          padding:7px 16px; border-radius:999px;
          font-family:var(--vp-display); font-size:11px; letter-spacing:.2em;
          color:var(--vp-gold);
          background:linear-gradient(180deg, rgba(245,240,232,.055), rgba(91,43,160,.10));
          -webkit-backdrop-filter:blur(14px) saturate(1.35);
          backdrop-filter:blur(14px) saturate(1.35);
          border:1px solid rgba(201,168,76,.35);
          box-shadow:inset 0 1px 0 rgba(245,240,232,.14), inset 0 -1px 0 rgba(0,0,0,.25);
        }
        /* The first @supports in the repo. Without backdrop-filter the gradient reads as
           a smudge over the ground, so the chip falls back to solid. */
        @supports not ((backdrop-filter: blur(14px)) or (-webkit-backdrop-filter: blur(14px))) {
          .cs-vp-chip { background:rgba(11,7,22,.88); }
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
          display:flex; align-items:baseline; gap:12px; text-decoration:none; padding:16px 0;
          border-bottom:1px solid rgba(245,240,232,.09);
        }
        .cs-vp-work:first-of-type { border-top:1px solid rgba(245,240,232,.09); }
        /* The Library door's own glyph (app/components/Gateway.js) — these are library
           works, and they are marked with the door they came through. */
        .cs-vp-work-glyph { color:var(--vp-gold); font-size:13px; line-height:1; flex:none; }
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

        /* ── The punctuation sequence ─────────────────────────────────────────
           Every staged element hides itself and waits for the wrapper's class. */
        .cs-vp-stage { opacity:0; }
        @keyframes csVpRise { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
        @keyframes csVpFade { from { opacity:0; } to { opacity:1; } }
        @keyframes csVpDraw { from { transform:scaleX(0); } to { transform:scaleX(1); } }

        .cs-vp-arrive .cs-vp-eyebrow,
        .cs-vp-arrive .cs-vp-name { animation:csVpRise ${RISE_MS}ms ${HOUSE_EASE} both; }
        .cs-vp-arrive .cs-vp-rule { animation:csVpDraw ${RULE_MS}ms ease ${RULE_AT}ms both; }
        .cs-vp-arrive .cs-vp-seal { animation:csVpFade ${SEAL_MS}ms ease ${SEAL_AT}ms both; }
        /* The two beat columns arrive as custom properties off the wrapper — see beatsFor().
           The fallbacks are the named set, so a body that somehow renders without them keeps
           the full ceremony rather than snapping. */
        .cs-vp-arrive .cs-vp-chip,
        .cs-vp-arrive .cs-vp-message { animation:csVpRise ${RISE_MS}ms ${HOUSE_EASE} var(--vp-chip-at, 1050ms) both; }
        .cs-vp-arrive .cs-vp-bio,
        .cs-vp-arrive .cs-vp-divider,
        .cs-vp-arrive .cs-vp-pen,
        .cs-vp-arrive .cs-vp-works-empty { animation:csVpRise ${RISE_MS}ms ${HOUSE_EASE} var(--vp-bio-at, 1200ms) both; }
        /* The rows carry their own delay inline — the cascade, and its cap. */
        .cs-vp-arrive .cs-vp-work { animation:csVpRise ${RISE_MS}ms ${HOUSE_EASE} both; }

        /* Composed. The animations come off and the page stops being composited. Rows that
           lost the race to here are simply shown rather than left hidden. */
        .cs-vp-arrive-settled .cs-vp-stage { opacity:1; transform:none; animation:none; }
        .cs-vp-arrive-settled .cs-vp-rule { transform:none; animation:none; }

        @media (prefers-reduced-motion: reduce) {
          /* No transition, instant content. The JS short-circuits to 'settled' before any
             of this can start; the query is the belt to that braces. */
          .cs-vp-stage { opacity:1; transform:none; animation:none; }
          .cs-vp-rule { transform:none; animation:none; }
          .cs-vp-work-title { transition:none; }
        }

        @media (min-width:768px) {
          .cs-vp-name { font-size:40px; }
          .cs-vp-message { font-size:21px; }
          .cs-vp-herotext { bottom:34px; }
        }
      `}</style>

      <div className="cs-vp-inner">
        <div
          className={`cs-vp-body${wrapClass}`}
          style={{ '--vp-chip-at': `${beats.chip}ms`, '--vp-bio-at': `${beats.bio}ms` }}
        >
          {state === 'missing' ? (
            <>
              <p className="cs-vp-missing">This voice has not been gathered yet.</p>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a className="cs-vp-back" href="/voices" onClick={markReturn}>All the voices</a>
            </>
          ) : state === 'ready' && voice ? (
            <>
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a className="cs-vp-eyebrow cs-vp-stage" href="/voices" onClick={markReturn}>
                VOICES OF THE ISLAND
              </a>
              <div className="cs-vp-masthead-rule" />

              <div className="cs-vp-hero">
                {hero && (
                  <img
                    className="cs-vp-portrait"
                    src={hero}
                    alt={`${voice.displayName} — Voices of the Island`}
                    width={PORTRAIT_W}
                    height={PORTRAIT_H}
                    // The morph's other half. Same name as the card on the grid, which is
                    // the whole mechanism: the browser matches the pair across the two
                    // documents and tweens one into the other.
                    style={{ viewTransitionName: voiceTransitionName(slug) }}
                  />
                )}
                {/* The overlay — scrim, name, rule, seal — belongs to a photograph, and
                    only a photograph. Over a self-labelled card it would darken and then
                    overprint the very message the card was made to carry, so the whole of
                    it goes and the artwork is left alone. */}
                {named ? (
                  <>
                    <div className="cs-vp-scrim" aria-hidden="true" />
                    <div className="cs-vp-herotext">
                      <h1 className="cs-vp-name cs-vp-stage">{voice.displayName}</h1>
                      <div className="cs-vp-sig" aria-hidden="true">
                        <span className="cs-vp-rule" />
                        <span className="cs-vp-seal cs-vp-stage">✦</span>
                      </div>
                    </div>
                  </>
                ) : (
                  // The name is drawn in the card, which no screen reader can read. The
                  // document keeps its one h1 either way; here it is simply not printed
                  // twice over art that already says it.
                  <h1 className="cs-vp-sr">{voice.displayName}</h1>
                )}
              </div>

              {voice.genreTag && <div className="cs-vp-chip cs-vp-stage">{voice.genreTag}</div>}
              {voice.message && <p className="cs-vp-message cs-vp-stage">{voice.message}</p>}
              {voice.bio && <p className="cs-vp-bio cs-vp-stage">{voice.bio}</p>}

              <div className="cs-vp-divider cs-vp-stage" />

              <p className="cs-vp-pen cs-vp-stage">FROM THE PEN OF {firstName.toUpperCase()}</p>
              {works.length > 0 ? (
                works.map((w, i) => (
                  // Stays a <Link>: /stories is outside the fence, so this is ordinary
                  // client-side navigation.
                  <Link
                    key={w.slug}
                    className="cs-vp-work cs-vp-stage"
                    href={`/stories/${w.slug}`}
                    style={{ animationDelay: `${worksDelay + Math.min(i, WORKS_CAP - 1) * WORKS_STAGGER}ms` }}
                  >
                    <span className="cs-vp-work-glyph" aria-hidden="true">⁂</span>
                    <span>
                      <span className="cs-vp-work-title">{w.title}</span>
                      <span className="cs-vp-work-meta" style={{ display: 'block' }}>
                        {[w.categoryName, w.date].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </Link>
                ))
              ) : (
                <p className="cs-vp-works-empty cs-vp-stage">No published work yet.</p>
              )}

              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a className="cs-vp-back" href="/voices" onClick={markReturn}>All the voices</a>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
