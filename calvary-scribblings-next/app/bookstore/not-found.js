'use client';
import Navbar from '../components/Navbar';

export default function BookstoreNotFound() {
  return (
    <>
      <Navbar />
      <main style={{
        minHeight: '100vh',
        background: '#faf6ee',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '6rem 1.5rem 4rem',
        textAlign: 'center',
        fontFamily: "'Cochin', Georgia, serif",
      }}>
        <div style={{
          fontSize: 'clamp(4rem, 12vw, 7rem)',
          fontWeight: 300,
          color: '#7c3aed',
          lineHeight: 1,
          marginBottom: '1rem',
          letterSpacing: '-0.02em',
        }}>404</div>
        <p style={{
          fontSize: '1.1rem',
          fontStyle: 'italic',
          color: 'rgba(10,10,10,0.7)',
          maxWidth: '420px',
          lineHeight: 1.6,
          margin: '0 0 2rem',
        }}>This page doesn&rsquo;t exist yet.</p>
        <a href="/" style={{
          display: 'inline-block',
          padding: '0.75rem 1.75rem',
          background: '#7c3aed',
          color: '#fff',
          textDecoration: 'none',
          borderRadius: 6,
          fontSize: '0.85rem',
          fontWeight: 600,
          letterSpacing: '0.02em',
          fontFamily: 'inherit',
          boxShadow: '0 4px 16px rgba(124,58,237,0.25)',
        }}>Back to home</a>
      </main>
    </>
  );
}
