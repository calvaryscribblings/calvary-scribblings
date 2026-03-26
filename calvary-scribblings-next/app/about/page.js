import Navbar from '../components/Navbar';

export default function AboutPage() {
  return (
    <div style={{ background: '#0a0a0a', minHeight: '100vh', color: '#fff', fontFamily: 'Cochin, Georgia, serif' }}>
      <Navbar />
      <section style={{ paddingTop: '8rem', paddingBottom: '6rem', paddingLeft: '4%', paddingRight: '4%', maxWidth: 780, margin: '0 auto' }}>
        <div style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#a78bfa', marginBottom: '1.5rem' }}>About Us</div>
        <h1 style={{ fontSize: 'clamp(2.2rem, 5vw, 3.5rem)', fontWeight: 300, lineHeight: 1.15, marginBottom: '2rem', fontFamily: 'Cormorant Garamond, Cochin, Georgia, serif' }}>
          A Calvary Media UK Publication
        </h1>
        <div style={{ fontSize: '1.15rem', lineHeight: 1.85, color: 'rgba(255,255,255,0.75)', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <p>Calvary Scribblings is a literary publication platform built for readers and writers who believe in the power of storytelling. We publish flash fiction, short stories, poetry, news, and inspiring narratives — stories that move, provoke, and illuminate.</p>
          <p>We are a Calvary Media UK publication, committed to the art of storytelling in all its forms. Our stories come from every corner of the world — from Lagos to London, from New York to Nairobi — because great stories know no borders.</p>
          <p>Our contributors are writers united by a love of craft and a belief that every story, wherever it comes from, deserves to be told well.</p>
        </div>
      </section>
    </div>
  );
}
