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

export default function PrivacyPage() {
  return (
    <div style={S.page}>
      <Navbar />
      <section style={S.section}>
        <div style={S.eyebrow}>Legal</div>
        <h1 style={S.h1}>Privacy Policy</h1>
        <p style={S.updated}><strong style={S.strong}>Last updated: 23 June 2026</strong></p>

        <p style={S.p}>
          This Privacy Policy explains how <strong style={S.strong}>Calvary Media UK Ltd</strong> ("Calvary", "we", "us") collects, uses, and protects your personal data when you use the <strong style={S.strong}>Story Island</strong> mobile app and related services (the "Service").
        </p>
        <p style={S.p}>
          Calvary Media UK Ltd (company number 17034179) is the data controller for the purposes of UK data protection law (UK GDPR and the Data Protection Act 2018), with its registered office at 1 Grenard Close, Middleton House, London.
        </p>
        <p style={S.p}>
          <strong style={S.strong}>Contact:</strong> <a href="mailto:contact@calvaryscribblings.co.uk" style={S.link}>contact@calvaryscribblings.co.uk</a>
        </p>

        <hr style={S.hr} />

        <h2 style={S.h2}>1. Who can use Story Island</h2>
        <p style={S.p}>
          Story Island is intended for <strong style={S.strong}>adults aged 18 and over</strong>. We ask for your date of birth when you create an account with email and password, and you must confirm you are 18 or older. The Service is not directed to children, and we do not knowingly collect personal data from anyone under 18. If you believe a child has provided us with personal data, please contact us and we will delete it.
        </p>

        <h2 style={S.h2}>2. Information we collect</h2>
        <p style={S.p}><strong style={S.strong}>a. Information you provide when you create and use an account</strong></p>
        <ul style={S.ul}>
          <li style={S.li}><strong style={S.strong}>Account &amp; authentication:</strong> your email address, and a password (passwords are handled and stored in hashed form by our authentication provider, Google Firebase — we never see your plain-text password). If you sign in with Apple or Google, we receive the basic account identifiers those providers return (such as a user identifier and, where you permit it, your email and name).</li>
          <li style={S.li}><strong style={S.strong}>Date of birth:</strong> collected at email sign-up to confirm you are 18 or older.</li>
          <li style={S.li}><strong style={S.strong}>Profile:</strong> your display name, username/handle, profile picture (avatar), header image, and any biography text you add.</li>
        </ul>
        <p style={S.p}><strong style={S.strong}>b. Content you create ("user-generated content")</strong></p>
        <ul style={S.ul}>
          <li style={S.li}>Posts you publish on the Square, comments and replies on stories, direct messages (including any images you send in messages), reactions, and any reports or block actions you make.</li>
        </ul>
        <p style={S.p}><strong style={S.strong}>c. Reading and activity data</strong></p>
        <ul style={S.ul}>
          <li style={S.li}>Stories you read, your reading counts and progress, and bookmarks you save.</li>
        </ul>
        <p style={S.p}><strong style={S.strong}>d. Photos you choose to upload</strong></p>
        <ul style={S.ul}>
          <li style={S.li}>When you set a profile picture, header image, or send an image in a direct message, the app asks your permission to access your photo library and uploads only the image(s) you select.</li>
        </ul>
        <p style={S.p}><strong style={S.strong}>e. Technical and usage data</strong></p>
        <ul style={S.ul}>
          <li style={S.li}>Standard technical information generated when any app communicates over the internet — such as your IP address, device type, and app/diagnostic logs — processed by our infrastructure providers (see Section 4) to operate and secure the Service. We do <strong style={S.strong}>not</strong> use third-party advertising or analytics/tracking SDKs in the app.</li>
        </ul>

        <h2 style={S.h2}>3. How we use your information and our legal bases</h2>
        <p style={S.p}>We use your personal data to:</p>
        <ul style={S.ul}>
          <li style={S.li}><strong style={S.strong}>Provide the Service</strong> (create your account, show stories, enable the Square, comments, direct messages, bookmarks, and reading progress) — legal basis: <strong style={S.strong}>performance of a contract</strong> with you.</li>
          <li style={S.li}><strong style={S.strong}>Keep the community safe</strong> (operate reporting and blocking, moderate content, prevent abuse and enforce our Terms) — legal basis: <strong style={S.strong}>legitimate interests</strong> in maintaining a safe service, and <strong style={S.strong}>legal obligation</strong> where applicable.</li>
          <li style={S.li}><strong style={S.strong}>Verify eligibility</strong> (confirm you are 18+) — legal basis: <strong style={S.strong}>legitimate interests</strong> and <strong style={S.strong}>legal obligation</strong>.</li>
          <li style={S.li}><strong style={S.strong}>Communicate with you</strong> about your account and service-related matters — legal basis: <strong style={S.strong}>performance of a contract</strong> and <strong style={S.strong}>legitimate interests</strong>.</li>
          <li style={S.li}><strong style={S.strong}>Maintain security and integrity</strong> (debug, prevent fraud and misuse) — legal basis: <strong style={S.strong}>legitimate interests</strong>.</li>
        </ul>

        <h2 style={S.h2}>4. Service providers and third parties</h2>
        <p style={S.p}>We share personal data only with providers that process it on our behalf to run the Service:</p>
        <ul style={S.ul}>
          <li style={S.li}><strong style={S.strong}>Google Firebase (Google Ireland Ltd / Google LLC):</strong> hosts our backend — authentication, the Realtime Database (profiles, content, activity), and Cloud Storage (uploaded images). Your account and content data are stored on Google Firebase infrastructure.</li>
          <li style={S.li}><strong style={S.strong}>Apple Sign in with Apple</strong> and <strong style={S.strong}>Google Sign-In:</strong> where you choose those sign-in methods, to authenticate you.</li>
          <li style={S.li}><strong style={S.strong}>Cloudflare:</strong> a lightweight read-counter service (hosted on Cloudflare Workers) receives the identifier of the story being opened, together with standard request metadata such as your IP address, to aggregate story read counts.</li>
          <li style={S.li}><strong style={S.strong}>Anthropic (Claude):</strong> content you submit (such as posts and quiz answers) is processed server-side by Anthropic's Claude to perform content moderation and quiz scoring. We share only the content needed for those purposes.</li>
        </ul>
        <p style={S.p}>We do <strong style={S.strong}>not</strong> sell your personal data, and we do not share it with advertisers.</p>
        <p style={S.p}>
          <strong style={S.strong}>Analytics.</strong> The Story Island mobile app does <strong style={S.strong}>not</strong> include any analytics or tracking SDKs. Our website (calvaryscribblings.co.uk) uses Google Analytics (measurement ID G-W3B4WHBM8B) to understand website usage; this applies to the website only, not the mobile app.
        </p>

        <h2 style={S.h2}>5. International transfers</h2>
        <p style={S.p}>
          Our providers (including Google and Cloudflare) may process personal data on servers located outside the United Kingdom. Where data is transferred outside the UK, we rely on appropriate safeguards such as UK adequacy regulations and standard contractual clauses / the UK International Data Transfer Addendum.
        </p>

        <h2 style={S.h2}>6. How long we keep your data</h2>
        <p style={S.p}>
          We keep your account and content data for as long as your account is active. If you delete your account (see Section 7), we delete your profile and the personal data associated with your account from our active systems. Some information may be retained for a limited period where necessary to comply with legal obligations, resolve disputes, or enforce our agreements (for example, records of reports of abuse may be retained for safety purposes).
        </p>

        <h2 style={S.h2}>7. Your rights and choices</h2>
        <p style={S.p}>You can:</p>
        <ul style={S.ul}>
          <li style={S.li}><strong style={S.strong}>Delete your account</strong> at any time from <strong style={S.strong}>Settings → Delete account</strong>, which removes your profile and associated personal data from our active systems.</li>
          <li style={S.li}><strong style={S.strong}>Access and correct</strong> your profile information from <strong style={S.strong}>Edit profile</strong>.</li>
          <li style={S.li}><strong style={S.strong}>Block and report</strong> other users to control your experience.</li>
        </ul>
        <p style={S.p}>
          Under UK GDPR you also have the right to access, rectify, erase, restrict, or object to processing of your personal data, the right to data portability, and the right to withdraw consent where processing is based on consent. To exercise any of these rights, contact us at <a href="mailto:contact@calvaryscribblings.co.uk" style={S.link}>contact@calvaryscribblings.co.uk</a>.
        </p>
        <p style={S.p}>
          You have the right to lodge a complaint with the UK Information Commissioner's Office (ICO) at <a href="https://ico.org.uk" style={S.link} target="_blank" rel="noopener noreferrer">https://ico.org.uk</a> if you are unhappy with how we handle your data.
        </p>

        <h2 style={S.h2}>8. Security</h2>
        <p style={S.p}>
          We use the security features of our infrastructure providers (including encryption in transit and access controls) to protect your data. No method of transmission or storage is completely secure, but we take reasonable measures to protect your personal data.
        </p>

        <h2 style={S.h2}>9. Changes to this policy</h2>
        <p style={S.p}>
          We may update this Privacy Policy from time to time. We will update the "Last updated" date above and, where appropriate, notify you in the app.
        </p>

        <h2 style={S.h2}>10. Contact us</h2>
        <p style={S.p}><strong style={S.strong}>Calvary Media UK Ltd</strong> (company number 17034179)</p>
        <p style={S.p}>1 Grenard Close, Middleton House, London</p>
        <p style={S.p}>Email: <a href="mailto:contact@calvaryscribblings.co.uk" style={S.link}>contact@calvaryscribblings.co.uk</a></p>
      </section>
      <Footer />
    </div>
  );
}
