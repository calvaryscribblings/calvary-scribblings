'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import { stories } from '../../lib/stories';
import { use } from 'react';

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

const FONT_SIZES = [14, 16, 18, 20];

export default function StoryReaderClient({ params }) {
  const { slug } = use(params);
  const [story, setStory] = useState(stories.find(s => s.id === slug) || null);
  const [storyReady, setStoryReady] = useState(!!stories.find(s => s.id === slug));
  const [showCover, setShowCover] = useState(true);
  const [showEnd, setShowEnd] = useState(false);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [dir, setDir] = useState('next');
  const [fontSize, setFontSize] = useState(1); // index into FONT_SIZES
  const [epubLoading, setEpubLoading] = useState(true);
  const [epubError, setEpubError] = useState('');
  const [hitCount, setHitCount] = useState(null);
  const bookRef = useRef(null);
  const touchRef = useRef(null);
  const renditionRef = useRef(null);
  const bookObjRef = useRef(null);
  const stateRef = useRef({});

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

  // Load EPUB via epub.js
  useEffect(() => {
    if (!story?.epubUrl) return;
    setEpubLoading(true);
    setEpubError('');

    function initEpub(ePub) {
      if (!bookRef.current) return;
      const bW = Math.min(760, window.innerWidth * 0.92);
      const bH = Math.min(window.innerHeight * 0.82, window.innerWidth > 768 ? 720 : 580);

      // Destroy previous instance
      if (renditionRef.current) { try { renditionRef.current.destroy(); } catch(e) {} }
      if (bookObjRef.current) { try { bookObjRef.current.destroy(); } catch(e) {} }

      const book = ePub(story.epubUrl);
      bookObjRef.current = book;

      const rendition = book.renderTo(bookRef.current.querySelector('.epub-container'), {
        width: bW - 96,
        height: bH - 80,
        spread: 'none',
        flow: 'paginated',
      });
      renditionRef.current = rendition;

      rendition.themes.default({
        body: {
          'font-family': "'Cormorant Garamond', Cochin, Georgia, serif !important",
          'font-size': `${FONT_SIZES[fontSize]}px !important`,
          'line-height': '1.9 !important',
          'color': '#2a1a0e !important',
          'background': '#f6f0e2 !important',
          'padding': '44px 48px 36px !important',
          'max-width': '100% !important',
        },
        p: {
          'margin-bottom': '0 !important',
          'font-family': "'Cormorant Garamond', Cochin, Georgia, serif !important",
        },
        'p + p': { 'text-indent': '1.5em !important' },
        h1: { 'font-size': '1.4rem !important', 'color': '#1a0a00 !important', 'margin': '1.5em 0 0.5em !important' },
        h2: { 'font-size': '1.2rem !important', 'color': '#1a0a00 !important', 'margin': '1.4em 0 0.4em !important' },
        h3: { 'font-size': '1.1rem !important', 'font-style': 'italic !important', 'color': '#6b2fad !important', 'margin': '1.3em 0 0.35em !important', 'font-weight': '400 !important' },
        img: { 'max-width': '100% !important', 'height': 'auto !important', 'display': 'block !important', 'margin': '1.2em auto !important' },
        blockquote: { 'border-left': '2px solid #c9a44c !important', 'padding': '0.4em 1em !important', 'margin': '1.4em 0 !important', 'font-style': 'italic !important', 'color': '#5a3820 !important' },
      });

      rendition.display().then(() => {
        setEpubLoading(false);
        book.locations.generate(1000).then(() => {
          setTotal(book.locations.total || 1);
        });
      }).catch(err => {
        console.error('EPUB display error:', err);
        setEpubError('Could not load this book. Please try again.');
        setEpubLoading(false);
      });

      rendition.on('relocated', (location) => {
        if (book.locations.total) {
          const loc = book.locations.locationFromCfi(location.start.cfi);
          setPage(loc || 0);
        }
      });

      book.on('openFailed', () => {
        setEpubError('Could not open this EPUB. Please check the file.');
        setEpubLoading(false);
      });
    }

    if (window.ePub) {
      initEpub(window.ePub);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/epub.js/0.3.93/epub.min.js';
    script.onload = () => {
      if (window.ePub) {
        initEpub(window.ePub);
      } else {
        setEpubError('EPUB engine failed to initialise.');
        setEpubLoading(false);
      }
    };
    script.onerror = () => {
      setEpubError('Could not load EPUB engine. Check your connection.');
      setEpubLoading(false);
    };
    document.head.appendChild(script);

    return () => {
      if (renditionRef.current) { try { renditionRef.current.destroy(); } catch(e) {} }
      if (bookObjRef.current) { try { bookObjRef.current.destroy(); } catch(e) {} }
    };
  }, [story?.epubUrl]);

  // Update font size in rendition
  useEffect(() => {
    if (!renditionRef.current) return;
    renditionRef.current.themes.fontSize(`${FONT_SIZES[fontSize]}px`);
  }, [fontSize]);

  // Hit counter + read tracking
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
  stateRef.current = { animating, showCover, showEnd, page, total };

  const goNext = useCallback(() => {
    const { animating, showCover, showEnd } = stateRef.current;
    if (animating) return;
    if (showCover) { setShowCover(false); return; }
    if (showEnd) return;
    if (renditionRef.current) {
      setDir('next'); setAnimating(true);
      renditionRef.current.next().then(() => {
        setTimeout(() => setAnimating(false), 650);
      }).catch(() => {
        setShowEnd(true);
        setAnimating(false);
      });
    }
  }, []);

  const goPrev = useCallback(() => {
    const { animating, showCover, showEnd, page } = stateRef.current;
    if (animating) return;
    if (showEnd) { setShowEnd(false); return; }
    if (showCover) return;
    if (page === 0) { setShowCover(true); return; }
    if (renditionRef.current) {
      setDir('prev'); setAnimating(true);
      renditionRef.current.prev().then(() => {
        setTimeout(() => setAnimating(false), 650);
      }).catch(() => setAnimating(false));
    }
  }, []);

  useEffect(() => {
    const fn = e => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') goNext();
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') goPrev();
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [goNext, goPrev]);

  const onTS = useCallback(e => { touchRef.current = e.touches[0].clientX; }, []);
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

        .epub-container{width:100%;height:100%;position:relative;z-index:7}
        .epub-container iframe{border:none!important;background:#f6f0e2!important}
        .bpnum{position:absolute;bottom:10px;left:0;right:0;text-align:center;font-family:'Cinzel',serif;font-size:.55rem;letter-spacing:.18em;color:rgba(107,47,173,.3);z-index:8;pointer-events:none}

        .bcover{position:absolute;inset:0;background:linear-gradient(148deg,#1a0a2e 0%,#0e0618 100%);border-radius:2px 8px 8px 2px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:36px;text-align:center;box-shadow:6px 10px 48px rgba(0,0,0,.85),0 0 0 1px rgba(201,164,76,.18);overflow:hidden;cursor:pointer;animation:fadeUp .7s ease forwards;z-index:15}
        .bcover::before{content:'';position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse 80% 65% at 50% 38%,rgba(107,47,173,.28) 0%,transparent 68%)}
        .bcimg{width:min(280px,62vw);height:min(460px,55vh);object-fit:cover;border-radius:2px 4px 4px 2px;position:relative;z-index:1;box-shadow:0 12px 48px rgba(0,0,0,.75),0 0 0 1px rgba(201,164,76,.2),inset -3px 0 8px rgba(0,0,0,.35);margin-bottom:14px}
        .bcorn{font-size:.55rem;letter-spacing:.4em;color:rgba(201,164,76,.3);margin-bottom:10px;position:relative;z-index:1}
        .bctitle{font-family:'Cormorant Garamond',serif;font-size:clamp(1rem,2.5vw,1.5rem);font-weight:300;color:#f5efe0;line-height:1.2;margin-bottom:6px;position:relative;z-index:1;font-style:italic}
        .bcauthor{font-family:'Cinzel',serif;font-size:.56rem;letter-spacing:.24em;color:rgba(201,164,76,.65);text-transform:uppercase;position:relative;z-index:1}
        .bccta{position:absolute;bottom:22px;font-family:'Cinzel',serif;font-size:.5rem;letter-spacing:.2em;color:rgba(201,164,76,.4);text-transform:uppercase;animation:blink 2.2s ease-in-out infinite}
        .bcpages{position:absolute;bottom:22px;right:22px;font-family:'Cinzel',serif;font-size:.48rem;letter-spacing:.14em;color:rgba(255,255,255,.18)}

        .bend{position:absolute;inset:0;background:#f6f0e2;border-radius:2px 8px 8px 2px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px;text-align:center;box-shadow:6px 10px 48px rgba(0,0,0,.75);animation:fadeUp .5s ease forwards;z-index:15}
        .beorn{font-size:.9rem;color:#c9a44c;letter-spacing:.5em;margin-bottom:18px}
        .berule{width:60px;height:1px;background:rgba(201,164,76,.3);margin:0 auto 18px}
        .betitle{font-family:'Cormorant Garamond',serif;font-size:1.35rem;font-style:italic;color:#2a1a0e;margin-bottom:6px}
        .beauth{font-family:'Cinzel',serif;font-size:.58rem;letter-spacing:.2em;color:rgba(107,47,173,.55);text-transform:uppercase;margin-bottom:24px}
        .bemeta{font-family:'Cormorant Garamond',serif;font-size:.85rem;font-style:italic;color:#aaa;margin-bottom:24px}
        .bebtn{font-family:'Cinzel',serif;font-size:.58rem;letter-spacing:.16em;text-transform:uppercase;padding:10px 26px;background:none;border:1px solid rgba(107,47,173,.35);color:#6b2fad;border-radius:2px;cursor:pointer;text-decoration:none;display:inline-block;transition:all .2s}
        .bebtn:hover{background:rgba(107,47,173,.07);border-color:#6b2fad}

        .bload{position:absolute;inset:0;background:#f6f0e2;border-radius:2px 8px 8px 2px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;box-shadow:6px 10px 48px rgba(0,0,0,.75);z-index:12}
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
              onClick={() => setFontSize(f => (f + 1) % FONT_SIZES.length)}
              style={{
                background: 'none', border: '1px solid rgba(201,164,76,0.35)',
                borderRadius: '4px', color: 'rgba(201,164,76,0.7)',
                fontFamily: "'Cinzel', serif", fontSize: '0.52rem',
                letterSpacing: '0.14em', textTransform: 'uppercase',
                padding: '5px 10px', cursor: 'pointer', transition: 'all 0.2s',
              }}
              title="Cycle font size"
            >
              Aa {FONT_SIZES[fontSize]}px
            </button>
            <a href={`/stories/${slug}`} className="rclose">← Standard View</a>
          </div>
        </div>

        {/* Book stage */}
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

            {/* EPUB page */}
            {!showCover && !showEnd && (
              <div className={`bp${animating ? ` t${dir}` : ''}`} style={{ zIndex: animating ? 10 : 2 }}>
                {epubLoading && (
                  <div className="bload" style={{ position: 'absolute', inset: 0, zIndex: 12 }}>
                    <div className="bloadsp" />
                    <div className="bloadtxt">Opening book…</div>
                  </div>
                )}
                {epubError && (
                  <div className="bload" style={{ position: 'absolute', inset: 0, zIndex: 12 }}>
                    <div style={{ fontFamily: "'Cormorant Garamond',serif", color: '#c0392b', fontStyle: 'italic', fontSize: '1rem', textAlign: 'center', padding: '0 32px' }}>{epubError}</div>
                  </div>
                )}
                <div className="epub-container" style={{ width: bW - 96, height: bH - 80, margin: '40px 48px 36px' }} />
                {!epubLoading && total > 0 && (
                  <div className="bpnum">{page + 1} of {total}</div>
                )}
                <div className="pcorner" onClick={goNext} />
              </div>
            )}

            {/* End page */}
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