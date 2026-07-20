'use client';
// Bookstore reader — handles two cases for a published bookstore title:
//   1. ?sample=1 AND the title has a samplePath  → stream the PUBLIC sample EPUB in the Foliate
//      iframe (same vendor reader the stories use), with a slim persistent "Sample" banner.
//   2. no ?sample=1 (or sample requested with no sample on file) → a clean interstitial pointing
//      the reader to the Book Store. We deliberately never touch the master EPUB here — that's
//      admin-only in Storage and purchased access arrives with Phase B's streaming Worker.
//
// Progress saving is intentionally SKIPPED for samples. The stories reader's progress/bookmark
// machinery is tightly coupled to its postMessage handshake; reproducing it for a short sample
// wasn't worth the surface area. Samples are a chapter or two — reopening restarts them. When
// purchased-book progress lands in Phase B it should key off `sample:{slug}` vs the real slug so
// the two never collide.
import { useEffect, useState } from 'react';
import { useViewportFitCover } from '../../lib/viewportFit';

function readSampleFlag() {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('sample') === '1';
}

// R4a: samples stream through the shared Reading Room host (public/reading-room.html), NOT the
// retired vendored calvary-reader.html. sample=1 keeps ribbons/progress off (this component wires
// neither). We honour the reader's saved paper/typeface prefs so a sample matches their settings.
const SAMPLE_PAPERS = { vellum: ['#f2ecd9', '#2b2418'], ivory: ['#faf7f0', '#1f1c16'], dusk: ['#211d16', '#ddd2b8'], ink: ['#0a0a0a', '#d9d2bf'] };
function sampleRoomSrc(url) {
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
    leading: String(p.leading || 1.6), flow: p.flow || 'paginated', sample: '1',
  });
  return '/reading-room.html?' + qs.toString();
}

export default function BookstoreReaderClient({ slug, title }) {
  useViewportFitCover();
  const isSample = readSampleFlag() && !!title.samplePath;
  const [epubUrl, setEpubUrl] = useState(null);
  const [loadError, setLoadError] = useState(false);
  // R4a.1: the escape affordance belongs to the pre-reading frame only. The first relocate from
  // the Reading Room means the book has painted — reading has begun — so it retires for the
  // session and never returns. One-way latch: nothing sets this back to false.
  const [readingBegun, setReadingBegun] = useState(false);

  useEffect(() => {
    if (!isSample) return undefined;
    const onMessage = (e) => {
      if (e.origin !== window.location.origin) return; // origin lock, per §4.4
      if (e.data && e.data.type === 'relocate') setReadingBegun(true);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [isSample]);

  // Prefer in-app history so the reader lands back where they came from; a shared sample link has
  // no same-origin referrer, so it falls through to the title's detail page, then the store index.
  const leaveReader = () => {
    let sameOriginReferrer = false;
    try {
      sameOriginReferrer = !!document.referrer && new URL(document.referrer).origin === window.location.origin;
    } catch { sameOriginReferrer = false; }
    if (sameOriginReferrer && window.history.length > 1) { window.history.back(); return; }
    window.location.href = slug ? `/bookstore/${slug}` : '/bookstore';
  };

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

  const styles = (
    <style>{`
      *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
      html,body{height:100%;background:#1a0f0a}
      @keyframes spin{to{transform:rotate(360deg)}}
      @keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
      /* R4a.2: the sample chrome stacks top-down (48px bar, 34px banner, then the frame). Every
         offset now carries the notch inset so the bar — and the page beneath it — clear the clock. */
      .br-top{position:fixed;top:0;left:0;right:0;height:calc(48px + env(safe-area-inset-top));padding-top:env(safe-area-inset-top);z-index:200;display:flex;align-items:center;justify-content:space-between;padding:0 20px;gap:8px;background:linear-gradient(to bottom,rgba(26,15,10,.96) 60%,transparent)}
      .br-logo{font-family:'Cinzel',serif;font-size:.52rem;letter-spacing:.2em;color:rgba(201,164,76,.45);text-decoration:none;text-transform:uppercase;white-space:nowrap}
      .br-logo:hover{color:rgba(201,164,76,.85)}
      .br-title{font-family:Cormorant Garamond,Georgia,serif;font-size:.72rem;font-style:italic;color:rgba(240,234,216,.28);letter-spacing:.04em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;text-align:center}
      .br-close{font-family:'Cinzel',serif;font-size:.5rem;letter-spacing:.12em;color:rgba(201,164,76,.5);text-decoration:none;text-transform:uppercase;white-space:nowrap;border:1px solid rgba(201,164,76,.25);border-radius:3px;padding:4px 9px}
      .br-close:hover{color:rgba(201,164,76,.9);border-color:rgba(201,164,76,.6)}
      .br-banner{position:fixed;top:calc(48px + env(safe-area-inset-top));left:0;right:0;height:34px;z-index:190;display:flex;align-items:center;justify-content:space-between;padding:0 20px;gap:12px;background:rgba(201,164,76,.08);border-bottom:1px solid rgba(201,164,76,.18)}
      .br-banner-label{font-family:'Cinzel',serif;font-size:.5rem;letter-spacing:.22em;text-transform:uppercase;color:#c9a44c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .br-banner-cta{font-family:'Cinzel',serif;font-size:.5rem;letter-spacing:.14em;text-transform:uppercase;color:#c9a44c;text-decoration:none;white-space:nowrap;font-weight:600}
      .br-banner-cta:hover{color:#f0ead8}
      /* Explicit width, not left+right: an abspos iframe with width:auto collapses to its
         intrinsic 300px rather than stretching between the insets. */
      .br-frame{position:fixed;top:calc(82px + env(safe-area-inset-top));left:env(safe-area-inset-left);border:none;display:block;
        width:calc(100vw - env(safe-area-inset-left) - env(safe-area-inset-right));
        height:calc(100dvh - 82px - env(safe-area-inset-top) - env(safe-area-inset-bottom))}
      .br-center{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem;text-align:center;background:radial-gradient(ellipse 80% 60% at 50% 40%,rgba(107,47,173,.18) 0%,transparent 68%),#1a0f0a}
      .br-spin{width:34px;height:34px;border:2px solid rgba(201,164,76,.2);border-top-color:#c9a44c;border-radius:50%;animation:spin .9s linear infinite}
      .br-escape{position:fixed;top:calc(88px + env(safe-area-inset-top));left:8px;z-index:195;display:inline-flex;align-items:center;min-height:44px;padding:0 12px;background:none;border:none;cursor:pointer;font-family:'Cinzel',serif;font-size:.5rem;letter-spacing:.18em;text-transform:uppercase;color:rgba(240,234,216,.7);white-space:nowrap}
      .br-escape:hover{color:rgba(240,234,216,.95)}
    `}</style>
  );

  const TopBar = (
    <div className="br-top">
      <a href="/" className="br-logo">Calvary Scribblings</a>
      <span className="br-title">{title.title}</span>
      <a href={`/bookstore/${slug}`} className="br-close">← Store</a>
    </div>
  );

  // Interstitial — no sample requested, or requested with nothing on file.
  if (!isSample) {
    return (
      <div style={{ width: '100vw', height: '100vh', background: '#1a0f0a', overflow: 'hidden', fontFamily: "Cormorant Garamond, Georgia, serif" }}>
        {styles}
        {TopBar}
        <div className="br-center" style={{ animation: 'fadeUp .6s ease forwards' }}>
          <div style={{ fontSize: '.9rem', letterSpacing: '.4em', color: 'rgba(201,164,76,.35)', marginBottom: '1.5rem' }}>&#10086;</div>
          <div style={{ fontFamily: "'Cinzel',serif", fontSize: '.58rem', letterSpacing: '.28em', textTransform: 'uppercase', color: '#c9a44c', marginBottom: '1.4rem' }}>In the Book Store</div>
          <h1 style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: 'clamp(1.5rem,4vw,2.2rem)', fontWeight: 300, fontStyle: 'italic', color: '#f5efe0', lineHeight: 1.2, marginBottom: '.6rem', maxWidth: '520px' }}>{title.title}</h1>
          <p style={{ fontSize: '1rem', color: 'rgba(240,234,216,.5)', fontStyle: 'italic', maxWidth: '440px', lineHeight: 1.7, marginBottom: '2.2rem' }}>This book is available in the Book Store.</p>
          <a href={`/bookstore/${slug}`} style={{ fontFamily: "'Cinzel',serif", fontSize: '.62rem', letterSpacing: '.18em', textTransform: 'uppercase', color: '#c9a44c', textDecoration: 'none', border: '1px solid rgba(201,164,76,.4)', borderRadius: '3px', padding: '.85rem 2rem', background: 'rgba(201,164,76,.04)' }}>View in the Book Store →</a>
        </div>
      </div>
    );
  }

  // Sample mode.
  return (
    <div style={{ width: '100vw', height: '100vh', background: '#1a0f0a', overflow: 'hidden', fontFamily: "Cormorant Garamond, Georgia, serif" }}>
      {styles}
      {TopBar}
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
        <iframe
          className="br-frame"
          src={sampleRoomSrc(epubUrl)}
          title={`${title.title} (sample)`}
          sandbox="allow-scripts allow-same-origin"
        />
      ) : (
        <div className="br-center"><div className="br-spin" /></div>
      )}
    </div>
  );
}
