// Metadata for the reading platform, which was the homepage until the gateway took /.
// The canonical is deliberately self-referential — /public-library is where the content
// lives, so it must not canonical back to the gateway at /.
const BASE_URL = 'https://calvaryscribblings.co.uk';
const OG_IMAGE = `${BASE_URL}/favicon.png`;

export const metadata = {
  metadataBase: new URL(BASE_URL),
  title: 'The Public Library — Calvary Scribblings',
  description:
    'Read original short stories, flash fiction, poetry, news and inspiring writing from a new generation of Nigerian and African writers. Free to read, and open to your own pages.',
  alternates: { canonical: '/public-library' },
  openGraph: {
    type: 'website',
    url: `${BASE_URL}/public-library`,
    siteName: 'Calvary Scribblings',
    title: 'The Public Library — Calvary Scribblings',
    description:
      'Original short stories, flash fiction, poetry and essays from a new generation of African writers. Free to read.',
    images: [{ url: OG_IMAGE, width: 1206, height: 1168, alt: 'Calvary Scribblings' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'The Public Library — Calvary Scribblings',
    description:
      'Original short stories, flash fiction, poetry and essays from a new generation of African writers. Free to read.',
    images: [OG_IMAGE],
  },
};

export default function PublicLibraryLayout({ children }) {
  return children;
}
