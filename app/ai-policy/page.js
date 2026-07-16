// Static server component — no interactivity, so metadata lives directly on the page.
import Link from 'next/link';

const BASE_URL = 'https://calvaryscribblings.co.uk';
const OG_IMAGE = `${BASE_URL}/favicon.png`;

export const metadata = {
  metadataBase: new URL(BASE_URL),
  title: 'Our AI Policy — Calvary Scribblings',
  description:
    'Every story, poem and essay on Calvary Scribblings is written by a human being. Read our full policy on AI, human authorship, and how cover artwork is made.',
  alternates: { canonical: '/ai-policy' },
  openGraph: {
    type: 'article',
    url: `${BASE_URL}/ai-policy`,
    siteName: 'Calvary Scribblings',
    title: 'Our AI Policy — Calvary Scribblings',
    description:
      'Every story, poem and essay on Calvary Scribblings is written by a human being. Read our full policy.',
    images: [{ url: OG_IMAGE, width: 1206, height: 1168, alt: 'Calvary Scribblings' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Our AI Policy — Calvary Scribblings',
    description: 'Every story, poem and essay on Calvary Scribblings is written by a human being.',
    images: [OG_IMAGE],
  },
};

export default function AiPolicyPage() {
  return (
    <div className="cs-ai">
      <style>{`
        .cs-ai {
          --ai-gold:#c9a84c; --ai-cream:#f5f0e8;
          --ai-serif:'Cormorant Garamond',Georgia,serif;
          --ai-display:'Cinzel',Georgia,serif;
          background:radial-gradient(120% 40% at 50% -5%, #1c0f38 0%, #0b0716 55%, #080610 100%);
          min-height:100vh; font-family:var(--ai-serif); padding:64px 22px 72px;
        }
        .cs-ai-inner { max-width:640px; margin:0 auto; }
        .cs-ai h1 {
          font-family:var(--ai-display); font-size:26px; font-weight:600; letter-spacing:.12em;
          color:var(--ai-cream); text-align:center; margin:0;
        }
        .cs-ai-rule { width:60px; height:1px; background:var(--ai-gold); margin:18px auto 32px; }
        .cs-ai-prose p {
          font-size:18.5px; line-height:1.7; color:rgba(245,240,232,.82); margin:0 0 22px;
        }
        .cs-ai-prose a { color:var(--ai-gold); text-decoration:none; border-bottom:1px solid rgba(201,168,76,.5); }
        .cs-ai-prose a:hover { color:#e2c876; border-color:#e2c876; }
        .cs-ai-back {
          display:block; text-align:center; margin-top:44px; font-style:italic; font-size:15px;
          color:rgba(245,240,232,.6); text-decoration:none;
          border-bottom:1px solid rgba(201,168,76,.4); width:fit-content; margin-left:auto; margin-right:auto;
        }
        .cs-ai-back:hover { color:var(--ai-cream); border-color:var(--ai-gold); }
        .cs-ai a:focus-visible { outline:2px solid #e2c876; outline-offset:3px; }
      `}</style>
      <div className="cs-ai-inner">
        <h1>Our AI Policy</h1>
        <div className="cs-ai-rule" />
        <div className="cs-ai-prose">
          <p>
            Every story, poem, and essay on Calvary Scribblings is written by a human being. Our
            contributors are real writers — named, contracted, and paid — and no AI-generated
            writing is published on the island, in the Public Library, in Open Pages, or anywhere
            else. That is permanent.
          </p>
          <p>
            Some cover artwork in the Public Library is created with the assistance of AI image
            tools, always under the direction of our editorial team. We disclose this openly
            because we believe readers deserve to know how the things they love are made.
          </p>
          <p>
            The Book Store is different by design. It is a separate shelf with a stricter rule:
            every cover in the Book Store is human-made, supplied by the publisher or commissioned
            from an artist. No AI-generated imagery sits beside a publisher&rsquo;s book. This is a
            promise we make to the publishers and authors who trust us with their work — and to you.
          </p>
          <p>
            Questions about this policy are welcome:{' '}
            <a href="mailto:contact@calvaryscribblings.co.uk">contact@calvaryscribblings.co.uk</a>.
          </p>
        </div>
        <Link className="cs-ai-back" href="/">Return to the Island</Link>
      </div>
    </div>
  );
}
