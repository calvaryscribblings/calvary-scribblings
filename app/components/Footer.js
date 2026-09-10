'use client';
import AppInvite from './AppInvite';

// ⭑ THE FOOTER CARRIES THE APP ROW, AND IT IS SAFE HERE BY CONSTRUCTION.
// The 3.1.1 constraint is that a page which says "buy this book" must not, in the same
// breath, send an iPhone reader to an app where they cannot — under App Store guideline
// 3.1.1 the iPhone app shows no prices and no buy button. This footer is mounted by exactly
// six pages, and not one of them is on the Book Store's buy path:
//
//     /about  /contact  /delete-account  /privacy  /public-library  /terms
//
// The storefront, every title page, the launch gate and the checkout render no Footer at all
// — they mount TabBar and their own chrome. So the row cannot reach a buy surface by being
// here, and it does not need a denylist to stay off one.
//
// ⚠ IF THIS FOOTER IS EVER MOUNTED BY A BOOK STORE PAGE, THE APP ROW MUST COME OUT FIRST.
// That is the whole rule, and it is a rule about where <Footer /> is imported, not about
// anything inside this file. The guard is tests/applinks/placement.spec.mjs, which walks the
// built Book Store pages and fails if a store URL appears in any of them.
export default function Footer({ showAppRow = true }) {
  return (
    <footer style={{ background: '#111111', padding: '4rem 4% 2rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '3rem', marginBottom: '3rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <img src="/logo-header.jpg" alt="CS" style={{ width: 36, height: 36, borderRadius: 6, objectFit: 'cover' }} />
            <span style={{ fontSize: '1rem', fontWeight: 700, color: '#c4b5fd' }}>Calvary Scribblings</span>
          </div>
          <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: '0.85rem', lineHeight: 1.7 }}>
            A Calvary Media UK publication. Stories that inspire, inform, and illuminate.
          </p>
        </div>
        {[
          { title: 'Explore', links: [['Flash Fiction', '/flash'], ['Short Stories', '/short'], ['Poetry', '/poetry'], ['News & Updates', '/news'], ['Inspiring Stories', '/inspiring'], ['The Series', '/series'], ['Open Pages', '/open-pages']] },
          { title: 'Connect', links: [['Newsletter', '/public-library#subscribe'], ['Contact Us', '/contact'], ['About Us', '/about']] },
          { title: 'Legal', links: [['Privacy Policy', '/privacy'], ['Terms of Service', '/terms'], ['Delete Account', '/delete-account']] },
        ].map(({ title, links }) => (
          <div key={title}>
            <h5 style={{ color: '#a78bfa', marginBottom: '1rem', fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em' }}>{title}</h5>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              {links.map(([label, href]) => (
                <a key={href} href={href}
                  style={{ color: 'rgba(255,255,255,0.55)', textDecoration: 'none', fontSize: '0.875rem', transition: 'color 0.2s' }}
                  onMouseEnter={e => e.target.style.color = '#c4b5fd'}
                  onMouseLeave={e => e.target.style.color = 'rgba(255,255,255,0.55)'}>
                  {label}
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
      {/* Above the copyright rule, below the columns — the last useful thing on the page
          rather than a fourth column competing with Explore/Connect/Legal. Renders nothing
          at all while both flags are false. */}
      {showAppRow && (
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '2rem', marginBottom: '1.25rem' }}>
          <AppInvite variant="row" />
        </div>
      )}
      <div style={{ borderTop: showAppRow ? 'none' : '1px solid rgba(255,255,255,0.06)', paddingTop: '2rem', textAlign: 'center', color: 'rgba(255,255,255,0.35)', fontSize: '0.8rem' }}>
        © 2026 Calvary Scribblings. A Calvary Media UK Publication. All rights reserved.
      </div>
    </footer>
  );
}
