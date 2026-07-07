import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

const S = {
  page: { background: '#0a0a0a', minHeight: '100vh', color: '#fff', fontFamily: 'Cormorant Garamond, Georgia, serif' },
  section: { paddingTop: '8rem', paddingBottom: '6rem', paddingLeft: '4%', paddingRight: '4%', maxWidth: 780, margin: '0 auto' },
  eyebrow: { fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#a78bfa', marginBottom: '1.5rem' },
  h1: { fontSize: 'clamp(2.2rem, 5vw, 3.5rem)', fontWeight: 300, lineHeight: 1.15, marginBottom: '1rem', fontFamily: 'Cormorant Garamond, Georgia, serif' },
  updated: { fontSize: '0.95rem', color: 'rgba(255,255,255,0.45)', marginBottom: '2.5rem', letterSpacing: '0.02em' },
  hr: { border: 0, borderTop: '1px solid rgba(255,255,255,0.1)', margin: '2.5rem 0' },
  h2: { fontSize: 'clamp(1.4rem, 3vw, 1.85rem)', fontWeight: 400, lineHeight: 1.25, marginTop: '3rem', marginBottom: '1.25rem', color: '#fff', fontFamily: 'Cormorant Garamond, Georgia, serif' },
  p: { fontSize: '1.08rem', lineHeight: 1.85, color: 'rgba(255,255,255,0.75)', marginBottom: '1.25rem' },
  link: { color: '#a78bfa', textDecoration: 'none' },
  strong: { color: 'rgba(255,255,255,0.92)', fontWeight: 700 },
};

export default function DeleteAccountPage() {
  return (
    <div style={S.page}>
      <Navbar />
      <section style={S.section}>
        <div style={S.eyebrow}>Account</div>
        <h1 style={S.h1}>Deleting Your Account</h1>
        <p style={S.updated}>How to delete your Story Island account and associated data.</p>

        <hr style={S.hr} />

        <h2 style={S.h2}>Delete in the app</h2>
        <p style={S.p}>
          Open Story Island → <strong style={S.strong}>Settings → Delete account</strong>. This permanently removes your profile and associated personal data from our active systems.
        </p>

        <h2 style={S.h2}>Request by email</h2>
        <p style={S.p}>
          If you can't access the app, email <a href="mailto:contact@calvaryscribblings.co.uk" style={S.link}>contact@calvaryscribblings.co.uk</a> from your registered email address and we will process your deletion request.
        </p>

        <h2 style={S.h2}>What gets deleted</h2>
        <p style={S.p}>
          Your profile, posts, comments, direct messages, reactions, and reading activity are removed from our active systems. Some information may be retained for a limited period where necessary to comply with legal obligations or for safety purposes (for example, records of abuse reports), consistent with our <a href="/privacy" style={S.link}>Privacy Policy</a>.
        </p>
      </section>
      <Footer />
    </div>
  );
}
