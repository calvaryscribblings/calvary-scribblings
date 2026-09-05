// THE BOOK STORE'S ROUTE METADATA — the storefront's own card, and the noindex both routes inherit.
//
// ── ⚠ R9.1 — THIS FILE WAS FOUR LINES, AND THE SHOP'S FRONT DOOR UNFURLED BARE ───────────
//
// It carried a generic title and the robots key and nothing else. Measured against production
// on 5 Sept 2026:
//
//     /bookstore                og: tags = 0    twitter: tags = 0    <title>Calvary Scribblings</title>
//     /bookstore/the-rescue     og: ✓ (6)       twitter: ✓ (4)       <title>The Rescue — … Book Store</title>
//
// So every DETAIL page shared beautifully and the SHOP ITSELF — the one URL that goes in a
// launch announcement, a newsletter, a WhatsApp message and the link-in-bio — arrived as a
// bare domain with no picture, no name and no sentence. That is the single most-shared URL of
// launch day and it was the only one in the tree with nothing to show.
//
// It went unseen because the detail route sets its own metadata in generateMetadata() and
// looked, from every angle anyone had checked, like the bookstore was handled.
//
// ── NOINDEX STAYS UNTIL LAUNCH, AND THE TWO ARE NOT IN TENSION ───────────────────────────
//
// A card and a noindex answer different questions. `robots` tells a CRAWLER not to index; an
// og: card tells a MESSAGING APP what to draw when a human pastes the link. The curtain is
// social, not technical (app/lib/bookstore/gate.js), and the readers who have the key are
// exactly the people who will paste this URL to each other before opening day. They should get
// the shop, not a bare domain.
//
// ⚠ NOT THIS ROUND: the noindex does NOT come off here. That is launch day, it is Ikenna's
// word on the day, and it is TWO changes not one — removing `robots` below AND adding
// /bookstore and /bookstore/[slug] to app/sitemap.js, which lists neither today. Removing only
// the first opens a shop that nothing points a crawler at.
//
// ── ⭑ THE IMAGE IS IKENNA'S RULING, AND THIS IS THE PLACEHOLDER, NOT THE ANSWER ──────────
//
// What is set below is THE HOUSE CARD — `/favicon.png`, 1206×1168 — which is the same image
// app/page.js, app/links/page.js and app/voices/layout.js already share. It is chosen because
// it is the card this house already ships, not because it is right for a shop.
//
// TWO THINGS THE RULING SHOULD KNOW:
//
//   · ⚠ DO NOT USE A BOOK COVER HERE. The detail page's card is the title's own jacket, which
//     is correct there. A jacket is 2:3 PORTRAIT and a social card is 1.91:1 LANDSCAPE, so a
//     cover in this slot is centre-cropped to a horizontal band across its middle — the title
//     and the author's name are the first things lost. It reads as a mistake, and it would be
//     the shop's only impression.
//
//   · THE HOUSE CARD IS NEARLY SQUARE (1.03:1) and is also cropped — a 1206×1168 image in a
//     1.91:1 slot keeps roughly the middle 1206×632, losing about 46% of its height. The mark
//     is centred, so it survives; this is why every other route on the site looks acceptable
//     rather than good. A PURPOSE-DRAWN 1200×630 would be better for all of them, and the
//     Book Store is the first place it would earn its cost.
//
// So: this is a real improvement over nothing and a placeholder against a drawn card. If
// Ikenna commissions one, change OG_IMAGE and its dimensions here — nothing else moves.

import { BOOKSTORE_OPENS } from '../lib/launch';

const BASE_URL = 'https://calvaryscribblings.co.uk';

// The house card. See the ruling note above before changing it.
const OG_IMAGE = `${BASE_URL}/favicon.png`;
const OG_IMAGE_W = 1206;
const OG_IMAGE_H = 1168;

const TITLE = 'The Book Store — Calvary Scribblings';

// ⚠ THE LAUNCH SENTENCE IS APPENDED, NOT TYPED. BOOKSTORE_OPENS comes from app/lib/launch.js,
// which is the only file permitted to write a launch date (tests/build/launch-literals.test.mjs
// enforces it). On launch day the date stops being true here as it does everywhere else, and
// this description is one of the eleven sites that changes — it must not be the one that was
// missed because somebody typed the sentence out by hand.
const DESCRIPTION =
  'Books from the writers we publish and the ones we love — bought once, yours to keep, and '
  + `readable on every device you sign in on. ${BOOKSTORE_OPENS}`;

export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
  // Inherited by /bookstore/[slug], whose generateMetadata deliberately sets no robots key.
  // ⚠ Removing this is launch-day work and pairs with app/sitemap.js. See the note above.
  robots: { index: false, follow: false },
  alternates: { canonical: `${BASE_URL}/bookstore` },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: `${BASE_URL}/bookstore`,
    siteName: 'Calvary Scribblings',
    type: 'website',
    images: [{ url: OG_IMAGE, width: OG_IMAGE_W, height: OG_IMAGE_H, alt: 'Calvary Scribblings' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: [OG_IMAGE],
  },
};

export default function BookStoreLayout({ children }) {
  return children;
}
