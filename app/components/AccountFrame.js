'use client';
// W2 / ACC-06, ACC-07 — the frame an account page stands in while it cannot draw itself:
// loading, a failed read, or a reader who does not exist. It replaces three blank boards
// (`<div style={{ minHeight: '100vh', background: '#0d0d0d' }} />`) that stood while loading and,
// with the database unreachable, for good — and /user's grey "User not found." with no way on.
// It always carries a way out: the wordmark home, and the tab bar.
import Link from 'next/link';
import TabBar from './TabBar';
import Unavailable from './Unavailable';

const DISPLAY = "'Cormorant Garamond', Georgia, serif";

export function AccountSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" style={{ maxWidth: 520, margin: '0 auto', padding: '48px 24px' }}>
      <style>{`@keyframes acc-skel{0%,100%{opacity:.5}50%{opacity:.85}}@media (prefers-reduced-motion: reduce){.acc-skel{animation:none!important}}`}</style>
      <div className="acc-skel" style={{ width: 88, height: 88, borderRadius: '50%', margin: '0 auto', background: 'rgba(245,240,232,0.06)', animation: 'acc-skel 1.6s ease-in-out infinite' }} />
      {[60, 40, 80, 72].map((w, i) => (
        <div key={i} className="acc-skel" style={{ height: i === 0 ? 22 : 12, width: `${w}%`, margin: `${i === 0 ? 24 : 12}px auto 0`, borderRadius: 4, background: 'rgba(245,240,232,0.06)', animation: 'acc-skel 1.6s ease-in-out infinite' }} />
      ))}
    </div>
  );
}

export default function AccountFrame({ children }) {
  return (
    <div style={{ minHeight: '100vh', background: '#0d0d0d', fontFamily: DISPLAY }}>
      <nav style={{ maxWidth: 740, margin: '0 auto', padding: '1.1rem 1.5rem' }}>
        <Link href="/public-library" style={{ fontSize: '1rem', fontWeight: 600, color: '#f5f0e8', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', minHeight: 44 }}>
          Calvary <span style={{ color: '#a78bfa', marginLeft: 4 }}>Scribblings</span>
        </Link>
      </nav>
      {children}
      <TabBar />
    </div>
  );
}

/** A failed first read, in the frame. */
export function AccountUnavailable({ failure, onRetry, refreshing, subject }) {
  return (
    <AccountFrame>
      <Unavailable kind={failure} onRetry={onRetry} refreshing={refreshing} subject={subject} />
    </AccountFrame>
  );
}
