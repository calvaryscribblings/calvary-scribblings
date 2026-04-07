'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { stories } from '../../lib/stories';
import { use } from 'react';
import { storyContent } from '../../lib/storyContent';

const FB = {
  apiKey: 'AIzaSyATmmrzAg9b-Nd2I6rGxlE2pylsHeqN2qY',
  authDomain: 'calvary-scribblings.firebaseapp.com',
  databaseURL: 'https://calvary-scribblings-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'calvary-scribblings',
  storageBucket: 'calvary-scribblings.firebasestorage.app',
  messagingSenderId: '1052137412283',
  appId: '1:1052137412283:web:509400c5a2bcc1ca63fb9e',
};

async function getApp() {
  const { initializeApp, getApps } = await import('firebase/app');
  return getApps().length ? getApps()[0] : initializeApp(FB);
}
async function getDB() {
  const { getDatabase } = await import('firebase/database');
  return getDatabase(await getApp());
}
async function getFirebaseAuth() {
  const { getAuth } = await import('firebase/auth');
  return getAuth(await getApp());
}

// ── PDF canvas component ──────────────────────────────────────────────────────
function PDFPageCanvas({ pdfDoc, pageNum, width, height, zoomLevel = 1 }) {
  const canvasRef = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;
    setReady(false);
    let cancelled = false;
    (async () => {
      try {
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1 });
        const dpr = Math.min(window.devicePixelRatio * 1.5 || 3, 4);
        // Cap reading width at 520px equivalent to prevent text stretching on wide screens
        const cappedWidth = Math.min(width, 520);
        const fitWidth = (cappedWidth / viewport.width) * 0.95;
        const fitHeight = (height / viewport.height) * 0.95;
        const baseFit = zoomLevel > 1.25 ? fitWidth : Math.min(fitWidth, fitHeight);
        const scale = baseFit * zoomLevel;
        const sv = page.getViewport({ scale: scale * dpr });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        canvas.width = sv.width;
        canvas.height = sv.height;
        canvas.style.width = (sv.width / dpr) + 'px';
        canvas.style.height = (sv.height / dpr) + 'px';
        const ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport: sv }).promise;
        if (!cancelled) setReady(true);
      } catch (e) { console.error('PDF render error:', e); }
    })();
    return () => { cancelled = true; };
  }, [pdfDoc, pageNum, width, height, zoomLevel]);

  return (
    <canvas ref={canvasRef} style={{
      maxWidth: '100%', maxHeight: '100%', display: 'block', margin: '0 auto',
      mixBlendMode: 'multiply', background: 'transparent',
      opacity: ready ? 1 : 0, transition: 'opacity 0.25s ease',
    }} />
  );
}

// ── HTML → pages splitter ─────────────────────────────────────────────────────
function splitHTML(html, pageH, pageW) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
    const nodes = Array.from(doc.querySelector('div').childNodes);
    const pages = [];
    let cur = [], curH = 0;
    const usable = pageH - 80;

    const m = document.createElement('div');
    m.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;width:${pageW}px;font-family:Cochin,Georgia,serif;font-size:1.12rem;line-height:1.9;`;
    document.body.appendChild(m);

    for (const node of nodes) {
      const clone = node.cloneNode(true);
      m.appendChild(clone);
      const h = clone.getBoundingClientRect().height + 24;
      m.removeChild(clone);
      if (curH + h > usable && cur.length) {
        pages.push(cur.map(n => n.outerHTML || n.textContent).join(''));
        cur = []; curH = 0;
      }
      cur.push(node); curH += h;
    }
    if (cur.length) pages.push(cur.map(n => n.outerHTML || n.textContent).join(''));
    document.body.removeChild(m);
    return pages.length ? pages : [html];
  } catch (e) { return [html]; }
}

export default function StoryReaderClient({ params }) {
  const { slug } = use(params);
  const [story, setStory] = useState(stories.find(s => s.id === slug) || null);
  const [storyReady, setStoryReady] = useState(!!stories.find(s => s.id === slug));

  const [pdfDoc, setPdfDoc] = useState(null);
  const [pdfTotal, setPdfTotal] = useState(0);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const [htmlPages, setHtmlPages] = useState([]);

  const [page, setPage] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [dir, setDir] = useState('next');
  const [showCover, setShowCover] = useState(true);
  const [showEnd, setShowEnd] = useState(false);
  const [hitCount, setHitCount] = useState(null);
  const touchRef = useRef(null);
  const bookRef = useRef(null);
  const htmlBuilt = useRef(false);
  const [zoom, setZoom] = useState(1);
  const ZOOM_LEVELS = [1, 1.25, 1.5];

  const isPDF = story?.pdfUrl;
  const total = isPDF ? pdfTotal : htmlPages.length;
  const progress = total > 0 ? ((page + 1) / total) * 100 : 0;

  // Fetch CMS story
  useEffect(() => {
    if (story) { setStoryReady(true); return; }
    (async () => {
      try {
        const db = await getDB();
        const { ref, get } = await import('firebase/database');
        const snap = await get(ref(db, 'cms_stories/' + slug));
        if (snap.exists()) { setStory({ id: slug, ...snap.val() }); setStoryReady(true); }
      } catch (e) {}
    })();
  }, [slug]);

  // Load PDF
  useEffect(() => {
    if (!story?.pdfUrl) return;
    setPdfLoading(true);
    setPdfError('');

    function loadPDFWithLib(pdfjsLib) {
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      pdfjsLib.getDocument({
        url: story.pdfUrl,
        cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
        cMapPacked: true,
      }).promise
        .then(pdf => {
          setPdfDoc(pdf);
          setPdfTotal(pdf.numPages);
          setPdfLoading(false);
        })
        .catch(err => {
          console.error('PDF load error:', err);
          setPdfError('Could not load this book. Please try again.');
          setPdfLoading(false);
        });
    }

    if (window.pdfjsLib) {
      loadPDFWithLib(window.pdfjsLib);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = () => {
      if (window.pdfjsLib) {
        loadPDFWithLib(window.pdfjsLib);
      } else {
        setPdfError('PDF engine failed to initialise.');
        setPdfLoading(false);
      }
    };
    script.onerror = () => {
      setPdfError('Could not load PDF engine. Check your connection.');
      setPdfLoading(false);
    };
    document.head.appendChild(script);
  }, [story?.pdfUrl]);

  // Build HTML pages
  useEffect(() => {
    if (!story || !storyReady || isPDF || htmlBuilt.current) return;
    const t = setTimeout(() => {
      if (!bookRef.current) return;
      const r = bookRef.current.getBoundingClientRect();
      const h = r.height || window.innerHeight * 0.75;
      const w = (r.width || Math.min(680, window.innerWidth * 0.92)) - 96;
      const html = storyContent[slug] || story.content || '<p>Content coming soon.</p>';
      setHtmlPages(splitHTML(html, h, w));
      htmlBuilt.current = true;
    }, 700);
    return () => clearTimeout(t);
  }, [story, storyReady, isPDF, slug]);

  // Hit counter
  useEffect(() => {
    if (!slug) return;
    fetch(`/api/hit?slug=${slug}`, { method: 'POST' })
      .then(r => r.json()).then(d => { if (typeof d.count === 'number') setHitCount(d.count); }).catch(() => {});
    (async () => {
      try {
        const auth = await getFirebaseAuth();
        const { onAuthStateChanged } = await import('firebase/auth');
        const u = onAuthStateChanged(auth, async (user) => {
          if (!user) return; u();
          const db = await getDB();
          const { ref, get, set, runTransaction } = await import('firebase/database');
          const rr = ref(db, `users/${user.uid}/readStories/${slug}`);
          const s = await get(rr);
          if (!s.exists()) {
            await set(rr, true);
            await runTransaction(ref(db, `users/${user.uid}/readCount`), c => (c || 0) + 1);
          }
        });
      } catch (e) {}
    })();
  }, [slug]);

  // Navigation
  const stateRef = useRef({});
  stateRef.current = { animating, showCover, showEnd, page, total, zoom };

  const goNext = useCallback(() => {
    const { animating, showCover, page, total } = stateRef.current;
    if (animating) return;
    if (showCover) { setShowCover(false); return; }
    if (page >= total - 1) { setShowEnd(true); return; }
    setDir('next'); setAnimating(true);
    setTimeout(() => { setPage(p => p + 1); setAnimating(false); }, 650);
  }, []);

  const goPrev = useCallback(() => {
    const { animating, showEnd, page } = stateRef.current;
    if (animating) return;
    if (showEnd) { setShowEnd(false); return; }
    if (page === 0) { setShowCover(true); return; }
    setDir('prev'); setAnimating(true);
    setTimeout(() => { setPage(p => p - 1); setAnimating(false); }, 650);
  }, []);

  useEffect(() => {
    const fn = e => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') goNext();
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') goPrev();
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [goNext, goPrev]);

  const onTS = useCallback(e => {
    touchRef.current = e.touches[0].clientX;
  }, []);

  const onTE = useCallback(e => {
    if (touchRef.current === null) return;
    const d = touchRef.current - e.changedTouches[0].clientX;
    touchRef.current = null;
    if (Math.abs(d) > 50) { d > 0 ? goNext() : goPrev(); }
  }, [goNext, goPrev]);

  if (!story) return (
    <div style={{ minHeight: '100vh', background: '#1a0f0a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ width: 36, height: 36, border: '2px solid rgba(201,164,76,0.2)', borderTopColor: '#c9a44c', borderRadius: '50%', animation: 'spin 0.9s linear infinite' }} />
    </div>
  );

  const bW = typeof window !== 'undefined' ? Math.min(760, window.innerWidth * 0.92) : 760;
  const bH = typeof window !== 'undefined' ? Math.min(window.innerHeight * 0.82, window.innerWidth > 768 ? 720 : 580) : 680;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400;1,600&family=Cinzel:wght@400;600&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        html,body{height:100%;overflow:hidden;background:#1a0f0a}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes blink{0%,100%{opacity:0.35}50%{opacity:0.9}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
        @keyframes tnext{
          0%{transform:rotateY(0);box-shadow:6px 10px 50px rgba(0,0,0,0.8)}
          38%{transform:rotateY(-90deg);box-shadow:0 10px 80px rgba(0,0,0,0.95)}
          100%{transform:rotateY(-180deg);box-shadow:-2px 8px 24px rgba(0,0,0,0.3)}
        }
        @keyframes tprev{
          0%{transform:rotateY(0);box-shadow:-6px 10px 50px rgba(0,0,0,0.8)}
          38%{transform:rotateY(90deg);box-shadow:0 10px 80px rgba(0,0,0,0.95)}
          100%{transform:rotateY(180deg);box-shadow:2px 8px 24px rgba(0,0,0,0.3)}
        }

        .rr{width:100vw;height:100vh;background:#1a0f0a;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;position:relative;perspective:2400px}
        .rr::before{content:'';position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse 70% 55% at 50% 50%,rgba(201,164,76,.055) 0%,transparent 65%),radial-gradient(ellipse 35% 35% at 8% 8%,rgba(107,47,173,.09) 0%,transparent 55%),radial-gradient(ellipse 35% 35% at 92% 92%,rgba(107,47,173,.06) 0%,transparent 55%)}

        .rtop{position:fixed;top:0;left:0;right:0;z-index:200;display:flex;align-items:center;justify-content:space-between;padding:14px 28px;background:linear-gradient(to bottom,rgba(26,15,10,.96) 60%,transparent)}
        .rlogo{font-family:'Cinzel',serif;font-size:.56rem;letter-spacing:.22em;color:rgba(201,164,76,.45);text-decoration:none;text-transform:uppercase;transition:color .2s}
        .rlogo:hover{color:rgba(201,164,76,.85)}
        .rtitle{position:absolute;left:50%;transform:translateX(-50%);font-family:'Cormorant Garamond',serif;font-size:.72rem;font-style:italic;color:rgba(240,234,216,.28);letter-spacing:.04em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:40vw}
        .rclose{font-family:'Cinzel',serif;font-size:.54rem;letter-spacing:.14em;color:rgba(201,164,76,.4);text-decoration:none;text-transform:uppercase;transition:color .2s}
        .rclose:hover{color:rgba(201,164,76,.85)}

        .bstage{position:relative;z-index:1;width:min(760px,92vw);transform-style:preserve-3d}
        .bbody{position:relative;width:100%;height:min(82vh,720px);transform-style:preserve-3d}

        .bp{position:absolute;inset:0;background:#f6f0e2 !important;border-radius:2px 8px 8px 2px;overflow:hidden;transform-style:preserve-3d;backface-visibility:hidden;box-shadow:inset -4px 0 10px rgba(0,0,0,.12),inset 2px 0 6px rgba(0,0,0,.06),6px 10px 48px rgba(0,0,0,.75),-2px 4px 16px rgba(0,0,0,.35),0 0 0 1px rgba(201,164,76,.12)}
        .bp::before{content:'';position:absolute;left:0;top:0;bottom:0;width:22px;background:linear-gradient(to right,rgba(0,0,0,.2),transparent);z-index:5;pointer-events:none}
        .bp::after{content:'';position:absolute;inset:0;z-index:6;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 300 300' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.72' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.038'/%3E%3C/svg%3E");pointer-events:none}

        .bp.tnext{transform-origin:left center;animation:tnext .65s cubic-bezier(.645,.045,.355,1) forwards;z-index:10!important}
        .bp.tprev{transform-origin:right center;animation:tprev .65s cubic-bezier(.645,.045,.355,1) forwards;z-index:10!important}

        .pcorner{position:absolute;bottom:0;right:0;z-index:20;width:0;height:0;border-style:solid;border-width:0 0 32px 32px;border-color:transparent transparent rgba(201,164,76,.2) transparent;cursor:pointer;transition:border-width .25s}
        .pcorner:hover{border-width:0 0 44px 44px;border-color:transparent transparent rgba(201,164,76,.35) transparent}

        .bpc{position:absolute;inset:0;z-index:7;padding:44px 48px 36px;display:flex;flex-direction:column;overflow:hidden}
        .bprose{font-family:'Cormorant Garamond',Cochin,Georgia,serif;font-size:1.12rem;line-height:1.9;color:#2a1a0e;font-weight:400;flex:1;overflow:hidden}
        .bprose p{margin-bottom:0}
        .bprose p+p{text-indent:1.5em}
        .bprose.dc>p:first-of-type::first-letter{font-size:4em;font-weight:600;float:left;line-height:.78;margin:.06em .1em 0 0;color:#6b2fad;font-family:'Cormorant Garamond',Georgia,serif}
        .bprose h3{font-size:1.1rem;font-style:italic;color:#6b2fad;margin:1.4em 0 .4em;font-weight:400}
        .bprose img{display:block;max-width:100%;height:auto;border-radius:2px;margin:1.2em auto}
        .bprose figure{margin:1.2em 0}
        .bprose figcaption{font-size:.8rem;color:#999;font-style:italic;text-align:center;margin-top:.4em}
        .bprose blockquote{border-left:2px solid #c9a44c;padding:.4em 1em;margin:1.4em 0;font-style:italic;color:#5a3820;background:rgba(201,164,76,.05)}
        .bprose strong{color:#1a0a00;font-weight:700}

        .pdfwrap{flex:1;overflow:hidden;display:flex;align-items:center;justify-content:center;background:#f6f0e2;border-radius:2px;position:relative;z-index:8}
        .bpnum{flex-shrink:0;text-align:center;padding-top:10px;font-family:'Cinzel',serif;font-size:.55rem;letter-spacing:.18em;color:rgba(107,47,173,.3)}

        .bcover{position:absolute;inset:0;background:linear-gradient(148deg,#1a0a2e 0%,#0e0618 100%);border-radius:2px 8px 8px 2px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:36px;text-align:center;box-shadow:6px 10px 48px rgba(0,0,0,.85),0 0 0 1px rgba(201,164,76,.18);overflow:hidden;cursor:pointer;animation:fadeUp .7s ease forwards}
        .bcover::before{content:'';position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse 80% 65% at 50% 38%,rgba(107,47,173,.28) 0%,transparent 68%)}
        .bcimg{width:min(280px,62vw);height:min(400px,42vh);object-fit:cover;border-radius:2px 4px 4px 2px;position:relative;z-index:1;box-shadow:0 12px 48px rgba(0,0,0,.75),0 0 0 1px rgba(201,164,76,.2),inset -3px 0 8px rgba(0,0,0,.35);margin-bottom:14px}
        .bcorn{font-size:.55rem;letter-spacing:.4em;color:rgba(201,164,76,.3);margin-bottom:10px;position:relative;z-index:1}
        .bctitle{font-family:'Cormorant Garamond',serif;font-size:clamp(1rem,2.5vw,1.5rem);font-weight:300;color:#f5efe0;line-height:1.2;margin-bottom:6px;position:relative;z-index:1;font-style:italic}
        .bcauthor{font-family:'Cinzel',serif;font-size:.56rem;letter-spacing:.24em;color:rgba(201,164,76,.65);text-transform:uppercase;position:relative;z-index:1}
        .bccta{position:absolute;bottom:22px;font-family:'Cinzel',serif;font-size:.5rem;letter-spacing:.2em;color:rgba(201,164,76,.4);text-transform:uppercase;animation:blink 2.2s ease-in-out infinite}
        .bcpages{position:absolute;bottom:22px;right:22px;font-family:'Cinzel',serif;font-size:.48rem;letter-spacing:.14em;color:rgba(255,255,255,.18)}

        .bend{position:absolute;inset:0;background:#f6f0e2;border-radius:2px 8px 8px 2px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px;text-align:center;box-shadow:6px 10px 48px rgba(0,0,0,.75);animation:fadeUp .5s ease forwards}
        .beorn{font-size:.9rem;color:#c9a44c;letter-spacing:.5em;margin-bottom:18px}
        .berule{width:60px;height:1px;background:rgba(201,164,76,.3);margin:0 auto 18px}
        .betitle{font-family:'Cormorant Garamond',serif;font-size:1.35rem;font-style:italic;color:#2a1a0e;margin-bottom:6px}
        .beauth{font-family:'Cinzel',serif;font-size:.58rem;letter-spacing:.2em;color:rgba(107,47,173,.55);text-transform:uppercase;margin-bottom:24px}
        .bemeta{font-family:'Cormorant Garamond',serif;font-size:.85rem;font-style:italic;color:#aaa;margin-bottom:24px}
        .bebtn{font-family:'Cinzel',serif;font-size:.58rem;letter-spacing:.16em;text-transform:uppercase;padding:10px 26px;background:none;border:1px solid rgba(107,47,173,.35);color:#6b2fad;border-radius:2px;cursor:pointer;text-decoration:none;display:inline-block;transition:all .2s}
        .bebtn:hover{background:rgba(107,47,173,.07);border-color:#6b2fad}

        .bload{position:absolute;inset:0;background:#f6f0e2;border-radius:2px 8px 8px 2px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;box-shadow:6px 10px 48px rgba(0,0,0,.75)}
        .bloadsp{width:32px;height:32px;border:2px solid rgba(201,164,76,.2);border-top-color:#c9a44c;border-radius:50%;animation:spin .9s linear infinite}
        .bloadtxt{font-family:'Cormorant Garamond',serif;font-size:.9rem;font-style:italic;color:#888}

        .rnav{position:fixed;top:50%;transform:translateY(-50%);z-index:150;background:none;border:none;cursor:pointer;padding:18px 14px;opacity:.32;transition:opacity .2s}
        .rnav:hover{opacity:.88}
        .rprev{left:max(6px,1.5vw)}
        .rnext{right:max(6px,1.5vw)}

        .rprog{position:fixed;bottom:0;left:0;right:0;height:2px;background:rgba(201,164,76,.07);z-index:200}
        .rprogf{height:100%;background:linear-gradient(90deg,#6b2fad,#c9a44c);transition:width .45s ease}
        .rpinfo{position:fixed;bottom:10px;left:50%;transform:translateX(-50%);z-index:200;font-family:'Cinzel',serif;font-size:.48rem;letter-spacing:.2em;color:rgba(201,164,76,.25);text-transform:uppercase;white-space:nowrap;pointer-events:none}

        @media(max-width:768px){
          .bpc{padding:28px 24px 20px}
          .bprose{font-size:1rem;line-height:1.82}
          .rtitle{display:none}
          .rnav{padding:12px 8px}
        }
      `}</style>

      <div className="rr" onTouchStart={onTS} onTouchEnd={onTE}>

        {/* Top bar */}
        <div className="rtop">
          <a href="/" className="rlogo">Calvary Scribblings</a>
          <span className="rtitle">{story.title}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              onClick={() => setZoom(z => {
                const idx = ZOOM_LEVELS.indexOf(z);
                return ZOOM_LEVELS[(idx + 1) % ZOOM_LEVELS.length];
              })}
              style={{
                background: 'none', border: '1px solid rgba(201,164,76,0.35)',
                borderRadius: '4px', color: 'rgba(201,164,76,0.7)',
                fontFamily: "'Cinzel', serif", fontSize: '0.52rem',
                letterSpacing: '0.14em', textTransform: 'uppercase',
                padding: '5px 10px', cursor: 'pointer', transition: 'all 0.2s',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = '#c9a44c'; e.currentTarget.style.borderColor = 'rgba(201,164,76,0.7)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'rgba(201,164,76,0.7)'; e.currentTarget.style.borderColor = 'rgba(201,164,76,0.35)'; }}
              title="Cycle zoom level"
            >
              {zoom === 1 ? '🔍 Zoom' : zoom === 1.25 ? '🔍 1.25×' : '🔍 1.5×'}
            </button>
            <a href={`/stories/${slug}`} className="rclose">← Standard View</a>
          </div>
        </div>

        {/* Book */}
        <div className="bstage" ref={bookRef}>
          <div className="bbody">

            {/* Cover */}
            {showCover && (
              <div className="bcover" onClick={goNext}>
                <div className="bcorn">✦ ✦ ✦</div>
                <img src={story.cover} alt={story.title} className="bcimg" />
                <div className="bctitle">{story.title}</div>
                <div className="bcauthor">by {story.author}</div>
                {total > 0 && <div className="bcpages">{total} pages</div>}
                <div className="bccta">Open to begin reading</div>
              </div>
            )}

            {/* Loading */}
            {!showCover && !showEnd && (isPDF ? pdfLoading : htmlPages.length === 0) && !pdfError && (
              <div className="bload">
                <div className="bloadsp" />
                <div className="bloadtxt">{isPDF ? 'Loading book…' : 'Setting the type…'}</div>
              </div>
            )}

            {/* PDF error */}
            {!showCover && pdfError && (
              <div className="bload">
                <div style={{ fontFamily: "'Cormorant Garamond',serif", color: '#c0392b', fontStyle: 'italic', fontSize: '1rem', textAlign: 'center', padding: '0 32px' }}>{pdfError}</div>
              </div>
            )}

            {/* PDF pages */}
            {!showCover && !showEnd && isPDF && pdfDoc && !pdfLoading && (
              <>
                {animating && (
                  <div className="bp" style={{ zIndex: 0 }}>
                    <div className="bpc">
                      <div className="pdfwrap">
                        <PDFPageCanvas
                          key={`beneath-${dir === 'next' ? page + 2 : page}-z${zoom}`}
                          pdfDoc={pdfDoc}
                          pageNum={dir === 'next' ? page + 2 : page}
                          width={bW - 96}
                          height={bH - 80}
                        />
                      </div>
                    </div>
                  </div>
                )}
                <div className={`bp${animating ? ` t${dir}` : ''}`} style={{ zIndex: animating ? 10 : 2 }}>
                  <div className="bpc">
                    <div className="pdfwrap">
                      <PDFPageCanvas key={`current-${page + 1}-z${zoom}`} pdfDoc={pdfDoc} pageNum={page + 1} width={bW - 96} height={bH - 80} zoomLevel={zoom} />
                    </div>
                    <div className="bpnum">{page + 1} of {total}</div>
                  </div>
                  <div className="pcorner" onClick={goNext} />
                </div>
                {/* Preload next 3 pages invisibly to prevent flash */}
                {!animating && [1, 2, 3].map(offset => page + offset < total && (
                  <div key={`preload-${page + offset + 1}-z${zoom}`} style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', zIndex: -1, width: bW - 96, height: bH - 80 }}>
                    <PDFPageCanvas pdfDoc={pdfDoc} pageNum={page + offset + 1} width={bW - 96} height={bH - 80} zoomLevel={zoom} />
                  </div>
                ))}
              </>
            )}

            {/* HTML pages */}
            {!showCover && !showEnd && !isPDF && htmlPages.length > 0 && (
              <>
                {animating && (
                  <div className="bp" style={{ zIndex: 0 }}>
                    <div className="bpc">
                      <div className="bprose" dangerouslySetInnerHTML={{ __html: htmlPages[dir === 'next' ? page - 1 : page + 1] || '' }} />
                    </div>
                  </div>
                )}
                <div className={`bp${animating ? ` t${dir}` : ''}`} style={{ zIndex: animating ? 10 : 2 }}>
                  <div className="bpc">
                    <div className={`bprose${page === 0 ? ' dc' : ''}`} dangerouslySetInnerHTML={{ __html: htmlPages[page] }} />
                    <div className="bpnum">{page + 1} of {total}</div>
                  </div>
                  <div className="pcorner" onClick={goNext} />
                </div>
              </>
            )}

            {/* End */}
            {showEnd && (
              <div className="bend">
                <div className="beorn">✦</div>
                <div className="berule" />
                <div className="betitle">{story.title}</div>
                <div className="beauth">by {story.author}</div>
                {hitCount !== null && <div className="bemeta">{hitCount.toLocaleString()} reads</div>}
                <a href={`/${story.category}`} className="bebtn">Back to {story.categoryName || story.category}</a>
              </div>
            )}

          </div>
        </div>

        {/* Nav arrows */}
        {!showCover && (
          <button className="rnav rprev" onClick={goPrev} aria-label="Previous page">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#c9a44c" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
        )}
        {!showEnd && (
          <button className="rnav rnext" onClick={goNext} aria-label="Next page">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#c9a44c" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
          </button>
        )}

        {/* Progress */}
        {!showCover && !showEnd && total > 0 && (
          <>
            <div className="rprog"><div className="rprogf" style={{ width: `${progress}%` }} /></div>
            <div className="rpinfo">{story.title} · Page {page + 1} of {total}</div>
          </>
        )}

      </div>
    </>
  );
}