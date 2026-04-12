'use client';
import { useEffect, useState, useRef } from 'react';
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

const FONT_SIZES = [14, 16, 18, 20, 22];

export default function StoryReaderClient({ params }) {
  const { slug } = use(params);
  const [story, setStory] = useState(stories.find(s => s.id === slug) || null);
  const [showCover, setShowCover] = useState(true);
  const [showEnd, setShowEnd] = useState(false);
  const [hitCount, setHitCount] = useState(null);
  const [fontIndex, setFontIndex] = useState(1);
  const [flipMode, setFlipMode] = useState(false);
  const iframeRef = useRef(null);
  const iframeReady = useRef(false);
  const pendingFont = useRef(1);
  const pendingFlip = useRef(false);
  const [pageInfo, setPageInfo] = useState('');
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (story) return;
    (async () => {
      try {
        const db = await getDB();
        const { ref, get } = await import('firebase/database');
        const snap = await get(ref(db, 'cms_stories/' + slug));
        if (snap.exists()) setStory({ id: slug, ...snap.val() });
      } catch (e) {}
    })();
  }, [slug]);

  useEffect(() => {
    if (!slug) return;
    fetch('/api/hit?slug=' + slug, { method: 'POST' })
      .then(r => r.json()).then(d => { if (typeof d.count === 'number') setHitCount(d.count); }).catch(() => {});
    (async () => {
      try {
        const auth = await getFirebaseAuth();
        const { onAuthStateChanged } = await import('firebase/auth');
        const u = onAuthStateChanged(auth, async (user) => {
          if (!user) return; u();
          const db = await getDB();
          const { ref, get, set, runTransaction } = await import('firebase/database');
          const rr = ref(db, 'users/' + user.uid + '/readStories/' + slug);
          const s = await get(rr);
          if (!s.exists()) {
            await set(rr, true);
            await runTransaction(ref(db, 'users/' + user.uid + '/readCount'), c => (c || 0) + 1);
          }
        });
      } catch (e) {}
    })();
  }, [slug]);

  useEffect(() => {
    const handler = e => {
      if (e.data.type === 'ended') setShowEnd(true);
      if (e.data.type === 'pageInfo') setPageInfo(e.data.text);
      if (e.data.type === 'relocate') setProgress(e.data.fraction * 100);
      if (e.data.type === 'ready') {
        iframeReady.current = true;
        iframeRef.current?.contentWindow?.postMessage({ type: 'setFontSize', index: pendingFont.current }, '*');
        if (pendingFlip.current) iframeRef.current?.contentWindow?.postMessage({ type: 'setFlow', value: 'paginated' }, '*');
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const onIframeLoad = () => {
    // HTML loaded but Foliate not ready yet - wait for 'ready' message
  };

  const cycleFont = () => {
    const next = (fontIndex + 1) % FONT_SIZES.length;
    setFontIndex(next);
    pendingFont.current = next;
    iframeRef.current?.contentWindow?.postMessage({ type: 'setFontSize', index: next }, '*');
  };

  const toggleFlip = () => {
    const next = !flipMode;
    setFlipMode(next);
    pendingFlip.current = next;
    iframeRef.current?.contentWindow?.postMessage({ type: 'setFlow', value: next ? 'paginated' : 'scrolled-doc' }, '*');
  };

  if (!story) return (
    <div style={{ minHeight: '100vh', background: '#1a0f0a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
      <div style={{ width: 36, height: 36, border: '2px solid rgba(201,164,76,0.2)', borderTopColor: '#c9a44c', borderRadius: '50%', animation: 'spin 0.9s linear infinite' }} />
    </div>
  );

  const iframeSrc = story.epubUrl
    ? '/vendor/foliate-js-main/calvary-reader.html?url=' + encodeURIComponent(story.epubUrl) + '&title=' + encodeURIComponent(story.title)
    : null;

  return (
    <>
      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        html,body{height:100%;overflow:hidden;background:#1a0f0a}
        @keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
        @keyframes blink{0%,100%{opacity:0.35}50%{opacity:0.9}}
        @keyframes spin{to{transform:rotate(360deg)}}
        .rtop{position:fixed;top:0;left:0;right:0;z-index:200;display:flex;align-items:center;justify-content:space-between;padding:10px 20px;background:linear-gradient(to bottom,rgba(26,15,10,.96) 60%,transparent);gap:8px}
        .rlogo{font-family:'Cinzel',serif;font-size:.52rem;letter-spacing:.2em;color:rgba(201,164,76,.45);text-decoration:none;text-transform:uppercase;transition:color .2s;white-space:nowrap}
        .rlogo:hover{color:rgba(201,164,76,.85)}
        .rtitle{font-family:'Cormorant Garamond',serif;font-size:.72rem;font-style:italic;color:rgba(240,234,216,.28);letter-spacing:.04em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;text-align:center}
        .rtop-right{display:flex;align-items:center;gap:8px;flex-shrink:0}
        .rbtn{font-family:'Cinzel',serif;font-size:.5rem;letter-spacing:.12em;color:rgba(201,164,76,.5);text-transform:uppercase;background:none;border:1px solid rgba(201,164,76,.25);border-radius:3px;padding:4px 9px;cursor:pointer;transition:all .2s;white-space:nowrap}
        .rbtn:hover{color:rgba(201,164,76,.9);border-color:rgba(201,164,76,.6)}
        .rbtn.active{color:rgba(107,47,173,.9);border-color:rgba(107,47,173,.5)}
        .rclose{font-family:'Cinzel',serif;font-size:.5rem;letter-spacing:.12em;color:rgba(201,164,76,.4);text-decoration:none;text-transform:uppercase;transition:color .2s;white-space:nowrap}
        .rclose:hover{color:rgba(201,164,76,.85)}
        .bcover{position:fixed;inset:0;background:linear-gradient(148deg,#1a0a2e 0%,#0e0618 100%);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:36px;text-align:center;z-index:150;cursor:pointer;animation:fadeUp .7s ease forwards}
        .bcover::before{content:'';position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse 80% 65% at 50% 38%,rgba(107,47,173,.28) 0%,transparent 68%)}
        .bcimg{width:min(280px,62vw);height:min(460px,55vh);object-fit:cover;border-radius:2px 4px 4px 2px;position:relative;z-index:1;box-shadow:0 12px 48px rgba(0,0,0,.75),0 0 0 1px rgba(201,164,76,.2);margin-bottom:14px}
        .bcorn{font-size:.55rem;letter-spacing:.4em;color:rgba(201,164,76,.3);margin-bottom:10px;position:relative;z-index:1}
        .bctitle{font-family:'Cormorant Garamond',serif;font-size:clamp(1rem,2.5vw,1.5rem);font-weight:300;color:#f5efe0;line-height:1.2;margin-bottom:6px;position:relative;z-index:1;font-style:italic}
        .bcauthor{font-family:'Cinzel',serif;font-size:.56rem;letter-spacing:.24em;color:rgba(201,164,76,.65);text-transform:uppercase;position:relative;z-index:1}
        .bccta{position:absolute;bottom:22px;font-family:'Cinzel',serif;font-size:.5rem;letter-spacing:.2em;color:rgba(201,164,76,.4);text-transform:uppercase;animation:blink 2.2s ease-in-out infinite}
        .bend{position:fixed;inset:0;top:48px;background:#f6f0e2;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px;text-align:center;animation:fadeUp .5s ease forwards;z-index:10}
        .beorn{font-size:.9rem;color:#c9a44c;letter-spacing:.5em;margin-bottom:18px}
        .berule{width:60px;height:1px;background:rgba(201,164,76,.3);margin:0 auto 18px}
        .betitle{font-family:'Cormorant Garamond',serif;font-size:1.35rem;font-style:italic;color:#2a1a0e;margin-bottom:6px}
        .beauth{font-family:'Cinzel',serif;font-size:.58rem;letter-spacing:.2em;color:rgba(107,47,173,.55);text-transform:uppercase;margin-bottom:24px}
        .bemeta{font-family:'Cormorant Garamond',serif;font-size:.85rem;font-style:italic;color:#aaa;margin-bottom:24px}
        .bebtn{font-family:'Cinzel',serif;font-size:.58rem;letter-spacing:.16em;text-transform:uppercase;padding:10px 26px;background:none;border:1px solid rgba(107,47,173,.35);color:#6b2fad;border-radius:2px;cursor:pointer;text-decoration:none;display:inline-block;transition:all .2s;margin:4px}
        .bebtn:hover{background:rgba(107,47,173,.07);border-color:#6b2fad}
        .reader-frame{position:fixed;inset:0;top:48px;border:none;width:100%;height:calc(100vh - 48px)}
        .no-epub{position:fixed;inset:0;top:48px;background:#f6f0e2;display:flex;align-items:center;justify-content:center;font-family:'Cormorant Garamond',serif;font-style:italic;color:#888;font-size:1rem}
        @media(max-width:600px){.rtitle{display:none}.rbtn{font-size:.44rem;padding:3px 7px}}
      `}</style>

      <div style={{ width: '100vw', height: '100vh', background: '#1a0f0a', overflow: 'hidden' }}>

        <div className="rtop">
          <a href="/" className="rlogo">Calvary Scribblings</a>
          <span className="rtitle">{story.title}</span>
          <div className="rtop-right">
            <button className="rbtn" onClick={cycleFont} title="Change font size">
              Aa {FONT_SIZES[fontIndex]}px
            </button>
            <button className={`rbtn${flipMode ? ' active' : ''}`} onClick={toggleFlip} title="Toggle page flip">
              {flipMode ? 'Flip' : 'Slide'}
            </button>
            <a href={'/stories/' + slug} className="rclose">← View</a>
          </div>
        </div>

        {showCover && (
          <div className="bcover" onClick={() => setShowCover(false)}>
            <div className="bcorn">✦ ✦ ✦</div>
            <img src={story.cover} alt={story.title} className="bcimg" />
            <div className="bctitle">{story.title}</div>
            <div className="bcauthor">by {story.author}</div>
            <div className="bccta">Open to begin reading</div>
          </div>
        )}

        {!showCover && showEnd && (
          <div className="bend">
            <div className="beorn">✦</div>
            <div className="berule" />
            <div className="betitle">{story.title}</div>
            <div className="beauth">by {story.author}</div>
            {hitCount !== null && <div className="bemeta">{hitCount.toLocaleString()} reads</div>}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
              <button className="bebtn" onClick={() => setShowEnd(false)}>← Back to book</button>
              <a href={'/' + (story.category || '')} className="bebtn">More stories</a>
            </div>
          </div>
        )}

        {!showCover && !showEnd && (iframeSrc
          ? <>
              <iframe ref={iframeRef} className="reader-frame" src={iframeSrc} title={story.title} sandbox="allow-scripts allow-same-origin" onLoad={onIframeLoad} />
              <div style={{position:'fixed',bottom:0,left:0,right:0,height:'2px',background:'rgba(201,164,76,0.07)',zIndex:200}}>
                <div style={{height:'100%',background:'linear-gradient(90deg,#6b2fad,#c9a44c)',width:progress+'%',transition:'width 0.45s ease'}} />
              </div>
              {pageInfo && <div style={{position:'fixed',bottom:'10px',left:'50%',transform:'translateX(-50%)',zIndex:200,fontFamily:"'Cinzel',serif",fontSize:'0.48rem',letterSpacing:'0.2em',color:'rgba(201,164,76,0.35)',textTransform:'uppercase',whiteSpace:'nowrap',pointerEvents:'none'}}>{pageInfo}</div>}
            </>
          : <div className="no-epub">No EPUB file available for this book.</div>
        )}

      </div>
    </>
  );
}