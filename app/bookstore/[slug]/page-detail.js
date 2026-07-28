'use client';
import { use, useEffect, useState } from 'react';
import { notFound } from 'next/navigation';
import { getTitleBySlug, getPublisher } from '../../lib/bookstore/loader';
import { sectionForGenre } from '../page';
import Navbar from '../../components/Navbar';
import BoundBook, { BOUND_BOOK_CSS } from '../components/BoundBook';
import BuyButton from '../components/BuyButton';
import { truncate } from '../components/fields';

// Presentation labels for genre slugs — kept local (the storefront's map isn't exported).
// Every slug here is a member of GENRES in schema.js.
const GENRE_LABELS = {
  'literary-fiction': 'Literary Fiction',
  'romance': 'Romance',
  'thriller-suspense': 'Thriller & Suspense',
  'sci-fi-fantasy': 'Sci-Fi & Fantasy',
  'historical': 'Historical',
  'short-story-collection': 'Short Story Collections',
  'poetry': 'Poetry',
  'memoir-biography': 'Memoir & Biography',
  'essays': 'Essays',
  'self-development': 'Self-Development',
  'business-finance': 'Business & Finance',
  'politics-society': 'Politics & Society',
};
const genreLabel = (g) => GENRE_LABELS[g] || g;
const sectionLabel = (g) => (sectionForGenre(g) === 'nonfiction' ? 'Non-Fiction' : 'Fiction');

// ISO date (YYYY-MM-DD) → long British form. Falls back to the raw string on parse failure.
function formatDate(iso) {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const month = months[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : iso;
}

function MetaItem({ label, value }) {
  if (!value) return null;
  return (
    <div>
      <div style={{ fontFamily: "'Cinzel',serif", fontSize: '.52rem', letterSpacing: '.24em', textTransform: 'uppercase', color: 'rgba(201,164,76,.55)', marginBottom: '.35rem' }}>{label}</div>
      <div style={{ fontSize: '.92rem', color: 'rgba(240,234,216,.78)' }}>{value}</div>
    </div>
  );
}

export default function BookDetailClient({ params }) {
  const { slug } = use(params);
  const [state, setState] = useState('loading'); // 'loading' | 'ready' | 'missing'
  const [title, setTitle] = useState(null);
  const [publisherName, setPublisherName] = useState(null);

  // Stripe sends the reader back here with ?purchase=success|cancelled. Read once, lazily,
  // at first client render — the same pattern as app/my-library/read/page.js, and for the
  // same reason: useSearchParams() needs a Suspense boundary and can push the route into a
  // client-side bailout under output:'export'. The server prerender has no location, hence
  // the guard. Reading it here rather than in an effect keeps the decision to a single
  // evaluation and avoids a cascading render.
  const [purchased] = useState(() => {
    if (typeof window === 'undefined') return false;
    try { return new URLSearchParams(window.location.search).get('purchase') === 'success'; }
    catch { return false; }
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // getTitleBySlug filters suspended publishers but does NOT gate on status — enforce
      // published here (not found OR not published → notFound()). R3 logic, unchanged.
      const t = await getTitleBySlug(slug);
      if (cancelled) return;
      if (!t || t.status !== 'published') { setState('missing'); return; }
      setTitle(t);
      setState('ready');
      if (t.publisherId) {
        const pub = await getPublisher(t.publisherId);
        if (!cancelled && pub?.name) setPublisherName(pub.name);
      }
    })();
    return () => { cancelled = true; };
  }, [slug]);

  // Strip the marker from the URL once it has been read, so a refresh or a shared link never
  // re-announces a purchase that already happened. Pure side effect on an external system —
  // it sets no state, because `purchased` above has already decided what to show.
  // 'cancelled' is stripped just as silently: the reader changed their mind, which is not an
  // error and does not deserve a notice.
  useEffect(() => {
    let params;
    try { params = new URLSearchParams(window.location.search); } catch { return; }
    const purchase = params.get('purchase');
    if (purchase !== 'success' && purchase !== 'cancelled') return;
    params.delete('purchase');
    params.delete('session_id');
    const qs = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
  }, []);

  if (state === 'missing') notFound();

  const section = title ? sectionLabel(title.genre) : '';
  const cat = title && Number.isInteger(title.catalogueNumber) ? title.catalogueNumber : null;

  return (
    <>
      <Navbar />
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;0,700;1,300;1,400;1,600&family=Cinzel:wght@400;600&family=Inter:wght@300;400;500;600&display=swap');
        body{background:#070707;color:#f0ead8;font-family:'Cormorant Garamond',Georgia,serif;overflow-x:hidden}
        ${BOUND_BOOK_CSS}
        @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse{0%,100%{opacity:.35}50%{opacity:.7}}
        @keyframes grainShift{0%{transform:translate(0,0)}10%{transform:translate(-3%,-2%)}20%{transform:translate(-8%,4%)}30%{transform:translate(3%,-8%)}40%{transform:translate(-2%,9%)}50%{transform:translate(-8%,3%)}60%{transform:translate(4%,-2%)}70%{transform:translate(-4%,6%)}80%{transform:translate(6%,3%)}90%{transform:translate(-2%,-4%)}}
        .bd-skeleton{background:rgba(201,164,76,.08);border-radius:3px;animation:pulse 1.4s ease-in-out infinite}
        .bookstore-grain{position:fixed;inset:-50%;z-index:1;pointer-events:none;opacity:.05;
          background-image:repeating-linear-gradient(0deg,rgba(255,255,255,.6) 0,rgba(0,0,0,.6) 1px,transparent 1px,transparent 2px),repeating-linear-gradient(90deg,rgba(255,255,255,.5) 0,rgba(0,0,0,.5) 1px,transparent 1px,transparent 3px);
          animation:grainShift 8s steps(10) infinite}
        .bd-synopsis{font-size:1.02rem;line-height:1.8;color:rgba(240,234,216,.72)}
        .bd-synopsis::first-letter{float:left;font-family:'Cinzel',serif;font-size:3.4rem;line-height:.82;font-weight:600;color:#c9a44c;padding:.1rem .6rem .1rem 0;margin-top:.1rem}
        .bd-shelfcard{margin-top:1.6rem;background:#ece4cf;color:#2a2318;padding:1rem 1.2rem;border-radius:1px;box-shadow:0 8px 22px rgba(0,0,0,.4);font-size:.9rem;line-height:1.6;font-style:italic;max-width:440px}
        .bd-shelfcard span{display:block;margin-top:.5rem;font-family:'Cinzel',serif;font-size:.56rem;letter-spacing:.14em;font-style:normal;color:#7a5f24}
        .bd-buy{font-family:'Cinzel',serif;font-size:.68rem;letter-spacing:.16em;text-transform:uppercase;padding:.95rem 2.2rem;border:none;border-radius:3px;background:linear-gradient(135deg,#c9a44c,#a8842f);color:#0a0a0a;font-weight:600;cursor:pointer;transition:filter .25s,opacity .25s}
        .bd-buy:hover{filter:brightness(1.08)}
        .bd-buy:disabled{cursor:progress;opacity:.6;filter:none}
        .bd-sample{font-family:'Cinzel',serif;font-size:.68rem;letter-spacing:.16em;text-transform:uppercase;padding:.95rem 2.2rem;border:1px solid rgba(201,164,76,.4);border-radius:3px;background:rgba(201,164,76,.04);color:#c9a44c;font-weight:600;cursor:pointer;text-decoration:none;transition:all .25s;display:inline-flex;align-items:center}
        .bd-sample:hover{background:rgba(201,164,76,.1);border-color:rgba(201,164,76,.7)}
        .colophon{max-width:640px;margin:0 auto;padding:3rem 2rem 5rem;text-align:center;position:relative;z-index:2}
        .colophon-rule{width:80px;height:1px;background:rgba(201,164,76,.3);margin:0 auto 2rem}
        .colophon-text{font-size:.85rem;line-height:1.9;color:rgba(240,234,216,.4);font-style:italic}
        .colophon-mark{margin-top:1.5rem;color:rgba(201,164,76,.5)}
        @media(max-width:720px){.bd-header{grid-template-columns:1fr !important;justify-items:center;text-align:center}.bd-header .bd-cover-wrap{margin-bottom:1rem}.bd-synopsis::first-letter{float:none;font-size:inherit;color:inherit;padding:0;margin:0}.bd-actions{justify-content:center}.bd-shelfcard{margin-left:auto;margin-right:auto}}
      `}</style>

      <div className="bookstore-grain" aria-hidden="true" />

      <main style={{ background: '#070707', color: '#f0ead8', minHeight: '100vh', paddingTop: '68px', position: 'relative' }}>
        <div style={{ maxWidth: '920px', margin: '0 auto', padding: '3.5rem 2rem 4rem', position: 'relative', zIndex: 2 }}>
          {state === 'loading' && (
            <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '3.5rem' }}>
              <div className="bd-skeleton" style={{ width: '280px', aspectRatio: '2/3', borderRadius: '2px 5px 5px 2px' }} />
              <div>
                <div className="bd-skeleton" style={{ height: '.6rem', width: '35%', marginBottom: '1.2rem' }} />
                <div className="bd-skeleton" style={{ height: '2rem', width: '80%', marginBottom: '.8rem' }} />
                <div className="bd-skeleton" style={{ height: '1rem', width: '45%', marginBottom: '2rem' }} />
                <div className="bd-skeleton" style={{ height: '.9rem', width: '100%', marginBottom: '.6rem' }} />
                <div className="bd-skeleton" style={{ height: '.9rem', width: '92%', marginBottom: '.6rem' }} />
                <div className="bd-skeleton" style={{ height: '.9rem', width: '96%' }} />
              </div>
            </div>
          )}

          {/* Returned from a completed Stripe checkout. Modest on purpose — the shelf, not a
              receipt. The webhook is what actually grants the book, and it may land a moment
              after the redirect, so this points at the Library rather than claiming the
              record is already written.

              Gated on state === 'ready' as well as `purchased`: this page is a static export,
              and `purchased` is true on the very first client render when the query is
              present. Rendering it any earlier would put a banner in the hydrated tree that
              the prerendered HTML does not have. `state` is 'loading' until an effect
              resolves, so this branch is reliably closed at hydration. */}
          {purchased && state === 'ready' && (
            <div
              role="status"
              style={{
                display: 'flex', alignItems: 'center', gap: '.9rem', flexWrap: 'wrap',
                margin: '0 0 2.5rem', padding: '1rem 1.3rem',
                border: '1px solid rgba(201,164,76,.28)', borderRadius: '3px',
                background: 'rgba(201,164,76,.06)',
              }}
            >
              <span aria-hidden="true" style={{ color: 'rgba(201,164,76,.75)' }}>&#10086;</span>
              <span style={{ fontSize: '.98rem', fontStyle: 'italic', color: 'rgba(240,234,216,.8)' }}>
                Thank you. This title is now in your Library.
              </span>
              <a
                href="/my-library"
                style={{ fontFamily: "'Cinzel',serif", fontSize: '.58rem', letterSpacing: '.18em', textTransform: 'uppercase', color: '#c9a44c', textDecoration: 'none', borderBottom: '1px solid rgba(201,164,76,.35)', paddingBottom: '2px' }}
              >
                Go to My Library &rarr;
              </a>
            </div>
          )}

          {state === 'ready' && title && (
            <div style={{ animation: 'fadeUp .6s ease forwards' }}>
              {/* Breadcrumb */}
              <nav style={{ fontFamily: "'Cinzel',serif", fontSize: '.56rem', letterSpacing: '.2em', textTransform: 'uppercase', color: 'rgba(201,164,76,.5)', marginBottom: '2.5rem', display: 'flex', gap: '.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <a href="/bookstore" style={{ color: 'rgba(201,164,76,.7)', textDecoration: 'none' }}>Book Store</a>
                <span style={{ opacity: .5 }}>&middot;</span>
                <a href={`/bookstore#${sectionForGenre(title.genre) || 'fiction'}`} style={{ color: 'rgba(201,164,76,.7)', textDecoration: 'none' }}>{section}</a>
                <span style={{ opacity: .5 }}>&middot;</span>
                <span style={{ color: 'rgba(240,234,216,.55)' }}>{title.title}</span>
              </nav>

              {/* Book header */}
              <div className="bd-header" style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: '3.5rem', alignItems: 'start' }}>
                <div className="bd-cover-wrap" style={{ display: 'flex', justifyContent: 'center', paddingTop: '.5rem' }}>
                  <BoundBook title={title} variant="detail" width={220} />
                </div>
                <div>
                  {cat !== null && (
                    <div style={{ fontFamily: "'Cinzel',serif", fontSize: '.6rem', letterSpacing: '.26em', textTransform: 'uppercase', color: '#c9a44c', marginBottom: '.6rem' }}>No. {cat}</div>
                  )}
                  <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '.62rem', fontWeight: 500, letterSpacing: '.22em', textTransform: 'uppercase', color: '#c9a44c', marginBottom: '.9rem' }}>{genreLabel(title.genre)}</div>
                  <h1 style={{ fontFamily: "'Cinzel',serif", fontSize: 'clamp(1.8rem,4vw,2.8rem)', fontWeight: 600, color: '#f0ead8', lineHeight: 1.1, marginBottom: '.7rem' }}>{title.title}</h1>
                  <p style={{ fontSize: '1.15rem', fontStyle: 'italic', fontWeight: 400, color: 'rgba(240,234,216,.55)', marginBottom: '2rem' }}>by {title.author}</p>

                  {title.synopsis && <p className="bd-synopsis" dangerouslySetInnerHTML={{ __html: title.synopsis }} />}

                  {title.shelfCard && (
                    <div className="bd-shelfcard">{title.shelfCard}<span>&mdash; Calvary</span></div>
                  )}

                  {/* Action row */}
                  <div className="bd-actions" style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginTop: '2.2rem' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem', alignItems: 'flex-start' }}>
                      <BuyButton title={title} className="bd-buy" />
                      <span style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '.72rem', fontStyle: 'italic', color: 'rgba(201,164,76,.6)', letterSpacing: '.04em' }}>Available September 2026</span>
                    </div>
                    {title.samplePath && (
                      <a className="bd-sample" href={`/reader/${title.slug}?sample=1`}>Read sample</a>
                    )}
                  </div>
                </div>
              </div>

              {/* Metadata strip */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: '1.5rem 2rem', marginTop: '3.5rem', paddingTop: '2.5rem', borderTop: '1px solid rgba(201,164,76,.1)' }}>
                <MetaItem label="Genre" value={genreLabel(title.genre)} />
                {title.pageCount ? <MetaItem label="Pages" value={String(title.pageCount)} /> : null}
                <MetaItem label="Published" value={formatDate(title.publishedDate)} />
                <MetaItem label="Publisher" value={publisherName || null} />
                {title.isbn ? <MetaItem label="ISBN" value={title.isbn} /> : null}
              </div>

              {/* From the book */}
              {title.excerpt && (
                <div style={{ marginTop: '3.5rem' }}>
                  <div style={{ fontFamily: "'Cinzel',serif", fontSize: '.58rem', letterSpacing: '.28em', textTransform: 'uppercase', color: '#c9a44c', marginBottom: '1.2rem' }}>From the book</div>
                  <blockquote style={{ margin: 0, fontFamily: 'Cormorant Garamond, Georgia, serif', fontStyle: 'italic', fontSize: '1.12rem', lineHeight: 1.85, color: 'rgba(240,234,216,.6)', borderLeft: '2px solid rgba(201,164,76,.3)', paddingLeft: '1.6rem' }}>
                    {truncate(title.excerpt, 600)}
                  </blockquote>
                </div>
              )}
            </div>
          )}
        </div>

        {state === 'ready' && title && (
          <footer className="colophon">
            <div className="colophon-rule" />
            <p className="colophon-text">This catalogue is set in Cormorant Garamond &amp; Cinzel upon a ground of near-black, with ornaments in the printer&rsquo;s tradition. Published on the web by Calvary Media UK. Curated by hand in London &amp; Lagos.</p>
            <div className="colophon-mark">&#10086;</div>
          </footer>
        )}
      </main>
    </>
  );
}
