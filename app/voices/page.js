// Voices of the Island — v1 card gallery. Static server component, so metadata lives here.
// This is deliberately simple and contained: a fully designed page replaces it later.
import Link from 'next/link';

const BASE_URL = 'https://calvaryscribblings.co.uk';
const OG_IMAGE = `${BASE_URL}/favicon.png`;

export const metadata = {
  metadataBase: new URL(BASE_URL),
  title: 'Voices of the Island — Calvary Scribblings',
  description:
    'Meet the writers and voices of Calvary Scribblings — the contributors behind the short stories, flash fiction, poetry and essays published on the island.',
  alternates: { canonical: '/voices' },
  openGraph: {
    type: 'website',
    url: `${BASE_URL}/voices`,
    siteName: 'Calvary Scribblings',
    title: 'Voices of the Island — Calvary Scribblings',
    description: 'The writers and voices of Calvary Scribblings.',
    images: [{ url: OG_IMAGE, width: 1206, height: 1168, alt: 'Calvary Scribblings' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Voices of the Island — Calvary Scribblings',
    description: 'The writers and voices of Calvary Scribblings.',
    images: [OG_IMAGE],
  },
};

// Card images live in /public/voices/ and are 1080×1350. Adding a voice is one entry:
//
//   { file: 'voices-kalu-rebecca.png', name: 'Kalu Rebecca' },
//
// `name` builds the alt text ("{Name} — Voices of the Island"); `file` is the filename
// inside /public/voices/. Order here is the order on the page.
const VOICES = [];

const CARD_W = 1080;
const CARD_H = 1350;

export default function VoicesPage() {
  return (
    <div className="cs-vo">
      <style>{`
        .cs-vo {
          --vo-gold:#c9a84c; --vo-cream:#f5f0e8;
          --vo-serif:'Cormorant Garamond',Georgia,serif;
          --vo-display:'Cinzel',Georgia,serif;
          background:radial-gradient(120% 40% at 50% -5%, #1c0f38 0%, #0b0716 55%, #080610 100%);
          min-height:100vh; font-family:var(--vo-serif); padding:64px 22px 72px;
        }
        .cs-vo-inner { max-width:440px; margin:0 auto; }
        .cs-vo-eyebrow {
          font-family:var(--vo-display); font-size:11.5px; letter-spacing:.28em;
          color:var(--vo-gold); text-align:center;
        }
        .cs-vo-rule { width:44px; height:1px; background:var(--vo-gold); margin:14px auto 16px; }
        .cs-vo-intro {
          font-style:italic; font-size:18px; color:rgba(245,240,232,.75);
          text-align:center; margin:0 0 38px;
        }
        .cs-vo-grid { display:grid; grid-template-columns:1fr; gap:26px; }
        .cs-vo-card {
          width:100%; height:auto; display:block; border-radius:14px;
          border:1px solid rgba(201,168,76,.28);
          box-shadow:0 10px 34px rgba(0,0,0,.5);
          background:rgba(8,6,16,.5);
        }
        .cs-vo-empty {
          text-align:center; font-style:italic; font-size:16px;
          color:rgba(245,240,232,.45); padding:36px 0;
        }
        .cs-vo-back {
          display:block; width:fit-content; margin:44px auto 0; text-align:center;
          font-style:italic; font-size:15px; color:rgba(245,240,232,.6);
          text-decoration:none; border-bottom:1px solid rgba(201,168,76,.4);
        }
        .cs-vo-back:hover { color:var(--vo-cream); border-color:var(--vo-gold); }
        .cs-vo a:focus-visible { outline:2px solid #e2c876; outline-offset:3px; }
        @media (min-width:768px) {
          .cs-vo-inner { max-width:920px; }
          .cs-vo-grid { grid-template-columns:1fr 1fr; gap:32px; }
        }
      `}</style>
      <div className="cs-vo-inner">
        <div className="cs-vo-eyebrow">VOICES OF THE ISLAND</div>
        <div className="cs-vo-rule" />
        <p className="cs-vo-intro">The writers and voices of Calvary Scribblings.</p>

        {VOICES.length > 0 ? (
          <div className="cs-vo-grid">
            {VOICES.map((v) => (
              <img
                key={v.file}
                className="cs-vo-card"
                src={`/voices/${v.file}`}
                alt={`${v.name} — Voices of the Island`}
                width={CARD_W}
                height={CARD_H}
                loading="lazy"
              />
            ))}
          </div>
        ) : (
          <p className="cs-vo-empty">The voices are being gathered. Come back soon.</p>
        )}

        <Link className="cs-vo-back" href="/">Return to the Island</Link>
      </div>
    </div>
  );
}
