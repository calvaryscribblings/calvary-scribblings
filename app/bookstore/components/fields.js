// Shared presentation helpers for the R4b catalogue system. Pure functions, no React —
// consumed by BoundBook, QuickLookModal, the storefront and the detail page so the
// fallback chains live in exactly one place.
//
// Fallback chains (see the R4b report §5):
//   openingLine : field openingLine  → first sentence of excerpt        → null (omit)
//   backBlurb   : field backCoverBlurb → synopsis truncated ~180 chars   → null (omit)
//   shelfCard   : NO fallback — present only when the curator wrote one.

// ── MONEY ────────────────────────────────────────────────────────────────────────────────
// R8.3 generalised formatGbp into formatPrice. There is still exactly ONE implementation:
// formatGbp is now a projection of it, keeping its original contract byte-for-byte (a
// non-finite input returns null, which is what makes every call site's `{price && …}` omit the
// line rather than print "£NaN").
//
// EVERY AMOUNT IN THIS SYSTEM IS AN INTEGER OF MINOR UNITS, and the three currencies do not
// agree on what a minor unit buys:
//   gbp  pence  — £4.99 is 499, two decimals shown
//   usd  cents  — $6.99 is 699, two decimals shown
//   ngn  kobo   — ₦4,500 is 450000, and NO decimals are shown
//
// The naira case is the one worth stating. Kobo are still hundredths, so the arithmetic is
// identical — but naira prices are quoted in whole naira and a shop that prints "₦4,500.00"
// reads as a foreign site guessing at the format. Grouping separators are mandatory at that
// magnitude for the same reason: ₦450000 is unreadable and ₦4,500 is a price.
//
// GROUPING IS HAND-ROLLED rather than Intl.NumberFormat, deliberately. This runs in a static
// export served from a CDN to readers in any locale, and Intl formats to the RUNTIME's locale
// data unless pinned — so the same title could render ₦4,500 for one reader and ₦4.500 for
// another with a European locale. The shop's prices are not a localised number; they are a
// price tag, and they must be identical everywhere. Two lines of code buys that certainty.
// R14 — THE GROUPING FUNCTION MOVED, and this is what is left behind.
//
// It used to be a private `group()` a few lines below. app/lib/bookstore/readership.js needs
// the identical behaviour for "In 1,204 readers' libraries", and that module must stay free
// of money vocabulary so the app can port it — so the shared function went to the money-free
// side rather than this file exporting it upward. One implementation, and the argument for
// hand-rolling it instead of Intl is unchanged and still written down, now where it lives.
// The .js extension is explicit: this module is imported by `node --test`
// (tests/bookstore/sections.test.mjs), and bare Node does not resolve extensionless
// specifiers. Same as app/lib/series/access.js's import of ../membership.js.
import { groupThousands } from '../../lib/bookstore/readership.js';

const CURRENCY_FORMAT = {
  gbp: { symbol: '£', decimals: 2 },
  usd: { symbol: '$', decimals: 2 },
  ngn: { symbol: '₦', decimals: 0 },
};

/**
 * A price tag from a currency code and an integer of minor units.
 * Returns null for anything unusable — an unknown currency, a non-finite amount — so a bad
 * record omits its price rather than printing nonsense next to a buy button.
 */
export function formatPrice(currency, minor) {
  const fmt = CURRENCY_FORMAT[currency];
  if (!fmt) return null;
  if (typeof minor !== 'number' || !Number.isFinite(minor)) return null;

  const major = minor / 100;
  if (fmt.decimals === 0) return `${fmt.symbol}${groupThousands(Math.round(major))}`;
  // toFixed first, so the grouping runs over the rounded integer part rather than over a
  // value that is about to round up into another digit.
  const [i, d] = major.toFixed(fmt.decimals).split('.');
  return `${fmt.symbol}${groupThousands(i)}.${d}`;
}

export function formatGbp(minor) {
  return formatPrice('gbp', minor);
}

export function stripHtml(str) {
  return String(str || '').replace(/<[^>]+>/g, '');
}

// First sentence of a block of prose, HTML stripped. Falls back to the whole string
// when no terminal punctuation is found.
export function firstSentence(text) {
  const t = stripHtml(text).trim();
  if (!t) return '';
  const m = t.match(/^.*?[.!?](?:["'”’])?(?:\s|$)/);
  return (m ? m[0] : t).trim();
}

// Word-boundary truncation with an ellipsis — never slices mid-word.
export function truncate(text, max = 180) {
  const t = stripHtml(text).trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd() + '…';
}

export function resolveOpeningLine(title) {
  if (title?.openingLine && title.openingLine.trim()) return title.openingLine.trim();
  if (title?.excerpt) {
    const s = firstSentence(title.excerpt);
    if (s) return s;
  }
  return null;
}

export function resolveBackBlurb(title) {
  if (title?.backCoverBlurb && title.backCoverBlurb.trim()) return title.backCoverBlurb.trim();
  if (title?.synopsis) {
    const s = truncate(title.synopsis, 180);
    if (s) return s;
  }
  return null;
}

// Deterministic gradient for the typographic fallback cover (missing coverUrl only),
// keyed off the slug so a title always draws the same colour. Mirrors R2's palette.
const COVER_GRADIENTS = [
  'linear-gradient(148deg,#1a0a2e 0%,#0e0618 100%)',
  'linear-gradient(148deg,#0e1a2e 0%,#060e1a 100%)',
  'linear-gradient(148deg,#1a120a 0%,#0e0806 100%)',
  'linear-gradient(148deg,#0a1a12 0%,#060e08 100%)',
  'linear-gradient(148deg,#1a0a14 0%,#0e0608 100%)',
  'linear-gradient(148deg,#141418 0%,#08080e 100%)',
  'linear-gradient(148deg,#1a1a08 0%,#0e0e06 100%)',
  'linear-gradient(148deg,#0e0a1a 0%,#08060e 100%)',
];
export function gradientFor(seed) {
  let h = 0;
  const s = String(seed || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return COVER_GRADIENTS[h % COVER_GRADIENTS.length];
}

// THE CATALOGUE MARK (R7.2). catalogueNumber is a schema-external positive integer set by
// the curator in /admin/bookstore; every surface that shows it now renders the same mark —
// 'CS' and a zero-padded three-digit number — so a title reads identically on the shelf,
// in the window, on its back cover, in Quick Look, on its detail page and in the colophon
// at the end of the book. Returns null when the curator has not assigned one, which is the
// signal to omit the line entirely rather than print a placeholder.
export function formatCatalogueNumber(n) {
  if (!Number.isInteger(n) || n <= 0) return null;
  return `CS ${String(n).padStart(3, '0')}`;
}

// ═════════════════════════════════════════════════════════════════════════════════════════
// THE OBI BAND — R13 gave it ONE input, and that is the whole change
// ═════════════════════════════════════════════════════════════════════════════════════════
//
// It used to read `title.featured`, which was also what put a book in the Window
// (app/bookstore/page.js's old `titles.find(t => t.featured)`). One boolean carrying two
// editorial meanings: there was no way to put a book in the display case without also
// banding it, and no way to band a book without also putting it in the case. The band and
// the section could not be made to disagree because they could not be told apart.
//
// Now the band comes from the CLAIM. A live EDITORS_CHOICE section in bookstore_sections
// grants it, sections.js's bandsFor()/applyBands() stamp it onto the title object as `band`,
// and this function prints what it is handed. The band and the section cannot disagree
// because there is exactly one input and it IS the section.
//
// ⚠ `featured` IS DELIBERATELY NOT READ HERE ANY MORE. The field survives — it is
// schema-required in TITLE_SCHEMA v2 and indexed in database.rules.json — as the migration's
// input and as the record of what the shop used to think. Nothing renders from it.
// tests/bookstore/sections.test.mjs asserts that, by reading this file as text.
//
// `bestseller` stays as it was. It is a different claim ("Reader Favourite"), it was never
// entangled with the Window, and R13 was not asked to touch it. When READERS_CHOICE wakes up
// this is the flag it will replace — a boolean an editor ticks, standing in for a fact about
// readers — but it will be replaced by real data, not by another boolean.
export function obiLabel(title) {
  if (title?.band) return title.band;
  if (title?.bestseller) return 'Reader Favourite';
  return null;
}
