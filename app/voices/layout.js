// Metadata for the Voices index. The page itself is a client component (it reads
// cms_voices live), so metadata moves here — the same split as app/public-library.
// A voice's own page overrides this via generateMetadata in [slug]/page.js.
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

export default function VoicesLayout({ children }) {
  return children;
}
