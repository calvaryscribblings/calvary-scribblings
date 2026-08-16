'use client';
// THE SERIES — the landing page. Netflix-style: a poster opens a series, which lists its
// instalments, each of which opens in the reader.
//
// PUBLIC BY CONSTRUCTION. Everything on this page renders for a signed-out reader: posters,
// synopses, the instalment count so far, and the release date of whatever is next. Nothing
// here asks who you are, because nothing here is gated — the gate is on the FILE, and it
// lives in functions/api/series/stream.js. See app/series/layout.js for why that matters to
// the sitemap.
//
// The count under each poster is DERIVED, not read from a field. releasedCount() counts rows
// whose status is published and whose releaseAtMs has passed on the caller's clock. There is
// no instalmentCount on the parent record and there should never be one — see the note in
// app/lib/series/schema.js on why the bookstore's titlesCount was rejected as a model.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import TabBar from '../components/TabBar';
import { getPublishedSeries, getInstalments } from '../lib/series/loader';
import { shelfLine } from '../lib/series/format';
import { SERIES_TIER_GATE_ENABLED } from '../lib/series/access';

const DISPLAY = "'Cormorant Garamond', Georgia, serif";
const LABEL = "'Cinzel', 'Cormorant Garamond', Georgia, serif";
const BODY = "Cormorant Garamond, Georgia, serif";

// The kicker follows the flag rather than stating an ambition. Printing PLATINUM over a
// section that is currently free to everyone would be the page telling a reader something the
// endpoint disagrees with — and the reader would find out by tapping.
const KICKER = SERIES_TIER_GATE_ENABLED ? 'PLATINUM' : 'FREE TO READ';
const TITLE = 'The Series';
const DESCRIPTION = SERIES_TIER_GATE_ENABLED
  ? 'Long-form fiction in instalments. Each one its own complete book, arriving on its own date.'
  : 'Long-form fiction in instalments. Each one its own complete book, arriving on its own date — and free to everyone until memberships open.';

export default function SeriesLandingPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await getPublishedSeries();
      // One instalment query per series. Parallel, and each is independently allowed to fail
      // — a series whose rows will not load renders with no count rather than taking the
      // whole shelf down with it.
      const withRows = await Promise.all(
        list.map(async (s) => ({ ...s, rows: await getInstalments(s.id) })),
      );
      if (!cancelled) { setRows(withRows); setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div style={{ background: '#080610', minHeight: '100vh', fontFamily: BODY }}>
      <style>{`
        .sr-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; padding: 0 16px 40px; margin-top: 18px; }
        @media (min-width: 720px) { .sr-grid { grid-template-columns: repeat(3, 1fr); gap: 18px; } }
        @media (min-width: 1100px) { .sr-grid { grid-template-columns: repeat(4, 1fr); } }
        .sr-card { display: block; text-decoration: none; border-radius: 10px; overflow: hidden; background: #0d0a18; border: 1px solid rgba(255,255,255,0.07); transition: transform .18s ease, border-color .18s ease; }
        .sr-card:hover { transform: translateY(-3px); border-color: rgba(201,168,76,0.45); }
        .sr-poster { aspect-ratio: 2 / 3; width: 100%; object-fit: cover; display: block; background: linear-gradient(160deg, #1a0f2e, #0d0a18); }
      `}</style>

      <nav style={{ position: 'sticky', top: 0, zIndex: 100, padding: '0 4%', height: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(8,6,16,0.96)', backdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <Link href="/public-library" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', textDecoration: 'none' }}>
          <span
            role="presentation"
            style={{ width: 38, height: 38, borderRadius: 7, backgroundImage: 'url(/logo-header.jpg)', backgroundSize: 'cover', display: 'block' }}
          />
          <span style={{ fontSize: '1rem', fontWeight: 700, color: '#c4b5fd' }}>Calvary Scribblings</span>
        </Link>
        <Link href="/membership" style={{ fontFamily: LABEL, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#c9a84c', textDecoration: 'none' }}>Membership</Link>
      </nav>

      <section style={{ padding: '3rem 4% 2rem', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'linear-gradient(180deg, #14082a 0%, #080610 80%)' }}>
        <span style={{ fontFamily: LABEL, fontSize: 9, letterSpacing: '0.32em', textTransform: 'uppercase', color: '#c9a84c', marginBottom: 10, display: 'block' }}>{KICKER}</span>
        <h1 style={{ fontFamily: DISPLAY, fontSize: 'clamp(2.2rem, 8vw, 3.4rem)', fontWeight: 600, color: '#f5f0e8', lineHeight: 1.05, marginBottom: 12 }}>{TITLE}</h1>
        <p style={{ fontFamily: DISPLAY, fontSize: 15, fontStyle: 'italic', color: 'rgba(245,240,232,0.55)', lineHeight: 1.6, maxWidth: 460, margin: 0 }}>{DESCRIPTION}</p>
      </section>

      {loading && (
        <p style={{ padding: '3rem 4%', color: 'rgba(245,240,232,0.35)', fontSize: 14 }}>Loading the shelf…</p>
      )}

      {!loading && rows.length === 0 && (
        <section style={{ padding: '5rem 4%', textAlign: 'center' }}>
          <h2 style={{ fontFamily: DISPLAY, fontSize: '1.6rem', color: '#e5e5e5', marginBottom: '0.75rem' }}>The first series is being written.</h2>
          <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14, maxWidth: 420, margin: '0 auto' }}>
            Nothing is listed yet. When the first instalment has a date, it will appear here with it.
          </p>
        </section>
      )}

      {!loading && rows.length > 0 && (
        <div className="sr-grid">
          {rows.map((s) => (
            <Link key={s.id} className="sr-card" href={`/series/${s.slug}`}>
              {/* A decorative fill, not a content image: the series title is right beneath
                  it in real text, so there is nothing here for alt to say. background-size
                  cover is the same rendering object-fit:cover gives. */}
              <div
                className="sr-poster"
                role="presentation"
                style={s.coverUrl ? { backgroundImage: `url(${s.coverUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
              />
              <div style={{ padding: '10px 12px 14px' }}>
                <h2 style={{ fontFamily: DISPLAY, fontSize: 16, fontWeight: 600, color: '#f5f0e8', margin: '0 0 4px', lineHeight: 1.25 }}>{s.title}</h2>
                <p style={{ fontFamily: BODY, fontSize: 11.5, color: 'rgba(245,240,232,0.42)', margin: 0 }}>{shelfLine(s.rows || [])}</p>
              </div>
            </Link>
          ))}
        </div>
      )}

      <TabBar />
    </div>
  );
}
