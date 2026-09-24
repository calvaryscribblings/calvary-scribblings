'use client';
// W2 — what a list draws when it has no cards to draw: a skeleton while the FIRST read is out, a
// designed failure if it failed, and — only for a real, successful, empty answer — `empty`.
// Returns null when there are items: the page then draws its own grid.
import Unavailable from './Unavailable';

export function SkeletonGrid({ count = 6, columns = 2, ratio = '2 / 3' }) {
  return (
    <section aria-busy="true" aria-label="Loading" style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: 12, padding: '0 16px 32px', marginTop: 16 }}>
      <style>{`@keyframes cs-skel{0%,100%{opacity:.55}50%{opacity:.9}}@media (prefers-reduced-motion: reduce){.cs-skel{animation:none!important}}`}</style>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="cs-skel" style={{ aspectRatio: ratio, borderRadius: 10, background: 'rgba(245,240,232,0.05)', animation: 'cs-skel 1.6s ease-in-out infinite' }} />
      ))}
    </section>
  );
}

export default function ShelfState({ shelf, count, empty, subject, skeleton }) {
  if (shelf.phase === 'loading') return skeleton ?? <SkeletonGrid />;
  if (shelf.phase === 'failed') {
    return <Unavailable kind={shelf.failure} onRetry={shelf.retry} refreshing={shelf.refreshing} subject={subject} />;
  }
  if (count === 0) {
    return (
      <div style={{ textAlign: 'center', color: 'rgba(245,240,232,0.62)', padding: '4rem 24px', fontStyle: 'italic', fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 17 }}>
        {empty}
      </div>
    );
  }
  return null;
}
