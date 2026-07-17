// Server component so the gateway can carry real metadata + JSON-LD. The interactive layer
// (doors, modals, localStorage auto-route) lives in the client component below.
//
// The root layout is 'use client', so this page is where root-level metadata has to live.
import Gateway from './components/Gateway';
import { fetchGatewayData } from './lib/gateway-build';

const BASE_URL = 'https://calvaryscribblings.co.uk';
// The social card and schema logo stay on favicon.png: it carries an opaque background, so
// it composites predictably where transparency would not. cs-logo-512-v3.png is the in-page mark.
const OG_IMAGE = `${BASE_URL}/favicon.png`;

export const metadata = {
  metadataBase: new URL(BASE_URL),
  // Heritage is named alongside global scope, never as a boundary: the platform publishes
  // writers everywhere, and the title must not read as an African-only shelf.
  title: 'Calvary Scribblings — The Story Island | Fiction, Poetry & Short Stories',
  description:
    'Original short stories, flash fiction, poetry and essays from a new generation of writers — with roots in Nigeria and writers everywhere. The Public Library is free to read, and Open Pages is open to your own writing. The Book Store opens 30 September.',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: BASE_URL,
    siteName: 'Calvary Scribblings',
    title: 'Calvary Scribblings — The Story Island',
    description:
      'Original short stories, flash fiction, poetry and essays from a new generation of writers — with roots in Nigeria and writers everywhere. Free to read. The Book Store opens 30 September.',
    images: [{ url: OG_IMAGE, width: 1206, height: 1168, alt: 'Calvary Scribblings' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Calvary Scribblings — The Story Island',
    description:
      'Original short stories, flash fiction, poetry and essays from a new generation of writers — with roots in Nigeria and writers everywhere. Free to read.',
    images: [OG_IMAGE],
  },
};

// sameAs is deliberately absent: the codebase carries no Calvary-owned social profiles,
// only per-author profile templates. Add them here when real accounts exist.
const JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${BASE_URL}/#organization`,
      name: 'Calvary Scribblings',
      alternateName: 'Calvary Media UK Ltd',
      url: BASE_URL,
      logo: { '@type': 'ImageObject', url: OG_IMAGE, width: 1206, height: 1168 },
      publisher: { '@type': 'Organization', name: 'Calvary Media UK Ltd' },
      email: 'contact@calvaryscribblings.co.uk',
      description:
        'A literary publication platform for original fiction, poetry and essays from a new generation of writers — with roots in Nigeria and writers everywhere.',
    },
    {
      '@type': 'WebSite',
      '@id': `${BASE_URL}/#website`,
      url: BASE_URL,
      name: 'Calvary Scribblings',
      description: 'The Story Island — original fiction, poetry and essays.',
      publisher: { '@id': `${BASE_URL}/#organization` },
      inLanguage: 'en-GB',
    },
  ],
};

// Server component: the story count and door whispers are read from cms_stories at BUILD
// TIME and baked into the client Gateway as props. The gateway itself stays zero-Firebase
// at runtime — see app/lib/gateway-build.js. The deploy-on-publish hook keeps them fresh.
export default async function GatewayPage() {
  const { storyCount, whispers, wall } = await fetchGatewayData();
  // Build-time random pick (item 3): the index a reduced-motion visitor sees, and where
  // the rotation opens. Frozen into the static export, so it's stable per deploy and the
  // first painted frame (crawlable) matches hydration.
  const whisperSeed = whispers.length ? Math.floor(Math.random() * whispers.length) : 0;
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />
      <Gateway storyCount={storyCount} whispers={whispers} whisperSeed={whisperSeed} wall={wall} />
    </>
  );
}
