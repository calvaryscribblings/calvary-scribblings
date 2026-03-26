import Navbar from '../components/Navbar';

export default function ContactPage() {
  return (
    <div style={{ background: '#0a0a0a', minHeight: '100vh', color: '#fff', fontFamily: 'Cochin, Georgia, serif' }}>
      <Navbar />
      <section style={{ paddingTop: '8rem', paddingBottom: '6rem', paddingLeft: '4%', paddingRight: '4%', maxWidth: 780, margin: '0 auto' }}>
        <div style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#a78bfa', marginBottom: '1.5rem' }}>Get in Touch</div>
        <h1 style={{ fontSize: 'clamp(2.2rem, 5vw, 3.5rem)', fontWeight: 300, lineHeight: 1.15, marginBottom: '2rem', fontFamily: 'Cormorant Garamond, Cochin, Georgia, serif' }}>
          Contact Us
        </h1>
        <div style={{ fontSize: '1.15rem', lineHeight: 1.85, color: 'rgba(255,255,255,0.75)', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <p>We'd love to hear from you — whether you're a reader, a writer, or a collaborator.</p>
          <p>For submissions, editorial enquiries, or general correspondence, reach us at:</p>
          <a href="mailto:hello@calvaryscribblings.co.uk" style={{ color: '#a78bfa', fontSize: '1.2rem', fontWeight: 600, textDecoration: 'none' }}>
            hello@calvaryscribblings.co.uk
          </a>
          <p style={{ fontSize: '0.95rem', color: 'rgba(255,255,255,0.45)' }}>We aim to respond within 48 hours.</p>
        </div>
      </section>
    </div>
  );
}
