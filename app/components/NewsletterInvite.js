'use client';
import { useState, useEffect, useRef } from 'react';

// ── Story-end newsletter invitation ───────────────────────────────────────────
// An inline panel in the story page's dark tail, between AboutTheAuthor and the
// comments. Never a modal, never a popup, never on top of the closing ceremony —
// the .last-page rule, the ReadSeal and .story-footer finish untouched inside
// <main> on cream, three sections above this.
//
// SURFACE: glass over night. It shares the #0a0a0a band with AboutTheAuthor and
// deliberately borrows that card's horizontal rhythm — 680px column, 2rem gutter,
// 14px radius — so the dark tail reads as one continuous column. The full ATA
// card is cream; this one is not, by direction: the canonical glass grammar
// (translucent ink, gold hairline, blur) is what applies over night.
//
// ENTRANCE: the global [data-reveal] machinery in app/components/Providers.js.
// Its MutationObserver picks up late-mounted nodes, which is what this is — the
// panel appears only after the localStorage check resolves. "fade" is a pure
// opacity keyframe (no transform), and globals.css already forces reveals visible
// under prefers-reduced-motion, so the entrance needs no guard of its own. The
// shared duration is 320ms; 600ms is set on .nli-panel below rather than by
// touching the shared rule.
//
// SUBSCRIPTION STATE: `subscribers` is admin-read-only (database.rules.json), and
// no per-user newsletter flag exists anywhere, so there is no way to know before
// asking. localStorage is the only pre-render signal; the Worker's 409 is the
// authoritative one and is treated as success, not as an error, so a subscriber
// on a fresh device is asked at most once and never again.

const SUBSCRIBE_URL = 'https://calvary-newsletter.calvarymediauk.workers.dev/subscribe';

// One global key — dismissed or subscribed once, gone from every story after.
const STORAGE_KEY = 'cs_newsletter_invite';

const FADE_MS = 340;

export default function NewsletterInvite({ user }) {
  // null = the localStorage check hasn't run yet; nothing renders until it has.
  const [show, setShow] = useState(null);
  const [email, setEmail] = useState('');
  const [phase, setPhase] = useState('form'); // form → fading → done
  const [doneLine, setDoneLine] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [lockH, setLockH] = useState(null);

  const panelRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    let seen = null;
    try { seen = window.localStorage.getItem(STORAGE_KEY); } catch (e) { /* private mode */ }
    setShow(!seen);
  }, []);

  // Prefill from the account. Only fills a field the reader hasn't touched, so a
  // late-arriving auth state can never overwrite what someone is typing.
  useEffect(() => {
    if (user?.email) setEmail((cur) => (cur ? cur : user.email));
  }, [user?.email]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const remember = (value) => {
    try { window.localStorage.setItem(STORAGE_KEY, value); } catch (e) { /* private mode */ }
  };

  // The panel empties out into one line. Height is locked at the measured value
  // for the fade-out, then eased down to the closing line's own height, so the
  // border never snaps.
  const closeInto = (line) => {
    setDoneLine(line);
    setLockH(panelRef.current?.offsetHeight || null);
    setPhase('fading');
    timerRef.current = setTimeout(() => setPhase('done'), FADE_MS);
  };

  const submit = async (e) => {
    if (e) e.preventDefault();
    if (submitting) return;
    const value = email.trim();
    if (!value || !value.includes('@')) {
      setError('That doesn’t look like an email address.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch(SUBSCRIBE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // `name` is optional on the Worker and only warms the welcome email's
        // greeting — "Hi Sarah" instead of "Hi there".
        body: JSON.stringify({ email: value, name: (user?.displayName || '').trim() || undefined }),
      });
      if (res.ok) {
        remember('subscribed');
        closeInto('You’re on the list. See you next week.');
        return;
      }
      if (res.status === 409) {
        // Already subscribed. Not a failure — they said yes once already. Same
        // closing treatment, and the flag stops us ever asking this browser again.
        remember('subscribed');
        closeInto('You’re already on the list.');
        return;
      }
      if (res.status === 400) {
        setError('That doesn’t look like an email address.');
      } else {
        setError('That didn’t go through. Try again in a moment.');
      }
      setSubmitting(false);
    } catch (err) {
      setError('That didn’t go through. Try again in a moment.');
      setSubmitting(false);
    }
  };

  const dismiss = () => {
    remember('dismissed');
    setShow(false);
  };

  if (!show) return null;

  return (
    <section className="nli-section">
      <div
        ref={panelRef}
        className="nli-panel"
        data-reveal="fade"
        style={lockH ? { minHeight: phase === 'done' ? 92 : lockH } : undefined}
      >
        {phase === 'done' ? (
          <p className="nli-done">{doneLine}</p>
        ) : (
          <div className={'nli-inner' + (phase === 'fading' ? ' is-fading' : '')}>
            <button
              type="button"
              className="nli-dismiss"
              onClick={dismiss}
              aria-label="Dismiss this invitation"
            >
              ×
            </button>
            <span className="nli-rule" aria-hidden="true" />
            <div className="nli-eyebrow">From the Island</div>
            <p className="nli-line">New stories, once a week. Nothing else.</p>
            <form className="nli-form" onSubmit={submit} noValidate>
              <label className="nli-sr" htmlFor="nli-email">Email address</label>
              <input
                id="nli-email"
                className="nli-input"
                type="email"
                inputMode="email"
                autoComplete="email"
                spellCheck="false"
                placeholder="your email"
                value={email}
                onChange={(ev) => { setEmail(ev.target.value); if (error) setError(''); }}
                disabled={submitting}
              />
              <button type="submit" className="nli-submit" disabled={submitting}>
                {submitting ? '…' : 'Send me stories'}
              </button>
            </form>
            {error && <p className="nli-error">{error}</p>}
          </div>
        )}
      </div>

      <style jsx>{`
        /* Horizontal rhythm borrowed from .ata-section / .ata-card so the dark
           tail stays one column: same 2rem gutter, same 680px measure, same
           radius. No mobile gutter override — AboutTheAuthor has none either,
           and matching it is the point. */
        .nli-section { background: #0a0a0a; padding: 2.25rem 2rem 0; }
        .nli-panel {
          position: relative;
          max-width: 680px;
          margin: 0 auto;
          background: rgba(20, 12, 8, 0.5);
          border: 1px solid rgba(201, 168, 76, 0.28);
          border-radius: 14px;
          padding: 1.75rem 1.6rem 1.6rem;
          /* Unprefixed only. Hand-writing -webkit-backdrop-filter alongside it
             makes the build's autoprefixer skip its own pass and the minifier
             then collapses the pair down to the -webkit- form alone, so the
             standard property never ships and Chrome renders no blur at all.
             Every other glass surface here (.story-nav, .back-to-top, the
             condensed .ata-card) declares it bare and gets both forms emitted. */
          backdrop-filter: blur(4px);
          display: flex;
          flex-direction: column;
          justify-content: center;
          transition: min-height 500ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        /* 600ms, on this panel only — the shared [data-reveal] rule stays 320ms. */
        .nli-panel[data-reveal].is-revealed { animation-duration: 600ms; }

        .nli-inner { display: flex; flex-direction: column; align-items: center; transition: opacity ${FADE_MS}ms ease; }
        .nli-inner.is-fading { opacity: 0; }

        .nli-rule { display: block; width: 40px; height: 1px; background: #c9a84c; opacity: 0.7; margin-bottom: 0.9rem; }
        .nli-eyebrow {
          font-family: Cormorant Garamond, Georgia, serif;
          font-size: 0.66rem; font-weight: 600; letter-spacing: 0.28em;
          text-transform: uppercase; color: #c9a84c; margin-bottom: 0.85rem;
        }
        .nli-line {
          font-family: Cormorant Garamond, Georgia, serif;
          font-style: italic; font-size: 1.3rem; line-height: 1.4;
          color: #f0ead8; text-align: center; margin: 0 0 1.5rem;
        }

        .nli-form { display: flex; gap: 0.6rem; width: 100%; max-width: 420px; flex-wrap: wrap; }
        .nli-sr {
          position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
          overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
        }
        .nli-input {
          flex: 1 1 190px; min-width: 0;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(245, 240, 232, 0.14);
          border-radius: 10px;
          padding: 0.7rem 1rem;
          font-family: Cormorant Garamond, Georgia, serif;
          font-size: 0.95rem; color: #f0ead8;
          outline: none;
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }
        .nli-input::placeholder { color: rgba(245, 240, 232, 0.32); font-style: italic; }
        /* Same focus signature as .cs-textarea on this page. :focus, not
           :focus-visible — a text field should show where the caret is however
           it was reached; the visible-only heuristic is for the buttons. */
        .nli-input:focus { border-color: rgba(201, 168, 76, 0.5); box-shadow: 0 0 0 2px rgba(201, 168, 76, 0.12); }
        .nli-input:disabled { opacity: 0.6; }

        .nli-submit {
          flex: 0 0 auto;
          background: rgba(201, 168, 76, 0.06);
          border: 1px solid rgba(201, 168, 76, 0.45);
          border-radius: 10px;
          padding: 0.7rem 1.3rem;
          font-family: Cormorant Garamond, Georgia, serif;
          font-size: 0.72rem; font-weight: 600; letter-spacing: 0.16em;
          text-transform: uppercase; color: #c9a84c;
          cursor: pointer; white-space: nowrap; min-width: 9.5rem;
          transition: background 0.2s ease, border-color 0.2s ease;
        }
        .nli-submit:hover:not(:disabled) { background: rgba(201, 168, 76, 0.14); border-color: rgba(201, 168, 76, 0.6); }
        .nli-submit:focus-visible { outline: 2px solid rgba(201, 168, 76, 0.6); outline-offset: 2px; }
        .nli-submit:disabled { cursor: default; letter-spacing: 0.1em; }

        /* Never red-alarm — a quiet line in the house voice, under the field. */
        .nli-error {
          font-family: Cormorant Garamond, Georgia, serif;
          font-style: italic; font-size: 0.85rem;
          color: rgba(240, 234, 216, 0.6);
          margin: 0.7rem 0 0; text-align: center; width: 100%; max-width: 420px;
        }

        .nli-dismiss {
          position: absolute; top: 0.55rem; right: 0.7rem;
          background: none; border: none; padding: 0.25rem 0.4rem;
          font-family: Cormorant Garamond, Georgia, serif;
          font-size: 1.05rem; line-height: 1;
          color: rgba(240, 234, 216, 0.28);
          cursor: pointer; transition: color 0.2s ease;
        }
        .nli-dismiss:hover { color: rgba(240, 234, 216, 0.6); }
        .nli-dismiss:focus-visible { outline: 1px solid rgba(201, 168, 76, 0.6); outline-offset: 2px; border-radius: 4px; }

        .nli-done {
          font-family: Cormorant Garamond, Georgia, serif;
          font-style: italic; font-size: 1.25rem; line-height: 1.5;
          color: #f0ead8; text-align: center; margin: 0;
          animation: nliDone ${FADE_MS}ms ease both;
        }
        @keyframes nliDone { from { opacity: 0; } to { opacity: 1; } }

        @media (max-width: 460px) {
          .nli-panel { padding: 1.5rem 1.15rem 1.35rem; }
          .nli-line { font-size: 1.18rem; }
          .nli-form { flex-direction: column; }
          /* flex-basis resolves against the MAIN axis — once the form stacks,
             the row layout's 1 1 190px basis would make the field 190px TALL.
             Reset the basis and let the field size to its own content. */
          .nli-input { flex: 0 0 auto; width: 100%; }
          .nli-submit { width: 100%; }
          /* Stacked, the two controls sit directly on top of each other, so
             their differing type sizes reading as two different heights is
             obvious in a way it never is side by side. */
          .nli-input, .nli-submit { min-height: 48px; }
        }
        /* iOS zooms any input under 16px on focus — the same guard the comment
           composer uses at the bottom of the story page's style block. */
        @media (max-width: 600px) {
          .nli-input { font-size: 16px; }
        }

        @media (prefers-reduced-motion: reduce) {
          .nli-panel { transition: none; }
          .nli-inner { transition: none; }
          .nli-done { animation: none; }
        }
      `}</style>
    </section>
  );
}
