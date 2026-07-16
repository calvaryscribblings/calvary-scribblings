'use client';
// The gateway — the front door at /. Two doors: the Public Library (the reading platform,
// which is where the content and the link equity live) and the Book Store (a modal only —
// the /bookstore route stays unlinked until launch, per the bookstore workstream's protocol).
import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { VEIL_AT, PUSH_AT, VEIL_FADE } from '../lib/gatewayTransition';

// The dial. When true, a returning visitor who last chose the Library is sent straight there
// and never sees the gateway again. Currently false: the gateway is the front door on every
// visit. The ?gateway=1 escape hatch and the localStorage write below stay in place but are
// inert while this is false — flipping this one const restores the old behaviour, and any
// visitor who has tapped the Library door since is already tagged.
//
// This is deliberately client-only and localStorage-gated: crawlers carry no localStorage,
// so bots always render the full gateway. Never make this a server or <meta> redirect.
const AUTO_ROUTE = false;

const CHOICE_KEY = 'cs_gateway_choice';
// Handed to /public-library so it knows to fade up from the veil rather than just appear.
// sessionStorage, not local: it must not survive the tab, and a refresh must load plainly.
const ARRIVING_KEY = 'cs_arriving';
const LIBRARY = '/public-library';

// Ambient drifting glyphs. Negative delays stagger them so the loop is already mid-flight
// on first paint rather than all ten rising together.
const LETTERS = [
  { ch: 'S', left: '5%', size: 66, o: 0.10, dur: 26, delay: -4, italic: false },
  { ch: 'a', left: '16%', size: 32, o: 0.15, dur: 33, delay: -16, italic: true },
  { ch: 'e', left: '27%', size: 50, o: 0.09, dur: 38, delay: -9, italic: false },
  { ch: 'k', left: '39%', size: 27, o: 0.16, dur: 29, delay: -22, italic: true },
  { ch: 'O', left: '52%', size: 58, o: 0.08, dur: 41, delay: -2, italic: false },
  { ch: 'n', left: '64%', size: 30, o: 0.15, dur: 31, delay: -25, italic: true },
  { ch: 'g', left: '76%', size: 46, o: 0.10, dur: 36, delay: -12, italic: false },
  { ch: 'i', left: '87%', size: 34, o: 0.13, dur: 27, delay: -19, italic: true },
  { ch: 't', left: '10%', size: 24, o: 0.12, dur: 34, delay: -28, italic: true },
  { ch: 'r', left: '70%', size: 22, o: 0.11, dur: 30, delay: -6, italic: false },
];

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

const prefersReducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

function Modal({ id, titleId, title, onClose, closeLabel = 'RETURN TO THE ISLAND', children }) {
  const panelRef = useRef(null);
  const closeRef = useRef(null);
  // Where focus came from, so it can be handed back when the dialog closes.
  const restoreRef = useRef(null);

  useEffect(() => {
    restoreRef.current = document.activeElement;
    closeRef.current?.focus();
    const el = restoreRef.current;
    return () => {
      if (el && typeof el.focus === 'function') el.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      // Focus trap: cycle within the panel rather than escaping to the page behind.
      const items = panelRef.current?.querySelectorAll(FOCUSABLE);
      if (!items || !items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="cs-gw-backdrop"
      id={id}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="cs-gw-modal" ref={panelRef}>
        <h2 className="cs-gw-modal-title" id={titleId}>{title}</h2>
        <div className="cs-gw-rule" />
        {children}
        <button className="cs-gw-modal-close" type="button" onClick={onClose} ref={closeRef}>
          {closeLabel}
        </button>
      </div>
    </div>
  );
}

export default function Gateway() {
  const router = useRouter();
  const [modal, setModal] = useState(null); // 'store' | 'universe' | null
  const [exiting, setExiting] = useState(false);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    if (!AUTO_ROUTE) return;
    let params;
    try {
      params = new URLSearchParams(window.location.search);
    } catch {
      return;
    }
    // ?gateway=1 is the escape hatch: always show the gateway, and forget the stored choice.
    if (params.get('gateway') === '1') {
      try { localStorage.removeItem(CHOICE_KEY); } catch {}
      return;
    }
    let choice = null;
    try { choice = localStorage.getItem(CHOICE_KEY); } catch {}
    if (choice === 'library') router.replace(LIBRARY);
  }, [router]);

  const rememberLibrary = useCallback(() => {
    try { localStorage.setItem(CHOICE_KEY, 'library'); } catch {}
  }, []);

  // Walking into the door: the tapped door swells and brightens while everything else
  // falls away, a veil closes over the room, and a hairline of light appears under it.
  // The Book Store door should call this too once it becomes real navigation at launch —
  // pass its own href and it inherits the whole exit.
  const walkThrough = useCallback((e, href) => {
    rememberLibrary();
    // Reduced motion: no choreography, and no arrival flag, so the far side loads plainly.
    if (prefersReducedMotion()) return;
    e.preventDefault();
    if (exiting) return;
    setExiting(true);
    timer.current = setTimeout(() => {
      try { sessionStorage.setItem(ARRIVING_KEY, '1'); } catch {}
      router.push(href);
    }, PUSH_AT);
  }, [exiting, rememberLibrary, router]);

  const closeModal = useCallback(() => setModal(null), []);

  return (
    <div className={`cs-gw${exiting ? ' is-exiting' : ''}`}>
      <style>{`
        .cs-gw {
          --gw-night:#0b0716; --gw-deep:#080610; --gw-gold:#c9a84c;
          --gw-gold-bright:#e2c876; --gw-cream:#f5f0e8; --gw-veil:#050309;
          --gw-serif:'Cormorant Garamond',Georgia,serif;
          --gw-display:'Cinzel',Georgia,serif;
          /* Sized in vmin so the glow scales with the viewport instead of hugging a
             phone-width column. */
          background:radial-gradient(120vmin 80vmin at 50% -6vmin,
            #1c0f38 0%, var(--gw-night) 55%, var(--gw-deep) 100%);
          min-height:100vh; position:relative; overflow:hidden;
          display:flex; justify-content:center; font-family:var(--gw-serif);
        }
        .cs-gw *,.cs-gw *::before,.cs-gw *::after { box-sizing:border-box; margin:0; padding:0; }
        .cs-gw.is-exiting { pointer-events:none; }

        /* Letters drift across the whole viewport at every size, not just the column. */
        .cs-gw-letters { position:fixed; inset:0; overflow:hidden; pointer-events:none; z-index:1; }
        .cs-gw-panel {
          width:100%; max-width:420px; min-height:100vh; position:relative; z-index:2;
          display:flex; flex-direction:column; justify-content:center;
          padding:56px 22px 34px; text-align:center;
        }
        .cs-gw-fl {
          position:absolute; font-family:var(--gw-serif); color:var(--gw-gold);
          user-select:none; pointer-events:none; bottom:-140px;
          animation:cs-gw-drift linear infinite;
        }
        @keyframes cs-gw-drift {
          0% { transform:translateY(0) rotate(-6deg); opacity:0; }
          10% { opacity:var(--o); }
          85% { opacity:var(--o); }
          100% { transform:translateY(calc(-100vh - 180px)) rotate(8deg); opacity:0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .cs-gw-fl { animation:none; opacity:calc(var(--o) * .8); bottom:auto; }
          .cs-gw-fl:nth-of-type(odd) { top:12%; }
          .cs-gw-fl:nth-of-type(even) { top:64%; }
        }
        .cs-gw-content { position:relative; z-index:2; }
        .cs-gw-logo {
          width:58px; height:auto; margin:0 auto 16px; display:block;
          /* drop-shadow follows the artwork's alpha; box-shadow would draw a rectangle. */
          filter:drop-shadow(0 6px 18px rgba(0,0,0,0.5));
        }
        .cs-gw-wordmark {
          font-family:var(--gw-display); font-size:14px; letter-spacing:.32em;
          color:var(--gw-cream); margin-bottom:7px;
        }
        .cs-gw-tagline { font-style:italic; font-size:18px; color:var(--gw-gold); margin-bottom:34px; }
        .cs-gw-doors { display:flex; gap:11px; margin-bottom:15px; }
        .cs-gw-door {
          flex:1; background:rgba(8,6,16,.5); border:1px solid rgba(201,168,76,.38);
          border-radius:15px; padding:22px 12px 19px; color:inherit; text-decoration:none;
          cursor:pointer; font-family:inherit; display:block;
          transition:border-color .2s, transform .2s;
        }
        .cs-gw-door:hover,.cs-gw-door:focus-visible { border-color:var(--gw-gold); transform:translateY(-2px); }
        .cs-gw-door:focus-visible,.cs-gw-pill:focus-visible,.cs-gw-small a:focus-visible,
        .cs-gw-small button:focus-visible,.cs-gw-modal-close:focus-visible,
        .cs-gw-arm-link:focus-visible {
          outline:2px solid var(--gw-gold-bright); outline-offset:3px;
        }
        .cs-gw-door .cs-gw-glyph { font-size:24px; line-height:1; margin-bottom:11px; color:var(--gw-gold); }
        .cs-gw-door h2 {
          font-family:var(--gw-display); font-weight:600; font-size:13px; letter-spacing:.12em;
          color:var(--gw-cream); line-height:1.5; margin-bottom:6px;
        }
        .cs-gw-door p { font-style:italic; font-size:14.5px; color:rgba(245,240,232,.7); }
        .cs-gw-door p.cs-gw-opens { color:var(--gw-gold-bright); }
        .cs-gw-pill {
          display:block; width:100%; border:1px solid var(--gw-gold); background:transparent;
          border-radius:999px; padding:13px; cursor:pointer; text-decoration:none;
          margin-bottom:24px; transition:background .2s;
        }
        .cs-gw-pill:hover,.cs-gw-pill:focus-visible { background:rgba(201,168,76,.08); }
        .cs-gw-pill span {
          font-family:var(--gw-display); font-size:12.5px; letter-spacing:.24em; color:var(--gw-gold);
        }
        .cs-gw-small { display:flex; gap:26px; justify-content:center; margin-bottom:30px; }
        .cs-gw-small a,.cs-gw-small button {
          font-family:var(--gw-serif); font-style:italic; font-size:16px;
          color:rgba(245,240,232,.85); text-decoration:none;
          border:none; background:none; cursor:pointer; padding:0 0 2px;
          border-bottom:1px solid rgba(201,168,76,.5);
        }
        .cs-gw-small a:hover,.cs-gw-small button:hover { color:var(--gw-cream); border-color:var(--gw-gold); }
        .cs-gw-foot {
          font-family:var(--gw-display); font-size:9.5px; letter-spacing:.22em; color:rgba(245,240,232,.38);
        }
        .cs-gw-seo { margin-top:26px; }
        .cs-gw-seo p {
          font-family:var(--gw-serif); font-size:13px; line-height:1.65;
          color:rgba(245,240,232,.5); margin-bottom:12px;
        }
        /* Clear the cookie banner on phones so the first impression isn't obscured. */
        @media (max-width:480px) { .cs-gw-seo { padding-bottom:72px; } }

        /* ── Exit choreography ─────────────────────────────────────────────── */
        .is-exiting .cs-gw-fade { opacity:0; transition:opacity 350ms ease; }
        .cs-gw-door.is-entering {
          border-color:var(--gw-gold-bright); transform:scale(1.05); transform-origin:center;
          transition:transform 500ms ease-out, border-color 500ms ease-out;
        }
        .cs-gw-veil {
          /* Above everything, including the cookie banner (z 9999) — otherwise the banner
             stays crisp while the room falls away, and the exit reads as a bug. */
          position:fixed; inset:0; background:var(--gw-veil); z-index:10000; opacity:0;
          display:flex; align-items:center; justify-content:center;
          animation:cs-gw-veil-in ${VEIL_FADE}ms ease ${VEIL_AT}ms forwards;
        }
        @keyframes cs-gw-veil-in { to { opacity:1; } }
        /* The light under the door. */
        .cs-gw-hairline {
          width:0; height:1px; background:var(--gw-gold);
          animation:cs-gw-hairline-in 400ms ease ${VEIL_AT}ms forwards;
        }
        @keyframes cs-gw-hairline-in { to { width:120px; } }

        /* ── Modals ────────────────────────────────────────────────────────── */
        .cs-gw-backdrop {
          position:fixed; inset:0; background:rgba(4,3,9,.78); backdrop-filter:blur(3px);
          display:flex; align-items:center; justify-content:center; z-index:10; padding:24px;
        }
        .cs-gw-modal {
          width:100%; max-width:340px; background:#120a24; border:1px solid var(--gw-gold);
          border-radius:18px; padding:30px 24px 26px; text-align:center; position:relative;
          font-family:var(--gw-serif);
        }
        .cs-gw-rule { width:60px; height:1px; background:var(--gw-gold); margin:14px auto; }
        .cs-gw-modal-title {
          font-family:var(--gw-display); font-size:15px; letter-spacing:.2em;
          color:var(--gw-cream); font-weight:600;
        }
        .cs-gw-modal p { font-size:16.5px; color:rgba(245,240,232,.85); line-height:1.55; }
        .cs-gw-modal p em { color:var(--gw-gold-bright); }
        .cs-gw-modal-fine {
          font-style:italic; font-size:14.5px; margin-top:12px; color:rgba(245,240,232,.6);
        }
        .cs-gw-modal-close {
          margin-top:20px; background:none; border:1px solid rgba(201,168,76,.5);
          border-radius:999px; padding:8px 22px; font-family:var(--gw-display);
          font-size:11px; letter-spacing:.18em; color:var(--gw-gold); cursor:pointer;
        }
        .cs-gw-modal-close:hover { background:rgba(201,168,76,.08); }
        .cs-gw-arm {
          display:flex; align-items:center; gap:13px; text-align:left; padding:13px 10px;
          border-bottom:1px solid rgba(201,168,76,.16); text-decoration:none; color:inherit;
        }
        .cs-gw-arm:last-of-type { border-bottom:none; }
        .cs-gw-arm-glyph { font-size:20px; color:var(--gw-gold); width:26px; text-align:center; flex:none; }
        .cs-gw-arm h3 {
          font-family:var(--gw-display); font-size:12.5px; letter-spacing:.1em;
          color:var(--gw-cream); margin-bottom:2px; font-weight:600;
        }
        .cs-gw-arm p { font-style:italic; font-size:13.5px; color:rgba(245,240,232,.65); line-height:1.4; }
        .cs-gw-arm-link { display:flex; }
        .cs-gw-arm-link:hover h3 { color:var(--gw-gold-bright); }
        .cs-gw-arm-btn {
          width:100%; background:none; border-left:none; border-right:none; border-top:none;
          font-family:var(--gw-serif); cursor:pointer;
        }
        .cs-gw-arm-btn:focus-visible { outline:2px solid var(--gw-gold-bright); outline-offset:-2px; }

        /* ── The foyer ─────────────────────────────────────────────────────────
           Tablet takes the desktop composition, tighter; ≥900px opens up fully. */
        @media (min-width:768px) {
          .cs-gw-panel { max-width:600px; padding:64px 32px 44px; }
          .cs-gw-logo { width:72px; margin-bottom:20px; }
          .cs-gw-wordmark { font-size:15.5px; letter-spacing:.33em; }
          .cs-gw-tagline { font-size:20px; margin-bottom:40px; }
          .cs-gw-doors { gap:16px; margin-bottom:18px; }
          .cs-gw-door { padding:36px 18px 30px; border-radius:17px; }
          .cs-gw-door .cs-gw-glyph { font-size:29px; margin-bottom:14px; }
          .cs-gw-door h2 { font-size:14px; }
          .cs-gw-door p { font-size:15.5px; }
          .cs-gw-pill { padding:15px; margin-bottom:28px; }
          .cs-gw-pill span { font-size:13px; }
          .cs-gw-small { gap:32px; font-size:17px; margin-bottom:34px; }
          .cs-gw-seo { max-width:560px; margin-left:auto; margin-right:auto; }
          .cs-gw-modal { max-width:400px; }
        }
        @media (min-width:900px) {
          .cs-gw-panel { max-width:720px; padding:72px 40px 52px; }
          .cs-gw-logo { width:84px; margin-bottom:22px; }
          .cs-gw-wordmark { font-size:17px; letter-spacing:.34em; margin-bottom:9px; }
          .cs-gw-tagline { font-size:22px; margin-bottom:46px; }
          .cs-gw-doors { gap:20px; margin-bottom:20px; }
          .cs-gw-door { padding:48px 22px; border-radius:18px; }
          .cs-gw-door .cs-gw-glyph { font-size:34px; margin-bottom:16px; }
          .cs-gw-door h2 { font-size:15px; margin-bottom:8px; }
          .cs-gw-door p { font-size:16.5px; }
          .cs-gw-pill { padding:16px; margin-bottom:30px; }
          .cs-gw-pill span { font-size:13.5px; letter-spacing:.26em; }
          .cs-gw-small { gap:38px; font-size:18px; margin-bottom:38px; }
          .cs-gw-foot { font-size:10.5px; }
          .cs-gw-seo { margin-top:32px; }
          .cs-gw-seo p { font-size:14px; }
        }
      `}</style>

      <div className="cs-gw-letters cs-gw-fade" aria-hidden="true">
        {LETTERS.map((l, i) => (
          <span
            key={i}
            className="cs-gw-fl"
            style={{
              left: l.left,
              fontSize: l.size,
              fontStyle: l.italic ? 'italic' : 'normal',
              '--o': l.o,
              animationDuration: `${l.dur}s`,
              animationDelay: `${l.delay}s`,
            }}
          >
            {l.ch}
          </span>
        ))}
      </div>

      <div className="cs-gw-panel">
        <div className="cs-gw-content">
          <img className="cs-gw-logo cs-gw-fade" src="/cs-logo-512-v3.png" alt="" width="512" height="548" />
          <div className="cs-gw-wordmark cs-gw-fade">CALVARY SCRIBBLINGS</div>
          <h1 className="cs-gw-tagline cs-gw-fade">Welcome to the Story Island</h1>

          <div className="cs-gw-doors">
            <Link
              className={`cs-gw-door${exiting ? ' is-entering' : ''}`}
              href={LIBRARY}
              onClick={(e) => walkThrough(e, LIBRARY)}
            >
              <div className="cs-gw-glyph" aria-hidden="true">⁂</div>
              <h2>PUBLIC LIBRARY<br />&amp; OPEN PAGES</h2>
              <p>Stories, poetry &amp; your own pages</p>
            </Link>
            <button className="cs-gw-door cs-gw-fade" type="button" onClick={() => setModal('store')}>
              <div className="cs-gw-glyph" aria-hidden="true">❦</div>
              <h2>THE<br />BOOK STORE</h2>
              <p className="cs-gw-opens">Opens 30 September</p>
            </button>
          </div>

          <Link className="cs-gw-pill cs-gw-fade" href="/ai-policy">
            <span>✦&nbsp;&nbsp;OUR AI POLICY&nbsp;&nbsp;✦</span>
          </Link>

          <div className="cs-gw-small cs-gw-fade">
            <Link href="/voices">Voices of the Island</Link>
            <button type="button" onClick={() => setModal('universe')}>The Calvary Universe</button>
          </div>

          <div className="cs-gw-foot cs-gw-fade">A CALVARY MEDIA UK PUBLICATION</div>

          {/* Real, visible, crawlable prose. The doors and the pill are the navigation —
              deliberately no category link row here. */}
          <div className="cs-gw-seo cs-gw-fade">
            <p>
              Calvary Scribblings publishes original fiction, poetry and essays from a new
              generation of writers. The Public Library is open to everyone — flash fiction,
              short stories, poetry and news, free to read. The Book Store opens on
              30 September.
            </p>
          </div>
        </div>
      </div>

      {exiting && (
        <div className="cs-gw-veil" aria-hidden="true">
          <div className="cs-gw-hairline" />
        </div>
      )}

      {modal === 'store' && (
        <Modal id="cs-gw-store" titleId="cs-gw-store-title" title="THE BOOK STORE" onClose={closeModal}>
          <p>
            The shelves are being built and the ink is drying.<br />
            <em>The Book Store opens its doors on 30 September.</em>
          </p>
          <p className="cs-gw-modal-fine">
            Your favourite books, from your favourite authors — human-made, cover to cover.
          </p>
        </Modal>
      )}

      {modal === 'universe' && (
        <Modal id="cs-gw-universe" titleId="cs-gw-universe-title" title="THE CALVARY UNIVERSE" onClose={closeModal} closeLabel="CLOSE">
          {/* You are already here — this row just dismisses the dialog. */}
          <button className="cs-gw-arm cs-gw-arm-link cs-gw-arm-btn" type="button" onClick={closeModal}>
            <div className="cs-gw-arm-glyph" aria-hidden="true">❦</div>
            <div>
              <h3>CALVARY SCRIBBLINGS</h3>
              <p>The Story Island — literary publishing</p>
            </div>
          </button>
          <a className="cs-gw-arm cs-gw-arm-link" href="https://calvaryfilms.co.uk" target="_blank" rel="noopener noreferrer">
            <div className="cs-gw-arm-glyph" aria-hidden="true">✧</div>
            <div>
              <h3>CALVARY FILMS</h3>
              <p>Stories for the screen</p>
            </div>
          </a>
          <div className="cs-gw-arm">
            <div className="cs-gw-arm-glyph" aria-hidden="true">♪</div>
            <div>
              <h3>CALVARY RADIO</h3>
              <p>The island, on air</p>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
