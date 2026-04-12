'use client';
import { useState } from 'react';

const PASSCODE = 'calvary2026';

const FICTION_GENRES = ['All Fiction', 'Literary Fiction', 'Romance', 'Thriller & Suspense', 'Sci-Fi & Fantasy', 'Historical', 'Short Story Collections', 'Poetry Collections'];
const NONFICTION_GENRES = ['All Non-Fiction', 'Memoir & Biography', 'Essays', 'Self-Development', 'Business & Finance', 'Politics & Society'];

const FICTION_BESTSELLERS = [
  { rank: 1, color: 'c1', title: 'The Weight of Silence', author: 'Adaeze Okonkwo', sales: '1,204 sold' },
  { rank: 2, color: 'c5', title: 'Love in the Dry Season', author: 'Chioma Okonkwo', sales: '987 sold' },
  { rank: 3, color: 'c2', title: 'Lagos at Midnight', author: 'Ikenna Okpara', sales: '843 sold' },
  { rank: 4, color: 'c4', title: 'The Last Harmattan', author: 'Ufedo Adaji', sales: '721 sold' },
  { rank: 5, color: 'c6', title: 'Fragments of Light', author: 'Calvary', sales: '614 sold' },
];

const NONFICTION_BESTSELLERS = [
  { rank: 1, color: 'c4', title: 'The African Century', author: 'Arthur Eze', sales: '932 sold' },
  { rank: 2, color: 'c7', title: 'My Own Kind of Free', author: 'Ufedo Adaji', sales: '764 sold' },
  { rank: 3, color: 'c2', title: 'Build Without Permission', author: 'Okere Josiah', sales: '612 sold' },
  { rank: 4, color: 'c5', title: 'Notes on Living Well', author: 'Calvary', sales: '489 sold' },
  { rank: 5, color: 'c3', title: 'The Quiet Revolution', author: 'Tricia Ajax', sales: '341 sold' },
];

const FICTION_BOOKS = [
  { color: 'c1', title: 'The Weight of Silence', author: 'Adaeze Okonkwo', genre: 'Literary Fiction', stars: '★★★★★', rating: '4.9 (312)', price: '£4.99', sales: '1,204 sold', badge: null, featured: true, blurb: 'A devastating portrait of a marriage unravelling in slow motion. Okonkwo writes with the precision of a surgeon and the heart of a poet.' },
  { color: 'c2', title: 'Before the Rain Came', author: 'Kalu Rebecca', genre: 'Literary Fiction', stars: '★★★★☆', rating: '4.3 (89)', price: '£3.99', sales: '214 sold', badge: 'New' },
  { color: 'c3', title: 'Lagos at Midnight', author: 'Ikenna Okpara', genre: 'Thriller', stars: '★★★★★', rating: '4.8 (204)', price: '£4.49', sales: '843 sold', badge: null },
  { color: 'c5', title: 'Love in the Dry Season', author: 'Chioma Okonkwo', genre: 'Romance', stars: '★★★★★', rating: '4.7 (176)', price: '£3.49', sales: '987 sold', badge: 'Popular' },
  { color: 'c4', title: 'The Last Harmattan', author: 'Ufedo Adaji', genre: 'Historical Fiction', stars: '★★★★☆', rating: '4.5 (143)', price: '£4.99', sales: '721 sold', badge: null },
  { color: 'c6', title: 'Fragments of Light', author: 'Calvary', genre: 'Poetry Collection', stars: '★★★★★', rating: '4.9 (98)', price: '£2.99', sales: '614 sold', badge: null },
  { color: 'c8', title: 'What the River Knows', author: 'Tricia Ajax', genre: 'Short Story Collection', stars: '★★★★☆', rating: '4.2 (41)', price: '£3.99', sales: '188 sold', badge: 'New' },
];

const NONFICTION_BOOKS = [
  { color: 'c4', title: 'The African Century', author: 'Arthur Eze', genre: 'Politics & Society', stars: '★★★★★', rating: '4.8 (247)', price: '£5.99', sales: '932 sold', badge: null, featured: true, blurb: 'A bold, unflinching examination of Africa’s place in the 21st century — what was promised, what was stolen, and what is still possible.' },
  { color: 'c7', title: 'My Own Kind of Free', author: 'Ufedo Adaji', genre: 'Memoir', stars: '★★★★★', rating: '4.7 (132)', price: '£4.49', sales: '764 sold', badge: 'New' },
  { color: 'c2', title: 'Build Without Permission', author: 'Okere Josiah', genre: 'Business', stars: '★★★★☆', rating: '4.4 (88)', price: '£5.49', sales: '612 sold', badge: 'Popular' },
  { color: 'c5', title: 'Notes on Living Well', author: 'Calvary', genre: 'Essays', stars: '★★★★★', rating: '4.9 (74)', price: '£2.99', sales: '489 sold', badge: null },
  { color: 'c3', title: 'The Quiet Revolution', author: 'Tricia Ajax', genre: 'Self-Development', stars: '★★★★☆', rating: '4.3 (56)', price: '£3.99', sales: '341 sold', badge: null },
];

const COLORS = {
  c1: 'linear-gradient(148deg,#1a0a2e 0%,#0e0618 100%)',
  c2: 'linear-gradient(148deg,#0e1a2e 0%,#060e1a 100%)',
  c3: 'linear-gradient(148deg,#1a120a 0%,#0e0806 100%)',
  c4: 'linear-gradient(148deg,#0a1a12 0%,#060e08 100%)',
  c5: 'linear-gradient(148deg,#1a0a14 0%,#0e0608 100%)',
  c6: 'linear-gradient(148deg,#141418 0%,#08080e 100%)',
  c7: 'linear-gradient(148deg,#1a1a08 0%,#0e0e06 100%)',
  c8: 'linear-gradient(148deg,#0e0a1a 0%,#08060e 100%)',
};

function Cover({ color, title, author, size }) {
  const isMini = size === 'mini';
  const isFeatured = size === 'featured';
  return (
    <div style={{
      width: isFeatured ? '150px' : isMini ? '36px' : '100%',
      height: isMini ? '54px' : undefined,
      aspectRatio: isMini ? undefined : '2/3',
      background: COLORS[color] || COLORS.c1,
      borderRadius: '2px 4px 4px 2px',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: isMini ? 0 : '1.25rem 0.9rem', textAlign: 'center',
      boxShadow: isFeatured ? '8px 12px 40px rgba(0,0,0,.85),0 0 0 1px rgba(201,164,76,.12),inset -4px 0 10px rgba(0,0,0,.4)' : isMini ? '2px 3px 10px rgba(0,0,0,.6)' : '4px 6px 24px rgba(0,0,0,.75),0 0 0 1px rgba(255,255,255,.03),inset -3px 0 6px rgba(0,0,0,.35)',
      position: 'relative', overflow: 'hidden', flexShrink: 0,
    }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '6px', background: 'rgba(0,0,0,.4)', borderRadius: '2px 0 0 2px' }} />
      {!isMini && (
        <>
          <div style={{ fontSize: isFeatured ? '.82rem' : '.78rem', fontWeight: 600, color: 'rgba(255,255,255,.85)', lineHeight: 1.25, marginBottom: '.4rem', position: 'relative', zIndex: 1, fontFamily: "'Cormorant Garamond',serif" }}>{title}</div>
          <div style={{ fontFamily: "'Inter',sans-serif", fontSize: '.56rem', letterSpacing: '.06em', color: 'rgba(255,255,255,.4)', fontStyle: 'italic', position: 'relative', zIndex: 1 }}>{author}</div>
        </>
      )}
    </div>
  );
}

function BestsellersStrip({ items, label }) {
  return (
    <div style={{ background: 'rgba(201,164,76,.04)', border: '1px solid rgba(201,164,76,.12)', padding: '1.5rem 2rem', marginBottom: '3rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
        <div style={{ fontFamily: "'Cinzel',serif", fontSize: '.6rem', letterSpacing: '.28em', textTransform: 'uppercase', color: '#c9a44c' }}>{label}</div>
        <a href="#" style={{ fontFamily: "'Inter',sans-serif", fontSize: '.62rem', color: 'rgba(240,234,216,.45)', textDecoration: 'none' }}>View all →</a>
      </div>
      <div style={{ display: 'flex', gap: '1.5rem', overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: '.25rem' }}>
        {items.map(b => (
          <div key={b.rank} style={{ display: 'flex', alignItems: 'center', gap: '.75rem', flexShrink: 0, minWidth: '200px' }}>
            <div style={{ fontFamily: "'Cinzel',serif", fontSize: '1.1rem', color: 'rgba(201,164,76,.35)', fontWeight: 600, width: '24px', textAlign: 'right' }}>{b.rank}</div>
            <Cover color={b.color} title="" author="" size="mini" />
            <div>
              <div style={{ fontSize: '.78rem', fontWeight: 600, color: '#f0ead8', lineHeight: 1.2, marginBottom: '2px' }}>{b.title}</div>
              <div style={{ fontFamily: "'Inter',sans-serif", fontSize: '.6rem', color: 'rgba(240,234,216,.45)' }}>{b.author}</div>
              <div style={{ fontFamily: "'Inter',sans-serif", fontSize: '.58rem', color: '#c9a44c', marginTop: '2px' }}>{b.sales}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Featured({ book, eyebrow }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '3rem', alignItems: 'center', padding: '2.5rem', marginBottom: '3.5rem', background: 'rgba(201,164,76,.03)', border: '1px solid rgba(201,164,76,.1)', position: 'relative' }}>
      <div style={{ position: 'absolute', top: '1.2rem', right: '1.5rem', fontFamily: "'Cinzel',serif", fontSize: '.52rem', letterSpacing: '.28em', color: 'rgba(201,164,76,.4)' }}>FEATURED</div>
      <Cover color={book.color} title={book.title} author={book.author} size="featured" />
      <div>
        <div style={{ fontFamily: "'Cinzel',serif", fontSize: '.56rem', letterSpacing: '.22em', textTransform: 'uppercase', color: '#c9a44c', marginBottom: '.6rem' }}>{eyebrow}</div>
        <h2 style={{ fontSize: 'clamp(1.5rem,3vw,2.2rem)', fontWeight: 300, fontStyle: 'italic', color: '#f0ead8', lineHeight: 1.15, marginBottom: '.4rem' }}>{book.title}</h2>
        <p style={{ fontFamily: "'Inter',sans-serif", fontSize: '.75rem', color: 'rgba(240,234,216,.45)', marginBottom: '.75rem' }}>{book.author}</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <span style={{ color: '#c9a44c', fontSize: '.75rem' }}>{book.stars}</span>
          <span style={{ fontFamily: "'Inter',sans-serif", fontSize: '.62rem', color: 'rgba(240,234,216,.45)' }}>{book.rating}</span>
          <span style={{ color: 'rgba(240,234,216,.2)' }}>·</span>
          <span style={{ fontFamily: "'Inter',sans-serif", fontSize: '.62rem', color: 'rgba(240,234,216,.45)' }}>{book.sales}</span>
        </div>
        <p style={{ fontSize: '.92rem', lineHeight: 1.75, color: 'rgba(240,234,216,.6)', maxWidth: '400px', marginBottom: '1.5rem', fontStyle: 'italic' }}>{book.blurb}</p>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <button style={{ padding: '.65rem 1.75rem', background: '#c9a44c', color: '#0a0a0a', fontFamily: "'Cinzel',serif", fontSize: '.62rem', letterSpacing: '.18em', textTransform: 'uppercase', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Buy · {book.price}</button>
          <button style={{ padding: '.65rem 1.5rem', border: '1px solid rgba(201,164,76,.28)', color: '#c9a44c', fontFamily: "'Cinzel',serif", fontSize: '.62rem', letterSpacing: '.18em', textTransform: 'uppercase', background: 'none', cursor: 'pointer' }}>Read Preview</button>
        </div>
      </div>
    </div>
  );
}

function BookCard({ book }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', cursor: 'pointer' }}>
      <div style={{ position: 'relative', marginBottom: '1rem' }}>
        <Cover color={book.color} title={book.title} author={book.author} size="card" />
        {book.badge && (
          <div style={{ position: 'absolute', top: '7px', right: '7px', background: book.badge === 'Popular' ? '#6b2fad' : '#c9a44c', color: book.badge === 'Popular' ? 'white' : '#0a0a0a', fontFamily: "'Inter',sans-serif", fontSize: '.5rem', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', padding: '.18em .5em', borderRadius: '2px' }}>{book.badge}</div>
        )}
      </div>
      <div style={{ fontFamily: "'Inter',sans-serif", fontSize: '.56rem', letterSpacing: '.18em', textTransform: 'uppercase', color: '#c9a44c', marginBottom: '.25rem' }}>{book.genre}</div>
      <div style={{ fontSize: '.88rem', fontWeight: 600, color: '#f0ead8', lineHeight: 1.3, marginBottom: '.15rem' }}>{book.title}</div>
      <div style={{ fontFamily: "'Inter',sans-serif", fontSize: '.68rem', fontStyle: 'italic', color: 'rgba(240,234,216,.45)', marginBottom: '.45rem' }}>{book.author}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.3rem', marginBottom: '.4rem' }}>
        <span style={{ color: '#c9a44c', fontSize: '.62rem' }}>{book.stars}</span>
        <span style={{ fontFamily: "'Inter',sans-serif", fontSize: '.58rem', color: 'rgba(240,234,216,.45)' }}>{book.rating}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontFamily: "'Inter',sans-serif", fontSize: '.78rem', fontWeight: 600, color: '#f0ead8' }}>{book.price}</div>
        <div style={{ fontFamily: "'Inter',sans-serif", fontSize: '.58rem', color: 'rgba(240,234,216,.45)' }}>{book.sales}</div>
      </div>
    </div>
  );
}

function PasscodeGate({ onUnlock }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (code === PASSCODE) { onUnlock(); }
    else { setError(true); setCode(''); }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#060608', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Cormorant Garamond',Georgia,serif" }}>
      <style>{"@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=Cinzel:wght@400;600&display=swap');"}</style>
      <div style={{ textAlign: 'center', padding: '2rem', maxWidth: '340px', width: '100%' }}>
        <div style={{ fontFamily: "'Cinzel',serif", fontSize: '.55rem', letterSpacing: '.35em', color: 'rgba(201,164,76,.6)', textTransform: 'uppercase', marginBottom: '1.5rem' }}>Calvary Scribblings</div>
        <div style={{ fontSize: '2rem', fontWeight: 300, fontStyle: 'italic', color: '#f0ead8', marginBottom: '.4rem' }}>The Book Store</div>
        <div style={{ fontSize: '.85rem', fontStyle: 'italic', color: 'rgba(240,234,216,.35)', marginBottom: '2.5rem' }}>Coming soon</div>
        <form onSubmit={handleSubmit}>
          <input
            type="password" placeholder="Enter passcode" value={code} autoComplete="off"
            onChange={e => { setCode(e.target.value); setError(false); }}
            style={{ width: '100%', padding: '.85rem 1.2rem', background: 'rgba(255,255,255,.04)', border: `1px solid ${error ? 'rgba(200,50,50,.6)' : 'rgba(201,164,76,.2)'}`, color: '#f0ead8', fontFamily: "'Cormorant Garamond',serif", fontSize: '1.1rem', letterSpacing: '.2em', textAlign: 'center', outline: 'none' }}
          />
          {error && <div style={{ color: 'rgba(200,80,80,.8)', fontFamily: "'Cinzel',serif", fontSize: '.55rem', letterSpacing: '.15em', marginTop: '.5rem' }}>Incorrect passcode</div>}
          <button type="submit" style={{ width: '100%', padding: '.85rem', background: 'rgba(201,164,76,.12)', border: '1px solid rgba(201,164,76,.3)', color: '#c9a44c', fontFamily: "'Cinzel',serif", fontSize: '.62rem', letterSpacing: '.25em', textTransform: 'uppercase', cursor: 'pointer', marginTop: '.75rem' }}>Enter</button>
        </form>
      </div>
    </div>
  );
}

export default function BookStorePage() {
  const [unlocked, setUnlocked] = useState(false);
  const [fictionGenre, setFictionGenre] = useState(0);
  const [nonfictionGenre, setNonfictionGenre] = useState(0);

  if (!unlocked) return <PasscodeGate onUnlock={() => setUnlocked(true)} />;

  const featuredFiction = FICTION_BOOKS.find(b => b.featured);
  const featuredNonfiction = NONFICTION_BOOKS.find(b => b.featured);
  const fictionShelf = FICTION_BOOKS.filter(b => !b.featured);
  const nonfictionShelf = NONFICTION_BOOKS.filter(b => !b.featured);

  const divider = (label) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', marginBottom: '2.5rem' }}>
      <div style={{ flex: 1, height: '1px', background: 'rgba(201,164,76,.12)' }} />
      <div style={{ fontFamily: "'Cinzel',serif", fontSize: '.58rem', letterSpacing: '.3em', textTransform: 'uppercase', color: '#c9a44c' }}>{label}</div>
      <div style={{ flex: 1, height: '1px', background: 'rgba(201,164,76,.12)' }} />
    </div>
  );

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;0,700;1,300;1,400;1,600&family=Cinzel:wght@400;600&family=Inter:wght@300;400;500;600&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        html{scroll-behavior:smooth}
        body{background:#0a0a0a;color:#f0ead8;font-family:'Cormorant Garamond',Georgia,serif;overflow-x:hidden}
        @keyframes bob{0%,100%{transform:translateX(-50%) translateY(0)}50%{transform:translateX(-50%) translateY(7px)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
        .door{display:flex;flex-direction:column;align-items:center;gap:.4rem;padding:1.25rem 2.75rem;border:1px solid rgba(201,164,76,.22);background:rgba(201,164,76,.03);text-decoration:none;color:#f0ead8;transition:all .3s;cursor:pointer;position:relative;overflow:hidden}
        .door::before{content:'';position:absolute;inset:0;background:rgba(201,164,76,.06);transform:translateY(101%);transition:transform .3s}
        .door:hover::before{transform:translateY(0)}
        .door:hover{border-color:rgba(201,164,76,.45)}
        .genre-tabs{display:flex;overflow-x:auto;margin-bottom:3rem;scrollbar-width:none;border-bottom:1px solid rgba(255,255,255,.06)}
        .genre-tabs::-webkit-scrollbar{display:none}
        .genre-tab{padding:.7rem 1.3rem;white-space:nowrap;font-family:'Inter',sans-serif;font-size:.68rem;letter-spacing:.12em;text-transform:uppercase;color:rgba(240,234,216,.45);cursor:pointer;border:none;background:none;border-bottom:2px solid transparent;margin-bottom:-1px;transition:all .2s}
        .genre-tab:hover{color:#f0ead8}
        .genre-tab.active{color:#c9a44c;border-bottom-color:#c9a44c}
        .shelf{display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:2.5rem 1.5rem}
        @media(max-width:640px){
          .shelf{grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:2rem 1rem}
          .hero-doors{flex-direction:column;align-items:center}
          .door{width:100%;max-width:260px}
          .featured-inner{grid-template-columns:1fr !important}
        }
      `}</style>

      <nav style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.1rem 2.5rem', background: 'rgba(6,6,8,.95)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(201,164,76,.1)' }}>
        <a href="/" style={{ fontFamily: "'Cochin',Georgia,serif", fontSize: '1rem', fontWeight: 600, color: '#f0ead8', textDecoration: 'none' }}>Calvary <span style={{ color: '#6b2fad' }}>Scribblings</span></a>
        <div style={{ display: 'flex', gap: '2rem' }}>
          {[['Stories', '/'],['Book Store', '/bookstore'],['The Square', '/square']].map(([label, href]) => (
            <a key={label} href={href} style={{ fontFamily: "'Inter',sans-serif", fontSize: '.68rem', letterSpacing: '.16em', textTransform: 'uppercase', color: label === 'Book Store' ? '#c9a44c' : 'rgba(240,234,216,.45)', textDecoration: 'none' }}>{label}</a>
          ))}
        </div>
      </nav>

      <section style={{ height: '100vh', minHeight: '620px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden', textAlign: 'center' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 80% 55% at 50% 38%,rgba(107,47,173,.2) 0%,transparent 68%),linear-gradient(180deg,#060608 0%,#0d0810 50%,#060608 100%)' }} />
        <div style={{ position: 'relative', zIndex: 2, padding: '2rem', maxWidth: '680px', animation: 'fadeUp .8s ease forwards' }}>
          <div style={{ fontFamily: "'Cinzel',serif", fontSize: '.6rem', letterSpacing: '.35em', textTransform: 'uppercase', color: '#c9a44c', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem', justifyContent: 'center' }}>
            <span style={{ height: '1px', width: '36px', background: 'linear-gradient(90deg,transparent,#c9a44c)', display: 'block' }} />
            Calvary Scribblings
            <span style={{ height: '1px', width: '36px', background: 'linear-gradient(90deg,#c9a44c,transparent)', display: 'block' }} />
          </div>
          <h1 style={{ fontSize: 'clamp(3.8rem,9vw,7.5rem)', fontWeight: 300, lineHeight: .92, color: '#f0ead8', marginBottom: '1.5rem' }}>The<br /><em style={{ fontStyle: 'italic', color: '#c9a44c' }}>Book Store</em></h1>
          <p style={{ fontSize: '1.05rem', fontStyle: 'italic', color: 'rgba(240,234,216,.45)', margin: '0 auto 3rem', lineHeight: 1.7 }}>Worlds waiting to be entered. Stories that stay with you long after the last page.</p>
          <div className="hero-doors" style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href="#fiction" className="door">
              <span style={{ fontFamily: "'Cinzel',serif", fontSize: '.55rem', letterSpacing: '.25em', textTransform: 'uppercase', color: '#c9a44c', position: 'relative' }}>Explore</span>
              <span style={{ fontSize: '1.55rem', fontWeight: 300, fontStyle: 'italic', position: 'relative' }}>Fiction</span>
              <span style={{ fontFamily: "'Inter',sans-serif", fontSize: '.65rem', color: 'rgba(240,234,216,.45)', position: 'relative' }}>6 genres · 24 titles</span>
            </a>
            <a href="#nonfiction" className="door">
              <span style={{ fontFamily: "'Cinzel',serif", fontSize: '.55rem', letterSpacing: '.25em', textTransform: 'uppercase', color: '#c9a44c', position: 'relative' }}>Explore</span>
              <span style={{ fontSize: '1.55rem', fontWeight: 300, fontStyle: 'italic', position: 'relative' }}>Non-Fiction</span>
              <span style={{ fontFamily: "'Inter',sans-serif", fontSize: '.65rem', color: 'rgba(240,234,216,.45)', position: 'relative' }}>5 genres · 18 titles</span>
            </a>
          </div>
        </div>
        <div style={{ position: 'absolute', bottom: '2.5rem', left: '50%', transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.5rem', color: 'rgba(240,234,216,.45)', fontFamily: "'Inter',sans-serif", fontSize: '.58rem', letterSpacing: '.22em', textTransform: 'uppercase', animation: 'bob 2.2s ease-in-out infinite' }}>
          <div style={{ width: '1px', height: '30px', background: 'linear-gradient(to bottom,#c9a44c,transparent)' }} />
          Browse
        </div>
      </section>

      <section style={{ padding: '5rem 2.5rem 4rem' }} id="fiction">
        {divider('Fiction')}
        <BestsellersStrip items={FICTION_BESTSELLERS} label="Fiction Bestsellers" />
        <div className="genre-tabs">
          {FICTION_GENRES.map((g, i) => <button key={g} className={`genre-tab${fictionGenre===i?' active':''}`} onClick={() => setFictionGenre(i)}>{g}</button>)}
        </div>
        <Featured book={featuredFiction} eyebrow="Literary Fiction · Editor's Pick" />
        <div className="shelf">
          {fictionShelf.map(b => <BookCard key={b.title} book={b} />)}
        </div>
      </section>

      <section style={{ padding: '2rem 2.5rem 6rem' }} id="nonfiction">
        {divider('Non-Fiction')}
        <BestsellersStrip items={NONFICTION_BESTSELLERS} label="Non-Fiction Bestsellers" />
        <div className="genre-tabs">
          {NONFICTION_GENRES.map((g, i) => <button key={g} className={`genre-tab${nonfictionGenre===i?' active':''}`} onClick={() => setNonfictionGenre(i)}>{g}</button>)}
        </div>
        <Featured book={featuredNonfiction} eyebrow="Politics & Society · Staff Pick" />
        <div className="shelf">
          {nonfictionShelf.map(b => <BookCard key={b.title} book={b} />)}
        </div>
      </section>
    </>
  );
}