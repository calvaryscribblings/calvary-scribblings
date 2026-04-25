'use client';
import { categoryMeta } from '../lib/stories';

const meta = categoryMeta['serial'];

export default function SerialPage() {
  return (
    <div style={{ background: '#0a0a0a', minHeight: '100vh', fontFamily: "'Cochin', Georgia, serif" }}>
      <nav style={{ position: 'sticky', top: 0, zIndex: 100, padding: '0 4%', height: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(10,10,10,0.96)', backdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <a href="/" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', textDecoration: 'none' }}>
          <img src="/logo-header.jpg" alt="CS" style={{ width: 38, height: 38, borderRadius: 7, objectFit: 'cover' }} />
          <span style={{ fontSize: '1rem', fontWeight: 700, color: '#c4b5fd' }}>Calvary Scribblings</span>
        </a>
        <a href="/" style={{ color: 'rgba(255,255,255,0.5)', textDecoration: 'none', fontSize: '0.85rem' }} onMouseEnter={e => e.target.style.color = '#fff'} onMouseLeave={e => e.target.style.color = 'rgba(255,255,255,0.5)'}>← Back to Home</a>
      </nav>
      <section style={{ padding: '4rem 4% 3rem', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>{meta.emoji}</div>
        <h1 style={{ fontSize: 'clamp(2rem, 5vw, 3.5rem)', fontWeight: 700, color: '#fff', marginBottom: '0.75rem' }}>{meta.label}</h1>
      </section>
      <section style={{ padding: '6rem 4%', textAlign: 'center' }}>
        <div style={{ fontSize: '4rem', marginBottom: '1.5rem' }}>📚</div>
        <h2 style={{ fontSize: '1.8rem', fontWeight: 700, color: '#e5e5e5', marginBottom: '1rem' }}>Coming Soon</h2>
        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '1rem', maxWidth: 400, margin: '0 auto 2rem' }}>
          Our first serial story is in the works. Subscribe to be the first to know when Part 1 drops.
        </p>
        <a href="/#subscribe" style={{ display: 'inline-block', background: 'linear-gradient(135deg, #7c3aed, #a855f7)', color: '#fff', padding: '0.85rem 2rem', borderRadius: 6, textDecoration: 'none', fontWeight: 700, fontSize: '0.9rem' }}>
          Subscribe for Updates
        </a>
      </section>
    </div>
  );
}
