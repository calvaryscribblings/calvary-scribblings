'use client';
import { use, useEffect, useState } from 'react';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { getTitleBySlug, getPublisher } from '../../lib/bookstore/loader';
import { sectionForGenre } from '../page';
import Navbar from '../../components/Navbar';
import Footer from '../../components/Footer';

// Presentation labels for genre slugs — kept local (R2's map isn't exported). Every slug here
// is a member of GENRES in schema.js.
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

function formatGbp(minor) {
  if (typeof minor !== 'number' || !Number.isFinite(minor)) return null;
  return `£${(minor / 100).toFixed(2)}`;
}

// ISO date (YYYY-MM-DD) → long British form. Falls back to the raw string on parse failure.
function formatDate(iso) {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const month = months[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : iso;
}

// Deterministic gradient for the fallback cover, keyed off the slug (matches R2's approach).
const COLORS = [
  'linear-gradient(148deg,#1a0a2e 0%,#0e0618 100%)',
  'linear-gradient(148deg,#0e1a2e 0%,#060e1a 100%)',
  'linear-gradient(148deg,#1a120a 0%,#0e0806 100%)',
  'linear-gradient(148deg,#0a1a12 0%,#060e08 100%)',
  'linear-gradient(148deg,#1a0a14 0%,#0e0608 100%)',
  'linear-gradient(148deg,#141418 0%,#08080e 100%)',
];
function gradientFor(seed) {
  let h = 0;
  const s = String(seed || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

// ~600 chars, cut on a word boundary so we never slice mid-word.
function truncate(text, max = 600) {
  const t = String(text || '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}

function Divider() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', margin: '3.5rem 0 0' }}>
      <div style={{ flex: 1, height: '1px', background: 'rgba(201,164,76,.12)' }} />
      <span style={{ color: 'rgba(201,164,76,.5)', fontSize: '.8rem' }}>&#10086;</span>
      <div style={{ flex: 1, height: '1px', background: 'rgba(201,164,76,.12)' }} />
    </div>
  );
}

function Cover({ title }) {
  const wrap = {
    position: 'relative', width: '280px', maxWidth: '100%', aspectRatio: '2/3',
    borderRadius: '2px 5px 5px 2px', overflow: 'hidden', flexShrink: 0,
    background: gradientFor(title.slug || title.title),
    boxShadow: '8px 14px 48px rgba(0,0,0,.8),0 0 0 1px rgba(201,164,76,.12),inset -4px 0 10px rgba(0,0,0,.4)',
  };
  if (title.coverUrl) {
    return (
      <div style={wrap}>
        <Image src={title.coverUrl} alt={title.title} fill unoptimized sizes="280px" style={{ objectFit: 'cover' }} />
      </div>
    );
  }
  return (
    <div style={{ ...wrap, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem 1.4rem', textAlign: 'center' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '7px', background: 'rgba(0,0,0,.4)' }} />
      <div style={{ fontSize: '1.15rem', fontWeight: 600, color: 'rgba(255,255,255,.88)', lineHeight: 1.25, marginBottom: '.6rem', fontFamily: 'Cormorant Garamond, Georgia, serif' }}>{title.title}</div>
      <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '.8rem', letterSpacing: '.06em', color: 'rgba(255,255,255,.42)', fontStyle: 'italic' }}>{title.author}</div>
    </div>
  );
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // getTitleBySlug already filters suspended publishers, but it does NOT gate on status —
      // so we enforce published here (task: not found OR not published → notFound()).
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

  if (state === 'missing') notFound();

  const price = title ? formatGbp(title.prices?.gbp) : null;
  const section = title ? sectionLabel(title.genre) : '';

  return (
    <>
      <Navbar />
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;0,700;1,300;1,400;1,600&family=Cinzel:wght@400;600&family=Inter:wght@300;400;500;600&display=swap');
        body{background:#0a0a0a;color:#f0ead8;font-family:'Cormorant Garamond',Georgia,serif;overflow-x:hidden}
        @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pulse{0%,100%{opacity:.35}50%{opacity:.7}}
        .bd-skeleton{background:rgba(201,164,76,.08);border-radius:3px;animation:pulse 1.4s ease-in-out infinite}
        .bd-synopsis{font-size:1.02rem;line-height:1.8;color:rgba(240,234,216,.72)}
        .bd-synopsis::first-letter{float:left;font-family:'Cinzel',serif;font-size:3.4rem;line-height:.82;font-weight:600;color:#c9a44c;padding:.1rem .6rem .1rem 0;margin-top:.1rem}
        .bd-buy{font-family:'Cinzel',serif;font-size:.68rem;letter-spacing:.16em;text-transform:uppercase;padding:.95rem 2.2rem;border:none;border-radius:3px;background:linear-gradient(135deg,#c9a44c,#a8842f);color:#0a0a0a;font-weight:600;cursor:not-allowed;opacity:.55}
        .bd-sample{font-family:'Cinzel',serif;font-size:.68rem;letter-spacing:.16em;text-transform:uppercase;padding:.95rem 2.2rem;border:1px solid rgba(201,164,76,.4);border-radius:3px;background:rgba(201,164,76,.04);color:#c9a44c;font-weight:600;cursor:pointer;text-decoration:none;transition:all .25s;display:inline-flex;align-items:center}
        .bd-sample:hover{background:rgba(201,164,76,.1);border-color:rgba(201,164,76,.7)}
        @media(max-width:720px){.bd-header{grid-template-columns:1fr !important;justify-items:center;text-align:center}.bd-header .bd-cover-wrap{margin-bottom:1rem}.bd-synopsis::first-letter{float:none;font-size:inherit;color:inherit;padding:0;margin:0}.bd-actions{justify-content:center}}
      `}</style>

      <main style={{ background: '#0a0a0a', color: '#f0ead8', minHeight: '100vh', paddingTop: '68px' }}>
        <div style={{ maxWidth: '920px', margin: '0 auto', padding: '3.5rem 2rem 5rem' }}>
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

          {state === 'ready' && title && (
            <div style={{ animation: 'fadeUp .6s ease forwards' }}>
              {/* Breadcrumb */}
              <nav style={{ fontFamily: "'Cinzel',serif", fontSize: '.56rem', letterSpacing: '.2em', textTransform: 'uppercase', color: 'rgba(201,164,76,.5)', marginBottom: '2.5rem', display: 'flex', gap: '.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <a href="/bookstore" style={{ color: 'rgba(201,164,76,.7)', textDecoration: 'none' }}>Book Store</a>
                <span style={{ opacity: .5 }}>·</span>
                <a href={`/bookstore#${sectionForGenre(title.genre) || 'fiction'}`} style={{ color: 'rgba(201,164,76,.7)', textDecoration: 'none' }}>{section}</a>
                <span style={{ opacity: .5 }}>·</span>
                <span style={{ color: 'rgba(240,234,216,.55)' }}>{title.title}</span>
              </nav>

              {/* Book header */}
              <div className="bd-header" style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '3.5rem', alignItems: 'start' }}>
                <div className="bd-cover-wrap"><Cover title={title} /></div>
                <div>
                  <div style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '.62rem', fontWeight: 500, letterSpacing: '.22em', textTransform: 'uppercase', color: '#c9a44c', marginBottom: '.9rem' }}>{genreLabel(title.genre)}</div>
                  <h1 style={{ fontFamily: "'Cinzel',serif", fontSize: 'clamp(1.8rem,4vw,2.8rem)', fontWeight: 600, color: '#f0ead8', lineHeight: 1.1, marginBottom: '.7rem' }}>{title.title}</h1>
                  <p style={{ fontSize: '1.15rem', fontStyle: 'italic', fontWeight: 400, color: 'rgba(240,234,216,.55)', marginBottom: '2rem' }}>by {title.author}</p>

                  {title.synopsis && <p className="bd-synopsis" dangerouslySetInnerHTML={{ __html: title.synopsis }} />}

                  {/* Action row */}
                  <div className="bd-actions" style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginTop: '2.2rem' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem', alignItems: 'flex-start' }}>
                      <button className="bd-buy" type="button" disabled title="Purchasing opens at launch">{price ? `Buy · ${price}` : 'Buy'}</button>
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
                    {truncate(title.excerpt)}
                  </blockquote>
                </div>
              )}

              <Divider />
            </div>
          )}
        </div>
      </main>

      <Footer />
    </>
  );
}
