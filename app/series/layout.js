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
export const metadata = {
  title: 'The Series — Calvary Scribblings',
  description:
    'Long-form fiction in instalments. Each instalment is its own complete book, released on its own date. A Platinum membership benefit.',
};

export default function SeriesLayout({ children }) {
  return children;
}
