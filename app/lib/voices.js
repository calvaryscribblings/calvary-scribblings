// Shared reads for Voices of the Island (cms_voices).
// The roster is deliberately its own node: cms_authors holds guest records keyed by
// push-id, and users/{uid} is reader-editable — neither can back a curated, ordered
// card gallery. See the Phase 1 commit message for the full reasoning.

// RTDB returns a plain object rather than an array whenever stored indices are not
// contiguous from 0, and omits the key entirely when the array was empty. Never
// assume Array here.
export function readMatchNames(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value && typeof value === 'object') return Object.values(value).filter(Boolean);
  return [];
}

// Published voices, in roster order. Ties fall back to name so the grid never
// reshuffles between builds when two voices share an order value.
export function publishedVoices(node) {
  return Object.entries(node || {})
    .map(([slug, v]) => ({ ...v, slug }))
    .filter((v) => v.published === true)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.displayName || '').localeCompare(b.displayName || ''));
}

export function firstNameOf(displayName) {
  return (displayName || '').trim().split(/\s+/)[0] || '';
}

// ── Card derivatives ─────────────────────────────────────────────────────────
//
// The cards are 1080×1350 social assets — about 1 MB of PNG each. That was tolerable when
// the grid showed one card per screen and lazy-loading deferred the rest; the dense grid
// puts four to six in the opening viewport, so it defers almost nothing and the reader
// pays for the whole roster up front.
//
// A Storage download URL carries a per-object token, so a derivative's URL cannot be
// derived from the original's by string surgery — it has to be stored. cms_voices/{slug}
// therefore carries cardSizes: { w360: url, w540: url } alongside the untouched cardImage,
// which stays the 1080 original.
//
// The keys are 'w360', not '360', on purpose: RTDB silently coerces a node whose keys are
// contiguous integers into an ARRAY on read. 360/540 would not trip that today, but the
// map is meant to grow, and a rung set that happened to look array-like would come back as
// something Object.keys() no longer describes. A letter prefix puts it beyond reach.
//
// The two rungs are DPR-driven, not breakpoint-driven, which is why two cover four layouts:
//   360w — a 173px card at DPR2 (mobile 2-col), a 268px card at DPR1 (desktop 4-col)
//   540w — a 173px card at DPR3 (mobile 2-col), a 268px card at DPR2 (desktop 4-col)
// The 1080 original is the top rung, and stays the author page's hero and morph target.
export const CARD_W = 1080;
export const CARD_H = 1350;
export const CARD_DERIVATIVE_WIDTHS = [360, 540];
export const cardSizeKey = (w) => `w${w}`;

// The srcset, or undefined for a record that has no derivatives yet — a voice added before
// the backfill, or one whose upload predates the CMS doing its own sizing. Undefined means
// the <img> falls back to src alone, which is exactly the old behaviour: heavier, correct.
export function cardSrcSet(voice) {
  const sizes = voice?.cardSizes;
  const original = voice?.cardImage;
  if (!sizes || !original) return undefined;
  const rungs = CARD_DERIVATIVE_WIDTHS
    .filter((w) => sizes[cardSizeKey(w)])
    .map((w) => `${sizes[cardSizeKey(w)]} ${w}w`);
  if (!rungs.length) return undefined;
  return [...rungs, `${original} ${CARD_W}w`].join(', ');
}

// What the grid CSS actually resolves to, so the browser can choose a rung before layout.
// Each value is the WIDEST the card gets in that band — over-estimating picks a larger
// image, under-estimating picks a blurry one, so the caps are deliberate:
//   ≥1100: inner maxes at 1120, four columns, 16px gaps → (1120 - 48) / 4 = 268
//   ≥768:  inner maxes at 920, three columns, 16px gaps → (920 - 32) / 3 = 296
//   ≥360:  two columns, 12px gap, 16px page padding     → (100vw - 44) / 2
//   below: one column                                    → 100vw - 32
export const CARD_SIZES_ATTR =
  '(min-width:1100px) 268px, (min-width:768px) 296px, (min-width:360px) calc((100vw - 44px) / 2), calc(100vw - 32px)';

// The morph pair. The card image on the grid and the portrait on the author page carry
// this same name, which is what lets the browser tween one into the other across the
// document boundary. Slugs are slugify()'d to [a-z0-9-] (app/admin/voices/page.js), and
// the 'voice-' prefix guarantees a leading letter, so this is always a valid custom-ident.
export function voiceTransitionName(slug) {
  return `voice-${slug}`;
}

// Return intent, handed across the document boundary. A history traverse announces itself
// through navigationActivation, but clicking the back link is a push and looks identical
// to the browser — this is how the far side learns that a push was still a return, so both
// run at the short duration. Read and cleared by the pagereveal listener in
// app/voices/layout.js.
export const VT_RETURN_KEY = 'cs_vt_return';

export function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

// cms_stories.date is a display string ("Jan 15, 2026"), not a timestamp, so RTDB
// cannot sort on it — newest-first has to happen here, after the query. Every one of
// the 148 rows parses cleanly today; an unparseable one sorts last rather than NaN-ing
// the comparator.
function dateValue(d) {
  const t = Date.parse(d);
  return Number.isNaN(t) ? -Infinity : t;
}

// A voice's published works, newest first.
//
// Server-filtered: one indexed equalTo per identity, never a wholesale cms_stories
// fetch (1.18 MB today). Identity is authorUid because three writers publish under two
// name spellings each — matching on the display string would silently drop half of
// each catalogue. matchNames is the fallback for the handful of rows saved with no uid
// (guest and collaboration pieces), which the uid match cannot reach.
//
// Requires "cms_stories": { ".indexOn": ["authorUid", "author"] }.
export async function loadWorks(db, voice) {
  const { ref, query, orderByChild, equalTo, get } = await import('firebase/database');
  const seen = new Map();

  // Only the four fields a row renders are retained. RTDB has no field projection, so
  // the snapshot itself carries content/extractedText; keeping the projection to this
  // one place means the heavy fields are never held past the loop.
  const collect = (snap) => {
    if (!snap.exists()) return;
    Object.entries(snap.val() || {}).forEach(([slug, s]) => {
      if (!s || s.published !== true || seen.has(slug)) return;
      seen.set(slug, {
        slug,
        title: s.title || '(untitled)',
        categoryName: s.categoryName || '',
        date: s.date || '',
      });
    });
  };

  const uid = (voice?.matchUid || '').trim();
  if (uid) {
    collect(await get(query(ref(db, 'cms_stories'), orderByChild('authorUid'), equalTo(uid))));
  }
  for (const name of readMatchNames(voice?.matchNames)) {
    collect(await get(query(ref(db, 'cms_stories'), orderByChild('author'), equalTo(name))));
  }

  return [...seen.values()].sort((a, b) => dateValue(b.date) - dateValue(a.date));
}
