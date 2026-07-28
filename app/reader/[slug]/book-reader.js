'use client';
// Bookstore reader — handles three cases for a published bookstore title:
//   1. ?sample=1 AND the title has a samplePath  → stream the PUBLIC sample EPUB in the Foliate
//      iframe (same vendor reader the stories use), with a slim persistent "Sample" banner.
//   2. no ?sample=1, and the reader OWNS the book → ask /api/bookstore/stream for a short-lived
//      signed URL to the master EPUB and stream it through the same iframe. R5b.
//   3. no ?sample=1 and no purchase → a clean interstitial pointing the reader to the Book
//      Store, now carrying the real buy button rather than a link to it.
//
// The master EPUB is `allow read: if false` in storage.rules and stays that way. Case 2 does not
// relax anything: functions/api/bookstore/stream.js checks the purchase server-side and returns a
// GCS V4 signed URL, which is a Cloud-Storage-level grant evaluated before Firebase's rule layer.
// The browser never holds a credential that could reach the file on its own.
//
// Progress saving is intentionally SKIPPED — for samples and, for now, for purchased books too.
// The stories reader's progress/bookmark machinery is tightly coupled to its postMessage
// handshake; reproducing it wasn't worth the surface area this round. When purchased-book
// progress does land it should key off `sample:{slug}` vs the real slug so the two never collide.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../lib/AuthContext';
import AuthModal from '../../components/AuthModal';
import BuyButton from '../../bookstore/components/BuyButton';
import { requestStreamUrl } from '../../lib/bookstore/stream';

function readSampleFlag() {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('sample') === '1';
}

// R4a: samples stream through the shared Reading Room host (public/reading-room.html), NOT the
// retired vendored calvary-reader.html. sample=1 keeps ribbons/progress off (this component wires
// neither). We honour the reader's saved paper/typeface prefs so a sample matches their settings.
// R5b: purchased books use the SAME builder — one code path to the Reading Room, so a typography
// fix can never land on one and miss the other. Only the `sample` flag differs.
const SAMPLE_PAPERS = { vellum: ['#f2ecd9', '#2b2418'], ivory: ['#faf7f0', '#1f1c16'], dusk: ['#211d16', '#ddd2b8'], ink: ['#0a0a0a', '#d9d2bf'] };
function roomSrc(url, { sample = false } = {}) {
  let p = { paper: 'vellum', face: 'cormorant', sizePct: 100, leading: 1.6, flow: 'paginated' };
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem('readingRoom.prefs');
      if (raw) p = { ...p, ...JSON.parse(raw) };
    }
  } catch {}
  const [bg, fg] = SAMPLE_PAPERS[p.paper] || SAMPLE_PAPERS.vellum;
  const qs = new URLSearchParams({
    url, bg, fg, face: p.face || 'cormorant', size: String(p.sizePct || 100),
    leading: String(p.leading || 1.6), flow: p.flow || 'paginated',
  });
  if (sample) qs.set('sample', '1');
  return '/reading-room.html?' + qs.toString();
}

export default function BookstoreReaderClient({ slug, title }) {
  const isSample = readSampleFlag() && !!title.samplePath;
  const { user, loading: authLoading } = useAuth();

  const [epubUrl, setEpubUrl] = useState(null);
  const [loadError, setLoadError] = useState(false);
  // R4a.1: the escape affordance belongs to the pre-reading frame only. The first relocate from
  // the Reading Room means the book has painted — reading has begun — so it retires for the
  // session and never returns. One-way latch: nothing sets this back to false.
  const [readingBegun, setReadingBegun] = useState(false);

  // Purchased path only. 'checking' covers both the auth resolution and the stream request, so
  // the reader sees one continuous beat rather than a spinner that stutters between two.
  //   checking → reading | signedout | not_purchased | revoked | failed
  const [gate, setGate] = useState('checking');
  const [gateMessage, setGateMessage] = useState(null);
  const [showAuth, setShowAuth] = useState(false);

  // The signed URL lives ~300s, which only has to cover the Reading Room's single fetch at
  // load. If that fetch fails — expired token, dropped connection, a cold bucket — we re-mint
  // ONCE and let the iframe try again. A retry loop on a genuinely missing file would hammer
  // both the endpoint and the bucket, so the latch is one-way per mount.
  const retriedRef = useRef(false);

  const fetchStreamUrl = useCallback(async () => {
    setGate('checking');
    setGateMessage(null);
    try {
      const { url } = await requestStreamUrl(user, title.id);
      setEpubUrl(url);
      setGate('reading');
      return true;
    } catch (e) {
      const code = e?.code;
      if (code === 'not_purchased') setGate('not_purchased');
      else if (code === 'revoked') setGate('revoked');
      else if (code === 'signed_out') setGate('signedout');
      else {
        console.error('[book-reader] stream request failed', e);
        setGate('failed');
        setGateMessage(e?.message || null);
      }
      return false;
    }
  }, [user, title.id]);

  // Origin-locked bridge from the Reading Room, per §4.4. Mounted for BOTH paths now: the
  // relocate latch matters to each, and the purchased path additionally needs the iframe's
  // own open-failure report, which is the only place a dead signed URL surfaces.
  useEffect(() => {
    const onMessage = (e) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'relocate') setReadingBegun(true);
      if (d.type === 'error' && !isSample) {
        if (retriedRef.current) {
          setGate('failed');
          setGateMessage(null);
          return;
        }
        retriedRef.current = true;
        console.warn('[book-reader] reading room could not open the file — re-minting once');
        setEpubUrl(null);
        fetchStreamUrl();
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [isSample, fetchStreamUrl]);

  // Prefer in-app history so the reader lands back where they came from; a shared sample link has
  // no same-origin referrer, so it falls through to a sensible home — the title's detail page for
  // a sample, the reader's own shelf for a book they own.
  const leaveReader = () => {
    let sameOriginReferrer = false;
    try {
      sameOriginReferrer = !!document.referrer && new URL(document.referrer).origin === window.location.origin;
    } catch { sameOriginReferrer = false; }
    if (sameOriginReferrer && window.history.length > 1) { window.history.back(); return; }
    if (!isSample && gate === 'reading') { window.location.href = '/my-library'; return; }
    window.location.href = slug ? `/bookstore/${slug}` : '/bookstore';
  };

  // ── Sample: the public sample EPUB, straight from Storage. Unchanged from R4a. ──
  useEffect(() => {
    if (!isSample) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const { storage } = await import('../../lib/firebase');
        const { ref, getDownloadURL } = await import('firebase/storage');
        const url = await getDownloadURL(ref(storage, title.samplePath));
        if (!cancelled) setEpubUrl(url);
      } catch (e) {
        console.error('[book-reader] sample download URL failed', e);
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [isSample, title.samplePath]);

  // ── Purchased: entitlement check + signed URL. ──
  useEffect(() => {
    if (isSample) return undefined;
    if (authLoading) { setGate('checking'); return undefined; }
    if (!user) { setGate('signedout'); return undefined; }
    let cancelled = false;
    (async () => {
      // fetchStreamUrl owns the state transitions; the guard only stops a resolved request
      // from writing state after an unmount or a fast user swap.
      if (!cancelled) await fetchStreamUrl();
    })();
    return () => { cancelled = true; };
  }, [isSample, authLoading, user, fetchStreamUrl]);

  const styles = (
    <style>{`
      *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
      html,body{height:100%;background:#1a0f0a}
      /* R4a.3: same named insets as the story reader, so the sample chrome is testable and the
         two paths cannot drift apart. */
      .br-root{--br-sat:env(safe-area-inset-top);--br-sab:env(safe-area-inset-bottom);
        --br-sal:env(safe-area-inset-left);--br-sar:env(safe-area-inset-right)}
      @keyframes spin{to{transform:rotate(360deg)}}
      @keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
      /* R4a.2: the sample chrome stacks top-down (48px bar, 34px banner, then the frame). Every
         offset now carries the notch inset so the bar — and the page beneath it — clear the clock. */
      /* R4a.3: padding-top MUST follow the padding shorthand — declared before it, the shorthand
         reset it to 0 and the bar grew taller without moving its content clear of the notch. */
      .br-top{position:fixed;top:0;left:0;right:0;height:calc(48px + var(--br-sat));z-index:200;display:flex;align-items:center;justify-content:space-between;padding:0 20px;padding-top:var(--br-sat);gap:8px;background:linear-gradient(to bottom,rgba(26,15,10,.96) 60%,transparent)}
      .br-logo{font-family:'Cinzel',serif;font-size:.52rem;letter-spacing:.2em;color:rgba(201,164,76,.45);text-decoration:none;text-transform:uppercase;white-space:nowrap}
      .br-logo:hover{color:rgba(201,164,76,.85)}
      .br-title{font-family:Cormorant Garamond,Georgia,serif;font-size:.72rem;font-style:italic;color:rgba(240,234,216,.28);letter-spacing:.04em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;text-align:center}
      .br-close{font-family:'Cinzel',serif;font-size:.5rem;letter-spacing:.12em;color:rgba(201,164,76,.5);text-decoration:none;text-transform:uppercase;white-space:nowrap;border:1px solid rgba(201,164,76,.25);border-radius:3px;padding:4px 9px}
      .br-close:hover{color:rgba(201,164,76,.9);border-color:rgba(201,164,76,.6)}
      .br-banner{position:fixed;top:calc(48px + var(--br-sat));left:0;right:0;height:34px;z-index:190;display:flex;align-items:center;justify-content:space-between;padding:0 20px;gap:12px;background:rgba(201,164,76,.08);border-bottom:1px solid rgba(201,164,76,.18)}
      .br-banner-label{font-family:'Cinzel',serif;font-size:.5rem;letter-spacing:.22em;text-transform:uppercase;color:#c9a44c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .br-banner-cta{font-family:'Cinzel',serif;font-size:.5rem;letter-spacing:.14em;text-transform:uppercase;color:#c9a44c;text-decoration:none;white-space:nowrap;font-weight:600}
      .br-banner-cta:hover{color:#f0ead8}
      /* Explicit width, not left+right: an abspos iframe with width:auto collapses to its
         intrinsic 300px rather than stretching between the insets. */
      .br-frame{position:fixed;top:calc(82px + var(--br-sat));left:var(--br-sal);border:none;display:block;
        width:calc(100vw - var(--br-sal) - var(--br-sar));
        height:calc(100dvh - 82px - var(--br-sat) - var(--br-sab))}
      /* R5b: a purchased book carries no sample banner, so its frame starts 34px higher. */
      .br-frame.br-frame-full{top:calc(48px + var(--br-sat));
        height:calc(100dvh - 48px - var(--br-sat) - var(--br-sab))}
      .br-center{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem;text-align:center;background:radial-gradient(ellipse 80% 60% at 50% 40%,rgba(107,47,173,.18) 0%,transparent 68%),#1a0f0a}
      .br-spin{width:34px;height:34px;border:2px solid rgba(201,164,76,.2);border-top-color:#c9a44c;border-radius:50%;animation:spin .9s linear infinite}
      .br-wait{margin-top:1.4rem;font-family:'Cinzel',serif;font-size:.5rem;letter-spacing:.22em;text-transform:uppercase;color:rgba(201,164,76,.5)}
      .br-escape{position:fixed;top:calc(88px + var(--br-sat));left:8px;z-index:195;display:inline-flex;align-items:center;min-height:44px;padding:0 12px;background:none;border:none;cursor:pointer;font-family:'Cinzel',serif;font-size:.5rem;letter-spacing:.18em;text-transform:uppercase;color:rgba(240,234,216,.7);white-space:nowrap}
      .br-escape:hover{color:rgba(240,234,216,.95)}
      /* The interstitial's buy button, matching the storefront's face. BuyButton renders its own
         failure line beneath, in the catalogue's voice. */
      .br-buy{font-family:'Cinzel',serif;font-size:.62rem;letter-spacing:.18em;text-transform:uppercase;color:#1a0f0a;background:#c9a44c;border:1px solid #c9a44c;border-radius:3px;padding:.85rem 2rem;cursor:pointer}
      .br-buy:hover:not(:disabled){background:#e0bb63;border-color:#e0bb63}
      .br-buy:disabled{opacity:.6;cursor:default}
      .br-alt{margin-top:1.1rem;font-family:'Cinzel',serif;font-size:.55rem;letter-spacing:.16em;text-transform:uppercase;color:rgba(201,164,76,.6);text-decoration:none}
      .br-alt:hover{color:#c9a44c}
    `}</style>
  );

  // The purchased path sends readers back to their shelf; a sample belongs to the store.
  const homeHref = isSample ? `/bookstore/${slug}` : '/my-library';
  const homeLabel = isSample ? '← Store' : '← Library';

  const TopBar = (
    <div className="br-top">
      <a href="/" className="br-logo">Calvary Scribblings</a>
      <span className="br-title">{title.title}</span>
      <a href={homeHref} className="br-close">{homeLabel}</a>
    </div>
  );

  // PLAIN FUNCTIONS, called as `frame(...)` / `shell(...)` — deliberately NOT components
  // rendered as <Frame />. A component declared inside the render body gets a fresh identity on
  // every render, so React unmounts and remounts its whole subtree; the iframe would reload and
  // the book would jump back to page one the moment `readingBegun` latched on the first
  // relocate. Calling them inlines the elements into this tree, where reconciliation is stable.
  const frame = ({ full, label }) => (
    <iframe
      className={`br-frame${full ? ' br-frame-full' : ''}`}
      src={roomSrc(epubUrl, { sample: !full })}
      title={label}
      sandbox="allow-scripts allow-same-origin"
    />
  );

  const shell = (children) => (
    <div className="br-root" style={{ width: '100vw', height: '100vh', background: '#1a0f0a', overflow: 'hidden', fontFamily: "Cormorant Garamond, Georgia, serif" }}>
      {styles}
      {TopBar}
      {children}
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </div>
  );

  // ── Purchased path ────────────────────────────────────────────────────────────
  if (!isSample) {
    if (gate === 'reading' && epubUrl) {
      return (
        shell(<>
          {!readingBegun && (
            <button type="button" className="br-escape" onClick={leaveReader} style={{ top: 'calc(54px + var(--br-sat))' }}>&larr; My Library</button>
          )}
          {frame({ full: true, label: title.title })}
        </>)
      );
    }

    if (gate === 'checking') {
      return (
        shell(<>
          <div className="br-center">
            <div className="br-spin" />
            <div className="br-wait">Unlocking your copy</div>
          </div>
        </>)
      );
    }

    if (gate === 'signedout') {
      return (
        shell(<>
          <div className="br-center" style={{ animation: 'fadeUp .6s ease forwards' }}>
            <div style={{ fontSize: '.9rem', letterSpacing: '.4em', color: 'rgba(201,164,76,.35)', marginBottom: '1.5rem' }}>&#10086;</div>
            <div style={{ fontFamily: "'Cinzel',serif", fontSize: '.58rem', letterSpacing: '.28em', textTransform: 'uppercase', color: '#c9a44c', marginBottom: '1.4rem' }}>Your Library</div>
            <h1 style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 'clamp(1.5rem,4vw,2.2rem)', fontWeight: 300, fontStyle: 'italic', color: '#f5efe0', lineHeight: 1.2, marginBottom: '.6rem', maxWidth: '520px' }}>{title.title}</h1>
            <p style={{ fontSize: '1rem', color: 'rgba(240,234,216,.5)', fontStyle: 'italic', maxWidth: '440px', lineHeight: 1.7, marginBottom: '2.2rem' }}>Sign in to open the copy on your shelf.</p>
            <button type="button" className="br-buy" onClick={() => setShowAuth(true)}>Sign in</button>
            <a className="br-alt" href={`/bookstore/${slug}`}>View in the Book Store →</a>
          </div>
        </>)
      );
    }

    if (gate === 'revoked') {
      return (
        shell(<>
          <div className="br-center" style={{ animation: 'fadeUp .6s ease forwards' }}>
            <div style={{ fontSize: '.9rem', letterSpacing: '.4em', color: 'rgba(201,164,76,.35)', marginBottom: '1.5rem' }}>&#10086;</div>
            <div style={{ fontFamily: "'Cinzel',serif", fontSize: '.58rem', letterSpacing: '.28em', textTransform: 'uppercase', color: '#c9a44c', marginBottom: '1.4rem' }}>Access Withdrawn</div>
            <h1 style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 'clamp(1.5rem,4vw,2.2rem)', fontWeight: 300, fontStyle: 'italic', color: '#f5efe0', lineHeight: 1.2, marginBottom: '.6rem', maxWidth: '520px' }}>{title.title}</h1>
            <p style={{ fontSize: '1rem', color: 'rgba(240,234,216,.5)', fontStyle: 'italic', maxWidth: '440px', lineHeight: 1.7, marginBottom: '2.2rem' }}>
              Access to this book was withdrawn — usually after a refund or a disputed payment. If that
              looks wrong, do get in touch.
            </p>
            <a href={`/bookstore/${slug}`} style={{ fontFamily: "'Cinzel',serif", fontSize: '.62rem', letterSpacing: '.18em', textTransform: 'uppercase', color: '#c9a44c', textDecoration: 'none', border: '1px solid rgba(201,164,76,.4)', borderRadius: '3px', padding: '.85rem 2rem', background: 'rgba(201,164,76,.04)' }}>View in the Book Store →</a>
          </div>
        </>)
      );
    }

    if (gate === 'failed') {
      return (
        shell(<>
          <div className="br-center">
            <p style={{ fontSize: '1rem', color: 'rgba(240,234,216,.5)', fontStyle: 'italic', maxWidth: '420px', lineHeight: 1.7, marginBottom: '1.6rem' }}>
              {gateMessage || 'We couldn’t open your copy just now.'}
            </p>
            <button
              type="button"
              className="br-buy"
              onClick={() => { retriedRef.current = false; setEpubUrl(null); fetchStreamUrl(); }}
            >
              Try again
            </button>
            <a className="br-alt" href="/my-library">Back to My Library →</a>
          </div>
        </>)
      );
    }

    // gate === 'not_purchased' — the R4a interstitial, now carrying the working buy button
    // rather than a link to the page that has one. Same copy, one fewer tap to a sale.
    return (
      shell(<>
        <div className="br-center" style={{ animation: 'fadeUp .6s ease forwards' }}>
          <div style={{ fontSize: '.9rem', letterSpacing: '.4em', color: 'rgba(201,164,76,.35)', marginBottom: '1.5rem' }}>&#10086;</div>
          <div style={{ fontFamily: "'Cinzel',serif", fontSize: '.58rem', letterSpacing: '.28em', textTransform: 'uppercase', color: '#c9a44c', marginBottom: '1.4rem' }}>In the Book Store</div>
          <h1 style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 'clamp(1.5rem,4vw,2.2rem)', fontWeight: 300, fontStyle: 'italic', color: '#f5efe0', lineHeight: 1.2, marginBottom: '.6rem', maxWidth: '520px' }}>{title.title}</h1>
          <p style={{ fontSize: '1rem', color: 'rgba(240,234,216,.5)', fontStyle: 'italic', maxWidth: '440px', lineHeight: 1.7, marginBottom: '2.2rem' }}>This book is available in the Book Store.</p>
          <BuyButton title={title} className="br-buy" align="center" />
          <a className="br-alt" href={`/bookstore/${slug}`}>View in the Book Store →</a>
        </div>
      </>)
    );
  }

  // ── Sample mode. ──────────────────────────────────────────────────────────────
  return (
    shell(<>
      <div className="br-banner">
        <span className="br-banner-label">Sample · {title.title}</span>
        <a href={`/bookstore/${slug}`} className="br-banner-cta">Get the full book →</a>
      </div>
      {!readingBegun && (
        <button type="button" className="br-escape" onClick={leaveReader}>&larr; The Book Store</button>
      )}
      {loadError ? (
        <div className="br-center">
          <p style={{ fontSize: '1rem', color: 'rgba(240,234,216,.5)', fontStyle: 'italic', maxWidth: '420px', lineHeight: 1.7, marginBottom: '1.6rem' }}>We couldn&rsquo;t load this sample just now.</p>
          <a href={`/bookstore/${slug}`} style={{ fontFamily: "'Cinzel',serif", fontSize: '.6rem', letterSpacing: '.18em', textTransform: 'uppercase', color: '#c9a44c', textDecoration: 'none', border: '1px solid rgba(201,164,76,.4)', borderRadius: '3px', padding: '.8rem 1.8rem' }}>Back to the Book Store →</a>
        </div>
      ) : epubUrl ? (
        frame({ label: `${title.title} (sample)` })
      ) : (
        <div className="br-center"><div className="br-spin" /></div>
      )}
    </>)
  );
}
