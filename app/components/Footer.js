'use client';

export default function Footer() {
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
          { title: 'Explore', links: [['Flash Fiction', '/flash'], ['Short Stories', '/short'], ['Poetry', '/poetry'], ['News & Updates', '/news'], ['Inspiring Stories', '/inspiring'], ['Serial Stories', '/serial'], ['Open Pages', '/open-pages']] },
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
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '2rem', textAlign: 'center', color: 'rgba(255,255,255,0.35)', fontSize: '0.8rem' }}>
        © 2026 Calvary Scribblings. A Calvary Media UK Publication. All rights reserved.
      </div>
    </footer>
  );
}
