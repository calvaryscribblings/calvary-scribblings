'use client';
import Navbar from '../components/Navbar';
import TabBar from '../components/TabBar';

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
        fontFamily: "Cormorant Garamond, Georgia, serif",
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

      {/* This, not the storefront, is what /bookstore serves until the launch gate opens
          (page.js calls notFound() while gateState === 'empty'). It renders the platform
          Navbar and so carried the desktop tab row; the bar gives the mobile visitor the
          same five. No surface variant needed — the bar carries its own ground now, which is
          why it holds on this page's light canvas as well as it does on the night ones.

          No explicit `active` here, unlike the storefront and the title page. Every route that
          renders this file is under /bookstore — page.js calls notFound() for the empty gate,
          and a bad slug lands here too — so activeTabFor's pathname read already lights Book
          Store, and there is no second component this file could be reached as. */}
      <TabBar />
    </>
  );
}
