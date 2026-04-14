'use client';
import { useState } from 'react';

const TIPS = [
  { label: '£1', url: 'https://buy.stripe.com/test_28E00beF78gV7As3Up4Rq01' },
  { label: '£2', url: 'https://buy.stripe.com/test_aFa4gr40t54J6wo9eJ4Rq02' },
  { label: '£5', url: 'https://buy.stripe.com/test_5kQ7sDaoR40F9IAgHb4Rq03' },
  { label: '£10', url: 'https://buy.stripe.com/test_fZudR17cF40Fg6Y3Up4Rq04' },
  { label: '£20', url: 'https://buy.stripe.com/test_8x26oz0Oh2WBdYQ76B4Rq06' },
  { label: '£50', url: 'https://buy.stripe.com/test_8x26oz0Oh2WBdYQ76B4Rq06' },
];

export default function TipBox({ variant = 'story' }) {
  const [selected, setSelected] = useState(null);
  const [hovered, setHovered] = useState(null);
  const isReader = variant === 'reader';
  const isSquare = variant === 'square';

  return (
    <div style={{
      background: isSquare ? 'rgba(107,47,173,0.06)' : 'rgba(201,164,76,0.04)',
      border: '1px solid ' + (isSquare ? 'rgba(107,47,173,0.18)' : 'rgba(201,164,76,0.15)'),
      borderRadius: isSquare ? '16px' : '4px',
      padding: isSquare ? '1.25rem 1.5rem' : '1.75rem 2rem',
      margin: isSquare ? '0' : '0 auto',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '0.6rem' }}>
        <span style={{ fontFamily: "'Cinzel', serif", fontSize: '0.58rem', letterSpacing: '0.22em', textTransform: 'uppercase', color: 'rgba(201,164,76,0.7)' }}>Support the Island</span>
      </div>
      <p style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: isSquare ? '0.88rem' : '0.95rem', fontStyle: 'italic', color: (isReader || isSquare) ? 'rgba(240,234,216,0.55)' : 'rgba(26,10,14,0.6)', lineHeight: 1.65, marginBottom: '1.25rem' }}>
        Calvary Scribblings is a labour of love — free to read, free to join. If the stories move you, a small tip keeps the island alive.
      </p>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '1rem' }}>
        {TIPS.map(tip => {
          const isActive = selected === tip.label;
          const isHov = hovered === tip.label;
          return (
            <button key={tip.label} onMouseEnter={() => setHovered(tip.label)} onMouseLeave={() => setHovered(null)} onClick={() => setSelected(tip.label)} style={{ padding: '7px 16px', borderRadius: '999px', border: '1px solid ' + (isActive ? '#6b2fad' : 'rgba(201,164,76,0.3)'), background: isActive ? '#6b2fad' : isHov ? 'rgba(107,47,173,0.08)' : 'transparent', color: isActive ? '#fff' : (isReader || isSquare) ? 'rgba(240,234,216,0.7)' : 'rgba(26,10,14,0.65)', fontFamily: "'Cinzel', serif", fontSize: '0.6rem', letterSpacing: '0.1em', cursor: 'pointer', transition: 'all 0.2s' }}>
              {tip.label}
            </button>
          );
        })}
      </div>
      <a href={selected ? TIPS.find(t => t.label === selected)?.url : '#'} target="_blank" rel="noopener noreferrer" onClick={e => { if (!selected) e.preventDefault(); }} style={{ display: 'inline-block', padding: '9px 24px', background: selected ? '#6b2fad' : 'rgba(107,47,173,0.15)', border: '1px solid ' + (selected ? '#6b2fad' : 'rgba(107,47,173,0.25)'), borderRadius: '2px', fontFamily: "'Cinzel', serif", fontSize: '0.58rem', letterSpacing: '0.18em', textTransform: 'uppercase', color: selected ? '#fff' : 'rgba(155,109,255,0.5)', textDecoration: 'none', cursor: selected ? 'pointer' : 'not-allowed', transition: 'all 0.2s' }}>
        {selected ? 'Send ' + selected + ' tip' : 'Select an amount'}
      </a>
      <div style={{ marginTop: '0.75rem' }}>
        <span style={{ fontFamily: "'Inter', sans-serif", fontSize: '0.52rem', color: 'rgba(128,100,80,0.4)', letterSpacing: '0.06em' }}>Secured by Stripe</span>
      </div>
    </div>
  );
}