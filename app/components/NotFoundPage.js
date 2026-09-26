'use client';
// W2 / BS-13 — THE HOUSE 404. Before W2 there was no root app/not-found.js, so /stories/nope,
// /series/nope and every mistyped address got Next's default: a white page in Arial with no nav
// and no way back. This is the page instead — house faces on ink, what happened, two ways on, and
// the tab bar. Words RULED (Ikenna, 26 Sep 2026, 01:53): approved as W2 wrote them, in house style (docs/COPY-RULINGS.md).
import Link from 'next/link';
import TabBar, { TabLinks } from './TabBar';

const DISPLAY = "'Cormorant Garamond', Georgia, serif";
const LABEL = "'Cinzel', 'Cormorant Garamond', Georgia, serif";

export const NOT_FOUND_COPY = {
  eyebrow: 'NOT ON THE ISLAND',
  title: 'There’s nothing at this address.',
  body: 'The link may be mistyped, or the page may have moved. Everything on the island starts from the library.',
  home: 'Go to the library',
  search: 'Search',
};

const btn = (primary) => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: 44, padding: '0 24px',
  borderRadius: 999, textDecoration: 'none', fontFamily: LABEL, fontSize: 11, letterSpacing: '0.18em',
  textTransform: 'uppercase', color: '#f5f0e8',
  border: `1px solid ${primary ? 'rgba(201,168,76,0.55)' : 'rgba(245,240,232,0.2)'}`,
  background: primary ? 'rgba(201,168,76,0.10)' : 'transparent',
});

export default function NotFoundPage({ copy = NOT_FOUND_COPY }) {
  return (
    <div style={{ minHeight: '100vh', background: '#080610', color: '#f5f0e8', fontFamily: DISPLAY, display: 'flex', flexDirection: 'column' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4%', height: 64, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <Link href="/public-library" style={{ fontSize: '1rem', fontWeight: 700, color: '#c4b5fd', textDecoration: 'none', minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>Calvary Scribblings</Link>
        <TabLinks />
      </header>
      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '56px 24px' }}>
        <div style={{ maxWidth: 440, textAlign: 'center' }}>
          <div style={{ fontFamily: LABEL, fontSize: 10, letterSpacing: '0.3em', color: '#c9a84c' }}>{copy.eyebrow}</div>
          <div aria-hidden="true" style={{ width: 56, height: 1, background: 'rgba(201,168,76,0.45)', margin: '8px auto 0' }} />
          <div aria-hidden="true" style={{ fontSize: 22, color: 'rgba(201,168,76,0.7)', marginTop: 24 }}>&#10022;</div>
          <h1 style={{ fontSize: 'clamp(1.6rem, 6vw, 2.1rem)', fontWeight: 600, lineHeight: 1.2, margin: '16px 0 0', textWrap: 'balance' }}>{copy.title}</h1>
          <p style={{ fontSize: 17, lineHeight: 1.55, color: 'rgba(245,240,232,0.78)', margin: '12px 0 0', textWrap: 'pretty' }}>{copy.body}</p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginTop: 28 }}>
            <Link href={copy.homeHref || '/public-library'} style={btn(true)}>{copy.home}</Link>
            <Link href="/search" style={btn(false)}>{copy.search}</Link>
          </div>
        </div>
      </main>
      <TabBar />
    </div>
  );
}
