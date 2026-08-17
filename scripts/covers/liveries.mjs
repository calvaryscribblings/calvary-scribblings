// THE SIX LIVERIES — the only thing that varies between covers besides the words.
//
// A livery is four colours and a ground treatment. Everything else on the cover — every
// measurement in layout.mjs, every tracking value, the fleuron, the keyline geometry — is
// identical across all six. That is the design: the system is one cover, and the category
// tints it. Resist adding per-livery metrics here; the moment a livery moves a baseline,
// six layouts exist instead of one and the contact sheet stops proving anything.
//
// ── WHAT EACH COLOUR DOES ────────────────────────────────────────────────────────────────
//   ground    the flat fill under everything
//   keyline   the double border AND the eyebrow, hairline rule, fleuron, descriptor, footer.
//             One colour for all the furniture. The eyebrow/descriptor/footer do NOT get a
//             colour of their own — they are furniture, and the ruling on the reading page
//             (see app/lib/houseGold.js) is the same ruling here.
//   title     the title and the author
//   glow      dark liveries only. The soft radial wash off the top-left corner.
//
// ── WHY POETRY AND SERIES HAVE NO GLOW ───────────────────────────────────────────────────
// They are the two LIGHT grounds. A radial lightening on an already-light ground reads as a
// printing fault, not as depth. They take a vignette instead — see render.mjs. `glow: null`
// is the switch between the two treatments; it is not "no decision yet".

/** @typedef {{key:string,name:string,ground:string,keyline:string,title:string,glow:string|null}} Livery */

export const LIVERIES = Object.freeze({
  short:     Object.freeze({ key: 'short',     name: 'Short Story',     ground: '#080610', keyline: '#C9A84C', title: '#F5F0E8', glow: '#6B2FAD' }),
  poetry:    Object.freeze({ key: 'poetry',    name: 'Poetry',          ground: '#DBD0BA', keyline: '#4E2276', title: '#221A28', glow: null      }),
  flash:     Object.freeze({ key: 'flash',     name: 'Flash Fiction',   ground: '#3C101A', keyline: '#C9A84C', title: '#F5F0E8', glow: '#781E28' }),
  inspiring: Object.freeze({ key: 'inspiring', name: 'Inspiring',       ground: '#102E26', keyline: '#C9A84C', title: '#F5F0E8', glow: '#185C4A' }),
  news:      Object.freeze({ key: 'news',      name: 'News & Updates',  ground: '#0E1A2E', keyline: '#C9A84C', title: '#F5F0E8', glow: '#1E4478' }),
  series:    Object.freeze({ key: 'series',    name: 'Series',          ground: '#E6E0D2', keyline: '#6E1424', title: '#1C1418', glow: null      }),
});

/** A livery is "light" exactly when it has no glow. The two facts are one fact. */
export const isLight = (livery) => livery.glow === null;

// ── CATEGORY → LIVERY ────────────────────────────────────────────────────────────────────
// cms_stories.category is one of five slugs; `series` is not among them, because series
// instalments live on series_instalments and reach this module by an explicit livery
// override rather than by category lookup. The alias table also accepts categoryName and a
// few historical spellings, because a migration reading 158 live records should not fall
// over on a record that says "Short Story" where its neighbours say "short".
const ALIASES = new Map(Object.entries({
  short: 'short', 'short story': 'short', 'short stories': 'short', fiction: 'short',
  poetry: 'poetry', poem: 'poetry', poems: 'poetry',
  flash: 'flash', 'flash fiction': 'flash',
  inspiring: 'inspiring', inspirational: 'inspiring', inspiration: 'inspiring',
  news: 'news', 'news & updates': 'news', 'news and updates': 'news', updates: 'news',
  series: 'series', instalment: 'series',
}));

/**
 * The livery for a category, and the eyebrow that goes with it.
 *
 * An UNRECOGNISED or MISSING category is an explicit, designed case — not an error and not
 * a hole. It takes the Short Story livery, which is the house default and the most numerous,
 * and the eyebrow falls back to the imprint. A cover with no category still looks like a
 * finished object rather than one whose top line failed to load; that is the same principle
 * the descriptor follows in layout.mjs.
 */
export function liveryFor(category) {
  const k = ALIASES.get(String(category ?? '').trim().toLowerCase());
  return k ? LIVERIES[k] : LIVERIES.short;
}

/** True when `category` names a livery. Callers that must SEE the fallback ask this first. */
export function isKnownCategory(category) {
  return ALIASES.has(String(category ?? '').trim().toLowerCase());
}

/** The imprint, used as the eyebrow when the category is missing or unknown. */
export const IMPRINT_EYEBROW = 'CALVARY SCRIBBLINGS';

/** The eyebrow text for a record: its category's display name, or the imprint. */
export function eyebrowFor(category, categoryName) {
  if (isKnownCategory(category)) return liveryFor(category).name;
  if (isKnownCategory(categoryName)) return liveryFor(categoryName).name;
  const cn = String(categoryName ?? '').trim();
  return cn || IMPRINT_EYEBROW;
}
