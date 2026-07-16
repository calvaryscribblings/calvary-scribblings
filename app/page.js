// Server component so the gateway can carry real metadata + JSON-LD. The interactive layer
// (doors, modals, localStorage auto-route) lives in the client component below.
//
// The root layout is 'use client', so this page is where root-level metadata has to live.
import Gateway from './components/Gateway';

const BASE_URL = 'https://calvaryscribblings.co.uk';
const OG_IMAGE = `${BASE_URL}/favicon.png`;

export const metadata = {
  metadataBase: new URL(BASE_URL),
  title: 'Calvary Scribblings — The Story Island | African Fiction, Poetry & Stories',
  description:
    'Original short stories, flash fiction, poetry and essays from a new generation of Nigerian and African writers. The Public Library is free to read, and Open Pages is open to your own writing. The Book Store opens 30 September.',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: BASE_URL,
    siteName: 'Calvary Scribblings',
    title: 'Calvary Scribblings — The Story Island',
    description:
      'Original short stories, flash fiction, poetry and essays from a new generation of Nigerian and African writers. Free to read. The Book Store opens 30 September.',
    images: [{ url: OG_IMAGE, width: 1206, height: 1168, alt: 'Calvary Scribblings' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Calvary Scribblings — The Story Island',
    description:
      'Original short stories, flash fiction, poetry and essays from a new generation of Nigerian and African writers. Free to read.',
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
        'A literary publication platform for original fiction, poetry and essays from a new generation of African writers.',
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

export default function GatewayPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />
      <Gateway />
    </>
  );
}
