import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

const S = {
  page: { background: '#0a0a0a', minHeight: '100vh', color: '#fff', fontFamily: 'Cochin, Georgia, serif' },
  section: { paddingTop: '8rem', paddingBottom: '6rem', paddingLeft: '4%', paddingRight: '4%', maxWidth: 780, margin: '0 auto' },
  eyebrow: { fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#a78bfa', marginBottom: '1.5rem' },
  h1: { fontSize: 'clamp(2.2rem, 5vw, 3.5rem)', fontWeight: 300, lineHeight: 1.15, marginBottom: '1rem', fontFamily: 'Cormorant Garamond, Cochin, Georgia, serif' },
  updated: { fontSize: '0.95rem', color: 'rgba(255,255,255,0.45)', marginBottom: '2.5rem', letterSpacing: '0.02em' },
  hr: { border: 0, borderTop: '1px solid rgba(255,255,255,0.1)', margin: '2.5rem 0' },
  h2: { fontSize: 'clamp(1.4rem, 3vw, 1.85rem)', fontWeight: 400, lineHeight: 1.25, marginTop: '3rem', marginBottom: '1.25rem', color: '#fff', fontFamily: 'Cormorant Garamond, Cochin, Georgia, serif' },
  p: { fontSize: '1.08rem', lineHeight: 1.85, color: 'rgba(255,255,255,0.75)', marginBottom: '1.25rem' },
  ul: { fontSize: '1.08rem', lineHeight: 1.85, color: 'rgba(255,255,255,0.75)', margin: '0 0 1.25rem', paddingLeft: '1.4rem', display: 'flex', flexDirection: 'column', gap: '0.65rem' },
  li: { paddingLeft: '0.35rem' },
  link: { color: '#a78bfa', textDecoration: 'none' },
  strong: { color: 'rgba(255,255,255,0.92)', fontWeight: 700 },
};

export default function TermsPage() {
  return (
    <div style={S.page}>
      <Navbar />
      <section style={S.section}>
        <div style={S.eyebrow}>Legal</div>
        <h1 style={S.h1}>Terms of Service</h1>
        <p style={S.updated}><strong style={S.strong}>Last updated: 23 June 2026</strong></p>

        <p style={S.p}>
          These Terms of Service ("Terms") govern your use of the <strong style={S.strong}>Story Island</strong> mobile app and related services (the "Service"), provided by <strong style={S.strong}>Calvary Media UK Ltd</strong> ("Calvary", "we", "us"), a company registered in England and Wales (company number 17034179) with its registered office at 1 Grenard Close, Middleton House, London. By creating an account or using the Service, you agree to these Terms and to our <a href="https://calvaryscribblings.co.uk/privacy" style={S.link}>Privacy Policy</a>.
        </p>
        <p style={S.p}>
          <strong style={S.strong}>Contact:</strong> <a href="mailto:contact@calvaryscribblings.co.uk" style={S.link}>contact@calvaryscribblings.co.uk</a>
        </p>

        <hr style={S.hr} />

        <h2 style={S.h2}>1. Eligibility</h2>
        <p style={S.p}>
          You must be <strong style={S.strong}>18 years of age or older</strong> to create an account and use the Service. By using Story Island you confirm that you are at least 18.
        </p>

        <h2 style={S.h2}>2. Your account</h2>
        <ul style={S.ul}>
          <li style={S.li}>You are responsible for keeping your login credentials secure and for all activity under your account.</li>
          <li style={S.li}>You agree to provide accurate information (including a date of birth that confirms you are 18+) and to keep it up to date.</li>
          <li style={S.li}>You may sign in using email and password, Sign in with Apple, or Google Sign-In.</li>
        </ul>

        <h2 style={S.h2}>3. User content</h2>
        <p style={S.p}>
          "User content" means anything you post or share through the Service — including Square posts, comments and replies, direct messages, images you upload, your profile details, and reactions.
        </p>
        <ul style={S.ul}>
          <li style={S.li}><strong style={S.strong}>You own your content.</strong> You retain ownership of the user content you create.</li>
          <li style={S.li}><strong style={S.strong}>Licence to us.</strong> You grant Calvary a non-exclusive, worldwide, royalty-free licence to host, store, reproduce, display, and distribute your user content solely to operate and provide the Service (for example, showing your posts and messages to their intended audience).</li>
          <li style={S.li}><strong style={S.strong}>Your responsibility.</strong> You are solely responsible for your user content and confirm you have the rights necessary to share it.</li>
        </ul>

        <h2 style={S.h2}>4. Acceptable use</h2>
        <p style={S.p}>You agree <strong style={S.strong}>not</strong> to use the Service to:</p>
        <ul style={S.ul}>
          <li style={S.li}>post or share content that is unlawful, harassing, abusive, hateful, threatening, defamatory, obscene, or otherwise objectionable;</li>
          <li style={S.li}>bully, harass, intimidate, or impersonate any person;</li>
          <li style={S.li}>post sexual content involving minors, or any content that exploits or endangers children;</li>
          <li style={S.li}>infringe anyone's intellectual property or privacy rights;</li>
          <li style={S.li}>send spam, scams, or unsolicited promotional material;</li>
          <li style={S.li}>attempt to access accounts, data, or systems without authorisation, or interfere with the operation or security of the Service.</li>
        </ul>
        <p style={S.p}>We operate a <strong style={S.strong}>zero-tolerance policy for objectionable content and abusive behaviour.</strong></p>

        <h2 style={S.h2}>5. Reporting, blocking, and moderation</h2>
        <ul style={S.ul}>
          <li style={S.li}>You can <strong style={S.strong}>report</strong> content and users, and <strong style={S.strong}>block</strong> users, from within the app.</li>
          <li style={S.li}>We review reports and may remove content or restrict or terminate accounts that violate these Terms.</li>
          <li style={S.li}>We aim to act on reports of objectionable content promptly. We may remove content and suspend or remove offending users at our discretion.</li>
          <li style={S.li}>We use automated tools, including third-party AI services (Anthropic's Claude), to help moderate submitted content and to score quizzes. See our <a href="https://calvaryscribblings.co.uk/privacy" style={S.link}>Privacy Policy</a> for details.</li>
        </ul>

        <h2 style={S.h2}>6. Termination and account deletion</h2>
        <ul style={S.ul}>
          <li style={S.li}>You may delete your account at any time from <strong style={S.strong}>Settings → Delete account</strong>.</li>
          <li style={S.li}>We may suspend or terminate your access if you breach these Terms or to protect the Service or other users.</li>
        </ul>

        <h2 style={S.h2}>7. Intellectual property</h2>
        <p style={S.p}>
          The Service, including the stories, software, design, and branding made available by Calvary (excluding your user content), is owned by Calvary or its licensors and is protected by intellectual property laws. You may not copy, modify, distribute, or create derivative works from it except as permitted by these Terms or applicable law.
        </p>

        <h2 style={S.h2}>8. Disclaimers</h2>
        <p style={S.p}>
          The Service is provided "as is" and "as available". To the fullest extent permitted by law, we disclaim all warranties, express or implied, regarding the Service, including its availability, accuracy, or fitness for a particular purpose. User content reflects the views of the users who create it, not Calvary.
        </p>

        <h2 style={S.h2}>9. Limitation of liability</h2>
        <p style={S.p}>
          To the fullest extent permitted by law, Calvary will not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of data, profits, or goodwill, arising out of your use of the Service. Nothing in these Terms excludes or limits liability that cannot be excluded or limited under applicable law.
        </p>

        <h2 style={S.h2}>10. Governing law</h2>
        <p style={S.p}>
          These Terms are governed by the laws of <strong style={S.strong}>England and Wales</strong>, and the courts of England and Wales will have jurisdiction, except where mandatory consumer protection law provides otherwise.
        </p>

        <h2 style={S.h2}>11. Changes to these Terms</h2>
        <p style={S.p}>
          We may update these Terms from time to time. We will update the "Last updated" date above and, where appropriate, notify you in the app. Continued use of the Service after changes take effect constitutes acceptance of the updated Terms.
        </p>

        <h2 style={S.h2}>12. Contact us</h2>
        <p style={S.p}><strong style={S.strong}>Calvary Media UK Ltd</strong> (company number 17034179)</p>
        <p style={S.p}>1 Grenard Close, Middleton House, London</p>
        <p style={S.p}>Email: <a href="mailto:contact@calvaryscribblings.co.uk" style={S.link}>contact@calvaryscribblings.co.uk</a></p>
      </section>
      <Footer />
    </div>
  );
}
