// THE SERIES — layout and metadata.
//
// NOTE WHAT IS NOT HERE: `robots: { index: false }`. app/bookstore/layout.js carries exactly
// that, because the storefront is behind a pre-launch curtain and must not be crawled. The
// Series is the opposite case and the difference is deliberate.
//
// /series is in app/sitemap.js, so we are telling crawlers this page exists. That claim has
// to be honest, and it is only honest because the landing page is genuinely public: every
// series poster, every synopsis, every instalment row and every lock is rendered for a
// signed-out reader. Only the FILES are gated — precisely the arrangement the bookstore uses
// for `bookstore_titles` (`.read: true`) against `master.epub` (`read: false`).
//
// If the Series ever became members-only at the PAGE level, this file would need
// `robots: { index: false }` and app/sitemap.js would need /series removed, in the same
// change. A sitemap entry pointing at a wall is a soft-404 signal, and the two must not be
// allowed to drift apart.
//
// ── R31: THE DESCRIPTION FOLLOWS THE FLAG, AS THE PAGE'S OWN COPY ALREADY DID ────────────
//
// It shipped hardcoding "A Platinum membership benefit." while page.js derived its kicker and
// its on-page description from SERIES_TIER_GATE_ENABLED — so the live HTML carried a meta
// description promising a paywall directly above a page that said the Series is free to
// everyone. Same fault the kicker's own comment names: the page telling a reader something the
// endpoint disagrees with. It is worse in metadata than in body copy, because this is the
// sentence a search result and a shared link print, where there is no page around it to
// correct the impression.
import { SERIES_TIER_GATE_ENABLED } from '../lib/series/access';

export const metadata = {
  title: 'The Series — Calvary Scribblings',
  description: SERIES_TIER_GATE_ENABLED
    ? 'Long-form fiction in instalments. Each instalment is its own complete book, released on its own date. A Platinum membership benefit.'
    : 'Long-form fiction in instalments. Each instalment is its own complete book, released on its own date — and free to everyone until memberships open.',
};

export default function SeriesLayout({ children }) {
  return children;
}
