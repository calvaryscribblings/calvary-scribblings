'use client';
// QuickLookModal — the back-cover quick look reached from the shelf gesture. A dark card:
// catalogue No. kicker, title, author, opening-line pull-quote, blurb, Buy + Read sample,
// Full details → /bookstore/[slug].
//   Desktop (≥640px): morphs from the flipped book's rect to centre (transform only).
//   Mobile (<640px):  a bottom sheet with a grab handle, slides up (no morph).
// Escape / veil / × = put back: the modal recedes and the caller un-flips the book.
import { useEffect, useRef, useState } from 'react';
import { formatGbp, resolveOpeningLine, resolveBackBlurb, formatCatalogueNumber } from './fields';

const CARD_W = 440;

export default function QuickLookModal({ title, originRect, onClose }) {
  const [phase, setPhase] = useState('enter'); // 'enter' → 'open' → 'closing'
  const [isMobile, setIsMobile] = useState(false);
  const cardRef = useRef(null);
  const closingRef = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia('(max-width:639px)');
    setIsMobile(mq.matches);
  }, []);

  // Drive enter → open on the next frame so the initial (morph-start) transform paints first.
  useEffect(() => {
    const r = requestAnimationFrame(() => requestAnimationFrame(() => setPhase('open')));
    return () => cancelAnimationFrame(r);
  }, []);

  const close = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    setPhase('closing');
    setTimeout(() => onClose?.(), 380);
  };

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, []);

  const opening = resolveOpeningLine(title);
  const blurb = resolveBackBlurb(title);
  const price = formatGbp(title.prices?.gbp);
  const cat = formatCatalogueNumber(title.catalogueNumber);

  // Desktop morph transform for the enter/closing phases.
  let cardTransform = 'translate(0,0) scale(1)';
  if (!isMobile && originRect && (phase === 'enter' || phase === 'closing')) {
    const dx = (originRect.left + originRect.width / 2) - window.innerWidth / 2;
    const dy = (originRect.top + originRect.height / 2) - window.innerHeight / 2;
    const scale = Math.max(0.18, Math.min(0.9, originRect.width / CARD_W));
    cardTransform = `translate(${dx}px,${dy}px) scale(${scale})`;
  }

  const mobileTransform = phase === 'open' ? 'translateY(0)' : 'translateY(102%)';

  const veilOpacity = phase === 'open' ? 1 : 0;

  const cardBase = {
    position: 'relative', background: 'linear-gradient(158deg,#141018 0%,#0b0810 100%)',
    border: '1px solid rgba(201,164,76,.18)', color: '#f0ead8',
    boxShadow: '0 30px 90px rgba(0,0,0,.7),0 0 0 1px rgba(0,0,0,.4)',
    fontFamily: "Cormorant Garamond, Georgia, serif",
  };

  const desktopCard = {
    ...cardBase, width: `min(${CARD_W}px,92vw)`, borderRadius: '4px', padding: '2.4rem 2.4rem 2rem',
    transform: cardTransform, opacity: phase === 'enter' ? 0.4 : phase === 'closing' ? 0 : 1,
    transformOrigin: 'center center', transition: 'transform .42s cubic-bezier(.2,.72,.16,1), opacity .42s ease',
  };
  const mobileCard = {
    ...cardBase, width: '100%', borderRadius: '18px 18px 0 0', padding: '1rem 1.5rem 2rem',
    transform: mobileTransform, transition: 'transform .4s cubic-bezier(.2,.72,.16,1)',
  };

  return (
    <div
      role="dialog" aria-modal="true" aria-label={`${title.title} — quick look`}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1200, display: 'flex',
        alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center',
        padding: isMobile ? 0 : '2rem',
        background: `rgba(4,4,6,${0.72 * veilOpacity})`, transition: 'background .38s ease',
      }}
    >
      <style>{`
        @keyframes ql-breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.012)}}
      `}</style>
      <div ref={cardRef} style={isMobile ? mobileCard : desktopCard}>
        {isMobile && (
          <div style={{ width: '38px', height: '4px', borderRadius: '999px', background: 'rgba(201,164,76,.35)', margin: '0 auto 1.4rem' }} />
        )}
        <button
          onClick={close} aria-label="Close"
          style={{ position: 'absolute', top: '.9rem', right: '1rem', background: 'none', border: 'none', color: 'rgba(201,164,76,.6)', fontSize: '1.3rem', lineHeight: 1, cursor: 'pointer', padding: '.2rem' }}
        >&times;</button>

        {cat !== null && (
          <div style={{ fontFamily: "'Cinzel',serif", fontSize: '.56rem', letterSpacing: '.26em', textTransform: 'uppercase', color: '#c9a44c', marginBottom: '.7rem' }}>{cat}</div>
        )}
        <h2 style={{ fontFamily: "'Cinzel',serif", fontSize: '1.5rem', fontWeight: 600, lineHeight: 1.15, color: '#f0ead8', marginBottom: '.35rem' }}>{title.title}</h2>
        <p style={{ fontSize: '1rem', fontStyle: 'italic', color: 'rgba(240,234,216,.5)', marginBottom: '1.3rem' }}>by {title.author}</p>

        {opening && (
          <p style={{ fontStyle: 'italic', fontSize: '1.05rem', lineHeight: 1.6, color: 'rgba(240,234,216,.82)', borderLeft: '2px solid rgba(201,164,76,.35)', paddingLeft: '1rem', marginBottom: '1.2rem' }}>&ldquo;{opening}&rdquo;</p>
        )}
        {blurb && (
          <p style={{ fontSize: '.95rem', lineHeight: 1.7, color: 'rgba(240,234,216,.62)', marginBottom: '1.6rem' }}>{blurb}</p>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '.9rem', flexWrap: 'wrap', marginBottom: '1.4rem' }}>
          {/* A link to the detail page, NOT a checkout. R5 keeps exactly one place in the
              bookstore where a charge can begin; a quick look is for deciding, and the
              decision is made on the page that shows the whole book. */}
          <a href={`/bookstore/${title.slug}`} style={{ fontFamily: "'Cinzel',serif", fontSize: '.64rem', letterSpacing: '.16em', textTransform: 'uppercase', padding: '.85rem 1.8rem', border: 'none', borderRadius: '3px', background: 'linear-gradient(135deg,#c9a44c,#a8842f)', color: '#0a0a0a', fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>{price ? `Buy · ${price}` : 'Buy'}</a>
          {title.samplePath && (
            <a href={`/reader/${title.slug}?sample=1`} style={{ fontFamily: "'Cinzel',serif", fontSize: '.64rem', letterSpacing: '.16em', textTransform: 'uppercase', padding: '.85rem 1.8rem', border: '1px solid rgba(201,164,76,.4)', borderRadius: '3px', background: 'rgba(201,164,76,.04)', color: '#c9a44c', fontWeight: 600, textDecoration: 'none' }}>Read sample</a>
          )}
        </div>

        <a href={`/bookstore/${title.slug}`} style={{ fontFamily: "'Cinzel',serif", fontSize: '.58rem', letterSpacing: '.18em', textTransform: 'uppercase', color: 'rgba(240,234,216,.55)', textDecoration: 'none', borderBottom: '1px solid rgba(201,164,76,.25)', paddingBottom: '2px' }}>Full details &rarr;</a>
      </div>
    </div>
  );
}
