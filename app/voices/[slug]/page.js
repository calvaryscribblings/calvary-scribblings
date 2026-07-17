// Server wrapper for a voice's author page. Matches the repo's static-export pattern
// (app/bookstore/[slug]/page.js): the server page owns generateStaticParams +
// generateMetadata and renders the client component. There is deliberately no sibling
// [slug]/layout.js — under Next 16 a dynamic-segment layout that also exports
// generateStaticParams stops the page's own copy from registering.
//
// SENTINEL: under output:'export', Next 16 rejects a dynamic route whose
// generateStaticParams returns an EMPTY array ("missing generateStaticParams()"). The
// roster can legitimately be empty (it was, until Phase 1), so an empty list emits one
// reserved slug. It contains underscores, which slugify() strips, so it can never
// collide with a real slug — and the client resolves it, like any unknown slug, to the
// not-found state.
import { fetchVoicesNode, fetchVoice } from '../../lib/voices-build';
import VoicePageClient from './page-client';

const SENTINEL = '__no-voices-yet__';
const BASE_URL = 'https://calvaryscribblings.co.uk';

// Every slug is built, published or not — the same way cms_stories builds all 148
// including the 20 unpublished. Building only published voices would return an empty
// array whenever the roster is all drafts and fail the build outright. The client gates
// on `published`, so a draft's page exists but resolves to not-found.
export async function generateStaticParams() {
  const slugs = Object.keys(await fetchVoicesNode());
  if (slugs.length) return slugs.map((slug) => ({ slug }));
  return [{ slug: SENTINEL }];
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const voice = await fetchVoice(slug);

  // A draft gets no metadata and no indexing — its page exists only because the build
  // enumerates every slug.
  if (!voice || voice.published !== true) {
    return { title: 'Voices of the Island — Calvary Scribblings', robots: { index: false, follow: false } };
  }

  const name = voice.displayName || 'Voices of the Island';
  const title = `${name} — Voices of the Island`;
  const description = voice.message || voice.genreTag || `${name} — a voice of Calvary Scribblings.`;
  const url = `${BASE_URL}/voices/${slug}`;
  // The 1080×1350 card is the share asset this feature exists for, so it is the OG
  // image rather than the site favicon.
  const image = voice.cardImage || `${BASE_URL}/favicon.png`;

  return {
    metadataBase: new URL(BASE_URL),
    title,
    description,
    alternates: { canonical: `/voices/${slug}` },
    openGraph: {
      type: 'profile',
      url,
      siteName: 'Calvary Scribblings',
      title,
      description,
      images: [{ url: image, width: 1080, height: 1350, alt: `${name} — Voices of the Island` }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [image],
    },
  };
}

// The seed. The portrait must be painted at this document's first frame or the morph has
// nothing to land on — the incoming page would carry no matching view-transition-name and
// the browser would cut instead of tween. It also fixes the hero's layout shift and gives
// anyone arriving from a share link a composed page rather than a wait. The client re-reads
// cms_voices on mount, so this is the opening frame, not the source of record.
//
// The sentinel has no record, and a draft is seeded as-is — page-client gates on
// published===true either way.
export default async function VoicePage({ params }) {
  const { slug } = await params;
  return <VoicePageClient slug={slug} initialVoice={await fetchVoice(slug)} />;
}
