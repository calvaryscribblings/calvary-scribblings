// Shared presentation helpers for the R4b catalogue system. Pure functions, no React —
// consumed by BoundBook, QuickLookModal, the storefront and the detail page so the
// fallback chains live in exactly one place.
//
// Fallback chains (see the R4b report §5):
//   openingLine : field openingLine  → first sentence of excerpt        → null (omit)
//   backBlurb   : field backCoverBlurb → synopsis truncated ~180 chars   → null (omit)
//   shelfCard   : NO fallback — present only when the curator wrote one.

export function formatGbp(minor) {
  if (typeof minor !== 'number' || !Number.isFinite(minor)) return null;
  return `£${(minor / 100).toFixed(2)}`;
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

// Obi band label: featured wins over bestseller when both are set.
export function obiLabel(title) {
  if (title?.featured) return 'Editor’s Choice';
  if (title?.bestseller) return 'Reader Favourite';
  return null;
}
